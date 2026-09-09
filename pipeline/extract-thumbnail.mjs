// Usage: node pipeline/extract-thumbnail.mjs <date>_<id>
// Extracts a single deliberate frame from a queued video and saves it as
// thumbnail.jpg alongside video.mp4 in the same content-queue folder.
//
// Default fallback is frame 25 (30fps = ~0.83s in — past every
// component's entrance animation, which all finish by frame ~18, so the
// frame always has fully-visible, non-blurred text).
//
// BUT: for sector videos (VideoTemplate/Scene.tsx), the stat scene's
// number renders at 172px vs. the hook scene's 84px headline — a much
// stronger, more discoverable thumbnail. Same for on-this-day content
// (OnThisDaySlide.tsx), where a slide with slide.year renders it at
// 120px vs. the 60-74px headline. When timings.json + the script JSON
// are available, this picks the first such "big number" scene's frame
// (its own startFrame + 20, past ITS entrance animation) instead of the
// fixed fallback. MotivationalShort has no bigger competing element
// (82px is already its biggest), so it always uses the fallback frame.
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
export const ENTRANCE_OFFSET = 20; // frames into a scene, past its ~18-frame entrance spring

async function pickBigNumberFrame(scriptId) {
  try {
    const timingsPath = path.join(ROOT, "public", scriptId, "timings.json");
    const scriptPath = path.join(ROOT, "src", "scripts", `${scriptId}.json`);
    const [timingsRaw, scriptRaw] = await Promise.all([
      fs.readFile(timingsPath, "utf-8"),
      fs.readFile(scriptPath, "utf-8"),
    ]);
    const { timings } = JSON.parse(timingsRaw);
    const script = JSON.parse(scriptRaw);
    const scenes = script.scenes ?? [];

    // Sector videos: first scene with kind "stat" (172px number).
    const statIndex = scenes.findIndex((s) => s.kind === "stat");
    if (statIndex !== -1 && timings[statIndex]) {
      return timings[statIndex].startFrame + ENTRANCE_OFFSET;
    }

    // On-this-day slides: first slide with a year (120px number).
    const slides = script.slides ?? scenes;
    const yearIndex = slides.findIndex((s) => s.year);
    if (yearIndex !== -1 && timings[yearIndex]) {
      return timings[yearIndex].startFrame + ENTRANCE_OFFSET;
    }

    return null;
  } catch {
    // No timings.json/script JSON (e.g. non-video card, or files already
    // cleaned up) — fall back to the fixed frame.
    return null;
  }
}

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

export async function extractThumbnail(queueDir, videoFile = "video.mp4", scriptId = null, frameOverride = null) {
  const videoPath = path.join(queueDir, videoFile);
  const thumbPath = path.join(queueDir, "thumbnail.jpg");
  const frame = frameOverride ?? (scriptId ? await pickBigNumberFrame(scriptId) : null) ?? THUMBNAIL_FRAME;
  const timestampSec = (frame / FPS).toFixed(3);

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

  const thumbPath = await extractThumbnail(queueDir, card.videoFile, card.scriptId);
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
