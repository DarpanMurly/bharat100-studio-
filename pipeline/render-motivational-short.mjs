// Usage: node pipeline/render-motivational-short.mjs <YYYY-MM-DD>
// Reads public/motivational/<date>.json and renders a ~20-25s vertical
// video: narrated thought + support line, single scene. This IS the
// primary motivational asset — posted simultaneously to all four
// platforms (Instagram as a Reel, Threads, X, and YouTube as a Short)
// via pipeline/publish-all.mjs, not just YouTube.

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";
import { normalizeForSpeech } from "./normalize.mjs";
import { buildXCaption, buildThreadsCaption } from "./x-caption.mjs";
import { DISCLAIMER, CROSS_PLATFORM_CTA_FROM_INSTAGRAM, CROSS_PLATFORM_CTA_FROM_YOUTUBE } from "./disclaimer.mjs";
import { applyStyleRules } from "./style.mjs";
import { assertSafeToOverwrite } from "./guard-overwrite.mjs";
import { extractThumbnail } from "./extract-thumbnail.mjs";
import { cleanupOutFile, cleanupAudioScratch } from "./cleanup-render-artifacts.mjs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const FPS = 30;
// Reserves time past the narration's own length for the end-card CTA
// (see MotivationalShort.tsx, which fades it in over the final ~2s).
const TAIL_SEC = 2.5;

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/render-motivational-short.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_motivational-short`);
  if (!process.argv.includes("--force")) {
    await assertSafeToOverwrite(queueDir);
  }

  const contentPath = path.join(ROOT, "public", "motivational", `${date}.json`);
  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));

  const outDir = path.join(ROOT, "public", "motivational-short");
  await fs.mkdir(outDir, { recursive: true });

  const narrationText = normalizeForSpeech(`${content.thought} ${content.support}`);
  const audioPath = path.join(outDir, `${date}.mp3`);

  console.log(`\n=== Motivational Short: ${date} ===`);
  console.log(`Narrating: "${narrationText.slice(0, 70)}..."`);

  await execFileAsync("python", [
    "-m", "edge_tts", "--voice", "en-IN-NeerjaExpressiveNeural",
    "--text", narrationText, "--write-media", audioPath,
  ]);

  const meta = await parseFile(audioPath);
  const durationSec = meta.format.duration ?? 15;
  const totalDurationInFrames = Math.round((durationSec + TAIL_SEC) * FPS);

  const manifest = {
    audioFile: `motivational-short/${date}.mp3`,
    totalDurationInFrames,
    fps: FPS,
  };
  await fs.writeFile(path.join(outDir, `${date}.json`), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`Narration: ${durationSec.toFixed(1)}s, total video: ${(totalDurationInFrames / FPS).toFixed(1)}s`);

  const outPath = path.join(ROOT, "out", `motivational-short_${date}.mp4`);
  const propsPath = path.join(outDir, `${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId: date }), "utf-8");

  const cmd = `npx remotion render MotivationalShort "${outPath}" "--props=${propsPath}"`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  await fs.mkdir(queueDir, { recursive: true });
  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);
  await extractThumbnail(queueDir);
  await cleanupOutFile(outPath);
  await cleanupAudioScratch(outDir, date);

  const thought = applyStyleRules(content.thought);
  const support = applyStyleRules(content.support);
  const hashtags = ["#Bharat100", "#ThoughtOfTheDay", "#India2047", "#Motivation", "#ViksitBharat"];
  const caption = `${thought}\n\n${support}\n\n${CROSS_PLATFORM_CTA_FROM_INSTAGRAM}\n\n${DISCLAIMER}\n\n${hashtags.join(" ")}`;
  const captionX = applyStyleRules(buildXCaption(thought, hashtags));
  const captionThreads = applyStyleRules(buildThreadsCaption(caption, thought, hashtags));
  const captionYoutube = `${thought}\n\n${CROSS_PLATFORM_CTA_FROM_YOUTUBE}\n\n${DISCLAIMER}\n\n#Shorts ${hashtags.join(" ")}`;

  const card = {
    type: "motivational-short",
    title: thought.slice(0, 60) + (thought.length > 60 ? "..." : ""),
    // Separate from the internal preview `title` above - this is what
    // actually appears as the YouTube video's title, so it must never
    // carry a "..." that isn't a real truncation of THIS exact string.
    youtubeTitle: thought.length > 100 ? thought.slice(0, 97) + "..." : thought,
    pillar: "Personal Growth",
    date,
    caption,
    captionX,
    captionThreads,
    captionYoutube,
    videoFile: "video.mp4",
    videoPath: path.relative(path.resolve(ROOT, ".."), destVideo).replace(/\\/g, "/"),
    thumbnailFile: "thumbnail.jpg",
    status: "pending",
    platforms: ["Instagram", "YouTube", "X", "Threads"],
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued: content-queue/pending/${date}_motivational-short/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
