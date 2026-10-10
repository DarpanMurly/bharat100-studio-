// Second-round remediation: the word-boundary fix (11477ab) stopped mid-word
// cuts but still routinely landed right after a dangling connector word
// (preposition/conjunction/auxiliary verb) with no object - "...was
// inaugurated by PM Modi on March 31, 2026, with…" or "...assembly and test
// plant - was…" (real cases, Kaynes Semicon and Micron Sanand posts). Fixed
// in long-caption.mjs. This script finds every live Bluesky post whose
// caption the dangling-connector bug affected, deletes it, and reposts with
// the corrected text.
//
// Compares against pipeline/compat/pre-dangling-fix-long-caption.mjs, a
// frozen copy of long-caption.mjs as it stood right after the word-boundary
// fix (commit 11477ab) and before this dangling-connector fix - i.e. the
// exact logic every currently-live post was actually built with.
//
// Usage: node pipeline/fix-bluesky-dangling-connector.mjs           (dry run)
//        node pipeline/fix-bluesky-dangling-connector.mjs --apply   (delete + repost)
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLongCaption } from "./long-caption.mjs";
import { buildLongCaption as buildPreFixCaption } from "./compat/pre-dangling-fix-long-caption.mjs";

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
    const oldText = buildPreFixCaption(card, MAX_GRAPHEMES);
    const newText = buildLongCaption(card, MAX_GRAPHEMES);
    if (oldText !== newText) {
      affected.push({ file: f, card, oldText, newText });
    }
  }

  console.log(`Found ${affected.length} live Bluesky post(s) affected by the dangling-connector bug.\n`);

  if (!apply) {
    for (const a of affected) {
      console.log(`--- ${a.file} ---`);
      console.log(`OLD: ${a.oldText.slice(-70)}`);
      console.log(`NEW: ${a.newText.slice(-70)}`);
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
      a.card.blueskyDanglingConnectorFixedAt = new Date().toISOString();
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
