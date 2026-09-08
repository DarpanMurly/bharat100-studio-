// Usage: node pipeline/youtube-go-public.mjs <date>_<id>
// Flips a private YouTube video (with youtubeVideoId already set) to
// public. Used for videos that can't rely on the native publishAt
// scheduling — e.g. because they were briefly public before being pulled
// back to private, which invalidates publishAt on YouTube's side.
import { google } from "googleapis";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function getAuthedClient() {
  const credentials = JSON.parse(await fsp.readFile(path.join(ROOT, "youtube-client-secret.json"), "utf-8"));
  const token = JSON.parse(await fsp.readFile(path.join(ROOT, "youtube-token.json"), "utf-8"));
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
    } catch {}
  }
  throw new Error(`No queue folder found for "${postId}"`);
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/youtube-go-public.mjs <date>_<id>");
    process.exit(1);
  }
  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fsp.readFile(path.join(queueDir, "card.json"), "utf-8"));
  if (!card.youtubeVideoId) {
    console.error(`No youtubeVideoId on this card.`);
    process.exit(1);
  }

  const auth = await getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });
  await youtube.videos.update({
    part: ["status"],
    requestBody: {
      id: card.youtubeVideoId,
      status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
    },
  });

  card.youtubePrivacyStatus = "public";
  await fsp.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
  console.log(`${postId}: https://youtube.com/watch?v=${card.youtubeVideoId} is now public.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
