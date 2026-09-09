// Usage: node pipeline/youtube-reset-thumbnail.mjs <date>_<id>
// One-off fixup: re-sets a custom thumbnail on a video that was already
// uploaded (has a real card.youtubeVideoId) with a stale thumbnail.jpg —
// e.g. after regenerating thumbnail.jpg via extract-thumbnail.mjs with
// the fixed frame-selection logic (2026-09-10) for content that was
// already uploaded before that fix landed. Does NOT touch the video
// itself or its scheduling — thumbnails.set() is a standalone API call.
import { google } from "googleapis";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(ROOT, "youtube-client-secret.json");
const TOKEN_PATH = path.join(ROOT, "youtube-token.json");

async function getAuthedClient() {
  const credentials = JSON.parse(await fsp.readFile(CREDENTIALS_PATH, "utf-8"));
  const token = JSON.parse(await fsp.readFile(TOKEN_PATH, "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  client.setCredentials(token);
  return client;
}

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fsp.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/youtube-reset-thumbnail.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fsp.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!card.youtubeVideoId) {
    console.error(`No youtubeVideoId on this card — nothing uploaded yet, use youtube-upload.mjs instead.`);
    process.exit(1);
  }
  if (!card.thumbnailFile) {
    console.error(`No thumbnailFile on this card.`);
    process.exit(1);
  }

  const auth = await getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });
  const thumbPath = path.join(queueDir, card.thumbnailFile);

  console.log(`Re-setting thumbnail for ${card.youtubeVideoId} (${card.youtubeUrl}), frame ${card.thumbnailFrame}...`);
  await youtube.thumbnails.set({
    videoId: card.youtubeVideoId,
    media: { body: fs.createReadStream(thumbPath) },
  });
  console.log(`Done.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
