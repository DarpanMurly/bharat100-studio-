// Usage: node pipeline/extract-thumbnail.mjs <date>_<id>
// Extracts a single deliberate frame from a queued video (frame 25 at
// 30fps = ~0.83s in — past every component's entrance animation, which
// all finish by frame ~18, so the frame always has fully-visible, non-
// blurred text) and saves it as thumbnail.jpg alongside video.mp4 in the
// same content-queue folder. Every current video format (VideoTemplate's
// Scene, MotivationalShort, OnThisDaySlide) renders its opening
// headline/hook text well within this window, so this one fixed frame
// number works universally rather than needing per-pillar tuning.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FPS = 30;
const THUMBNAIL_FRAME = 25;

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

export async function extractThumbnail(queueDir, videoFile = "video.mp4") {
  const videoPath = path.join(queueDir, videoFile);
  const thumbPath = path.join(queueDir, "thumbnail.jpg");
  const timestampSec = (THUMBNAIL_FRAME / FPS).toFixed(3);

  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", timestampSec,
    "-i", videoPath,
    "-frames:v", "1",
    "-q:v", "2", // high JPEG quality (ffmpeg's qscale: 2 = near-lossless)
    thumbPath,
  ]);

  return thumbPath;
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/extract-thumbnail.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const cardPath = path.join(queueDir, "card.json");
  const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));

  if (!card.videoFile) {
    console.error(`No videoFile on this card — nothing to extract a thumbnail from.`);
    process.exit(1);
  }

  const thumbPath = await extractThumbnail(queueDir, card.videoFile);
  console.log(`Thumbnail extracted: ${thumbPath}`);

  card.thumbnailFile = "thumbnail.jpg";
  await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
}

const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
