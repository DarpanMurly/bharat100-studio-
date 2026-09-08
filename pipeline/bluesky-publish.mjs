// Usage: node pipeline/bluesky-publish.mjs <date>_<id>
// Publishes the approved card to Bluesky via the AT Protocol API.
// No OAuth, no app review, no Business Verification — completely free
// and unlike every other platform in this pipeline, there is no approval
// gate at all. Requires BLUESKY_HANDLE and BLUESKY_APP_PASSWORD in .env
// (an App Password, generated at bsky.app -> Settings -> App Passwords —
// never use the real account password here).
//
// Bluesky has NO native post-scheduling feature — every post via the API
// goes live immediately. This project's other platforms (Buffer, YouTube,
// Facebook) all support a future publish time so every platform goes live
// at the same slot instant; Bluesky can't do that natively. The workaround
// here is the same "call this script exactly at the slot time" pattern —
// this script does not accept a future date and publish later, it posts
// NOW, so it must be invoked (e.g. via a scheduled task) at the actual
// slot time, not at approval time like the other publish scripts.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HANDLE = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;
const SERVICE = "https://bsky.social";

// Bluesky's own hard cap per post — well under this project's captions,
// which are already trimmed for X's 280-char limit elsewhere.
const MAX_GRAPHEMES = 300;

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

async function createSession() {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Bluesky login failed: ${json.message ?? json.error}`);
  return json; // { accessJwt, did, handle, ... }
}

async function createPost(session, text) {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
      },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Bluesky post failed: ${json.message ?? json.error}`);
  return json; // { uri, cid }
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/bluesky-publish.mjs <date>_<id>");
    process.exit(1);
  }
  if (!HANDLE || !APP_PASSWORD) {
    console.error("Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD in .env.");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!(card.platforms ?? []).includes("Bluesky")) {
    console.log(`Skipping Bluesky — "Bluesky" not in this card's platforms list.`);
    return;
  }

  // X's caption is already the shortest, hashtag-light version this
  // project produces — the best fit for Bluesky's 300-grapheme cap and
  // its lighter hashtag culture, rather than the full Instagram caption.
  let text = card.captionX ?? card.caption ?? "";
  if (text.length > MAX_GRAPHEMES) {
    text = text.slice(0, MAX_GRAPHEMES - 1) + "…";
  }

  console.log(`\n=== Publishing "${card.title}" to Bluesky (@${HANDLE}) ===`);

  const session = await createSession();
  const result = await createPost(session, text);

  console.log(`Posted:`, result.uri);

  card.blueskyPostUri = result.uri;
  card.blueskyPostedAt = new Date().toISOString();
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
