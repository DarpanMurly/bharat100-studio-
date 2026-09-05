// Usage: node pipeline/youtube-upload.mjs <date>_<id>
// Uploads the approved video at content-queue/(approved|pending)/<id>/video.mp4
// to YouTube. Requires youtube-auth.mjs to have been run once already.
//
// First real upload (2026-09-05) landed as Public immediately, despite the
// unaudited-client private-lock policy we expected — the compliance audit
// may not be strictly required at this account's current scale, or Google
// hasn't flagged this project. The fallback check below still logs a note
// if a future upload ever does land private, so nothing silently changes.

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
    console.error("Usage: node pipeline/youtube-upload.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fsp.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (card.status !== "approved" && card.status !== "scheduled") {
    console.error(`Refusing to upload: card status is "${card.status}", not "approved".`);
    process.exit(1);
  }

  if (!card.videoFile) {
    console.error(`No videoFile on this card — YouTube upload only applies to sector videos, not images/carousels.`);
    process.exit(1);
  }

  const videoPath = path.join(queueDir, card.videoFile);
  const auth = await getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  console.log(`\n=== Uploading "${card.title}" to YouTube ===`);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        // youtubeTitle (when present) is the clean, untruncated-by-preview
        // title meant for actual publishing; card.title can be a shortened
        // internal preview string (e.g. already ending in "...") that must
        // never be truncated a second time here.
        title: (card.youtubeTitle ?? card.title).slice(0, 100),
        // #Shorts must appear in the description/title for YouTube to
        // reliably classify the upload as a Short even though duration +
        // aspect ratio should be enough on their own.
        description: card.captionYoutube ?? card.caption ?? "",
        tags: (card.hashtags ?? []).map((h) => h.replace(/^#/, "")),
        categoryId: "25", // News & Politics
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;
  console.log(`\nUploaded: https://youtube.com/watch?v=${videoId}`);

  if (res.data.status?.privacyStatus !== "public") {
    console.log(
      `\nNote: video landed as "${res.data.status?.privacyStatus}" — this is expected until the compliance audit is approved. Switch it to Public manually in YouTube Studio.`
    );
  }

  card.youtubeVideoId = videoId;
  card.youtubeUrl = `https://youtube.com/watch?v=${videoId}`;
  await fsp.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
