// Usage: node pipeline/youtube-delete-video.mjs <videoId>
// One-off cleanup tool: deletes a single YouTube video by ID. Added
// 2026-10-11 to remove a scheduled-but-not-yet-public video that was
// uploaded with a clipped-text rendering bug (MotivationalShort.tsx,
// fixed same day) before it went live, so it could be re-uploaded clean.
import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CREDENTIALS_PATH = path.join(ROOT, "youtube-client-secret.json");
const TOKEN_PATH = path.join(ROOT, "youtube-token.json");

async function getAuthedClient() {
  const credentials = JSON.parse(await fs.readFile(CREDENTIALS_PATH, "utf-8"));
  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  client.setCredentials(token);
  return client;
}

async function main() {
  const videoId = process.argv[2];
  if (!videoId) {
    console.error("Usage: node pipeline/youtube-delete-video.mjs <videoId>");
    process.exit(1);
  }

  const auth = await getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  await youtube.videos.delete({ id: videoId });
  console.log(`Deleted YouTube video: ${videoId}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
