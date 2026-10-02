// One-off remediation: long-caption.mjs had a bug where the sentence-
// truncation fallback sliced at a raw character offset with no word-boundary
// check, so overflow Bluesky posts ended mid-word (e.g. "...recog…" instead
// of "...recognizes…"). Fixed in long-caption.mjs 2026-10-02. This script
// finds every live Bluesky post whose caption the bug affected, deletes it,
// and reposts with the corrected (word-boundary-safe) text.
//
// Usage: node pipeline/fix-bluesky-truncation.mjs           (dry run, lists affected posts)
//        node pipeline/fix-bluesky-truncation.mjs --apply   (deletes + reposts for real)
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLongCaption } from "./long-caption.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SERVICE = "https://bsky.social";
const HANDLE = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;
const MAX_GRAPHEMES = 300;

async function findAllCardFiles() {
  const results = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.name === "card.json") results.push(full);
    }
  }
  await walk(path.join(ROOT, "content-queue"));
  return results;
}

// The old buggy slice: text.slice(0, remaining - 1).trimEnd() + "…" with no
// word-boundary snap. Reconstructed here (read-only) purely to detect which
// live posts were built this way, by checking whether the OLD algorithm's
// output differs from the NEW one for the same card.
function buildOldBuggyCaption(card, maxChars) {
  const allParagraphs = (card.caption ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);
  const hashtagParagraph = allParagraphs.find((p) => p.startsWith("#"));
  const hashtagsFromArray = (card.hashtags ?? []).slice(0, 3).join(" ");
  const hashtags = hashtagsFromArray || (hashtagParagraph ? hashtagParagraph.split(" ").slice(0, 3).join(" ") : "");
  const hashtagBlock = hashtags ? `\n\n${hashtags}` : "";
  const paragraphs = allParagraphs.filter((p) => {
    if (p.startsWith("Also on")) return false;
    if (p.startsWith("Independent citizen project")) return false;
    if (p.startsWith("Sources:")) return false;
    if (p.startsWith("#")) return false;
    return true;
  });
  if (paragraphs.length === 0) return card.title ?? "";
  const ABBREVIATIONS = new Set(["u.s", "u.k", "e.g", "i.e", "etc", "vs", "no", "mr", "mrs", "dr", "st"]);
  function splitIntoSentences(text) {
    const rawParts = text.split(/(?<=[.!?])\s+/);
    const sentences = [];
    let buffer = "";
    for (const part of rawParts) {
      buffer = buffer ? `${buffer} ${part}` : part;
      const lastWord = buffer.slice(0, -1).split(/\s+/).pop()?.toLowerCase() ?? "";
      if (ABBREVIATIONS.has(lastWord)) continue;
      sentences.push(buffer.trim());
      buffer = "";
    }
    if (buffer) sentences.push(buffer.trim());
    return sentences.filter(Boolean);
  }
  let text = paragraphs[0];
  let usedWholeParagraphs = 1;
  for (let i = 1; i < paragraphs.length; i++) {
    const candidate = `${text}\n\n${paragraphs[i]}`;
    if (candidate.length + hashtagBlock.length > maxChars) break;
    text = candidate;
    usedWholeParagraphs++;
  }
  if (usedWholeParagraphs === 1 && paragraphs.length > 1) {
    const nextSentences = splitIntoSentences(paragraphs[1]);
    let addedAny = false;
    for (const sentence of nextSentences) {
      const candidate = `${text} ${sentence}`;
      if (candidate.length + hashtagBlock.length > maxChars) break;
      text = candidate;
      addedAny = true;
    }
    if (!addedAny && nextSentences[0]) {
      const remaining = maxChars - hashtagBlock.length - text.length - 2;
      if (remaining > 20) {
        text = `${text} ${nextSentences[0].slice(0, remaining - 1).trimEnd()}…`;
      }
    }
  }
  if (text.length + hashtagBlock.length <= maxChars) {
    text += hashtagBlock;
  } else if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1).trimEnd() + "…";
  }
  return text;
}

async function createSession() {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Bluesky login failed: ${json.message ?? json.error}`);
  return json;
}

async function deletePost(session, uri) {
  const parts = uri.replace("at://", "").split("/");
  const [repo, collection, rkey] = parts;
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({ repo, collection, rkey }),
  });
  if (!res.ok) throw new Error(`Delete failed (${res.status}): ${await res.text()}`);
}

async function createPost(session, text) {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.accessJwt}` },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: { $type: "app.bsky.feed.post", text, createdAt: new Date().toISOString() },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Post failed: ${json.message ?? json.error}`);
  return json;
}

async function main() {
  const apply = process.argv.includes("--apply");

  const files = await findAllCardFiles();
  const affected = [];
  for (const f of files) {
    const card = JSON.parse(await fs.readFile(f, "utf-8"));
    if (!card.blueskyPostUri) continue;
    const oldText = buildOldBuggyCaption(card, MAX_GRAPHEMES);
    const newText = buildLongCaption(card, MAX_GRAPHEMES);
    if (oldText !== newText) {
      affected.push({ file: f, card, oldText, newText });
    }
  }

  console.log(`Found ${affected.length} live Bluesky post(s) affected by the mid-word truncation bug.\n`);

  if (!apply) {
    for (const a of affected) {
      console.log(`--- ${a.file} ---`);
      console.log(`OLD: ${a.oldText.slice(-60)}`);
      console.log(`NEW: ${a.newText.slice(-60)}`);
      console.log();
    }
    console.log(`Dry run only. Re-run with --apply to delete and repost these ${affected.length} posts.`);
    return;
  }

  if (!HANDLE || !APP_PASSWORD) {
    console.error("Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD in .env.");
    process.exit(1);
  }

  const session = await createSession();
  let okCount = 0;
  for (const a of affected) {
    try {
      console.log(`Fixing ${a.file} ...`);
      await deletePost(session, a.card.blueskyPostUri);
      const result = await createPost(session, a.newText);
      a.card.blueskyPostUri = result.uri;
      a.card.blueskyPostedAt = new Date().toISOString();
      a.card.blueskyTruncationFixedAt = new Date().toISOString();
      await fs.writeFile(a.file, JSON.stringify(a.card, null, 2), "utf-8");
      console.log(`  OK -> ${result.uri}`);
      okCount++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(`\nDone: ${okCount}/${affected.length} posts fixed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
