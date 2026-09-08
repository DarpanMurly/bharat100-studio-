// Usage: node pipeline/render-on-this-day-short.mjs <YYYY-MM-DD>
// Reads public/on-this-day/<date>.json and renders a ~25-35s vertical
// video: each slide narrated in sequence, same visual design as the
// carousel (OnThisDaySlide, heritage theme). This IS the primary On This
// Day asset — posted simultaneously to all four platforms (Instagram as
// a Reel, Threads, X, and YouTube as a Short) via publish-all.mjs.

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
const SLIDE_PAUSE_SEC = 0.4;
const TAIL_SEC = 1.5;

async function narrate(text, outPath) {
  await execFileAsync("python", [
    "-m", "edge_tts", "--voice", "en-IN-NeerjaExpressiveNeural",
    "--text", text, "--write-media", outPath,
  ]);
  const meta = await parseFile(outPath);
  return meta.format.duration ?? 3;
}

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/render-on-this-day-short.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_on-this-day-short`);
  if (!process.argv.includes("--force")) {
    await assertSafeToOverwrite(queueDir);
  }

  const contentPath = path.join(ROOT, "public", "on-this-day", `${date}.json`);
  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));

  // Every video across every pillar ends on a dedicated follow/CTA
  // screen, not just the sector-video pipeline's outroCta scene — append
  // it here rather than requiring every day's hand-written content JSON
  // to remember to include one.
  content.slides = [...content.slides, { kind: "cta", headline: "Follow for tomorrow's story." }];

  const outDir = path.join(ROOT, "public", "on-this-day-short");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n=== On This Day Short: ${date} (${content.slides.length} slides) ===`);

  // Headline only, not the full body — a Short needs to move fast. The
  // carousel's full narration (headline + body per slide) runs 75s+, well
  // past the 15-30s window that actually performs as a Short.
  const durationsSec = [];
  const clipPaths = [];
  for (let i = 0; i < content.slides.length; i++) {
    const slide = content.slides[i];
    const text = normalizeForSpeech(slide.headline);
    const clipPath = path.join(outDir, `${date}_clip_${i}.mp3`);
    process.stdout.write(`  [${i + 1}/${content.slides.length}] narrating: "${text.slice(0, 50)}..." `);
    const dur = await narrate(text, clipPath);
    durationsSec.push(dur);
    clipPaths.push(clipPath);
    console.log(`${dur.toFixed(2)}s`);
  }

  // Narration is headline-only (fast), but each slide's body text still
  // needs real time on screen to be read — hold every slide at least
  // MIN_SLIDE_SEC regardless of how short its narration clip is. The
  // silence gap after each clip must fill the REST of that slide's hold,
  // not a flat SLIDE_PAUSE_SEC, or the next clip's narration starts
  // playing while the current slide is still on screen (confirmed as a
  // real user-reported bug on the Vinod Dham video, 2026-09-08 — same
  // root cause already fixed in render-weekly-recap.mjs the same day).
  const MIN_SLIDE_SEC = 4.5;
  const holds = durationsSec.map((d) => Math.max(d, MIN_SLIDE_SEC));

  const concatListPath = path.join(outDir, `${date}_concat.txt`);
  const concatLines = [];
  for (let i = 0; i < clipPaths.length; i++) {
    concatLines.push(`file '${path.basename(clipPaths[i])}'`);
    const gapSec = Math.max(0.05, holds[i] - durationsSec[i] + SLIDE_PAUSE_SEC);
    const gapPath = path.join(outDir, `${date}_gap_${i}.mp3`);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
      "-t", gapSec.toFixed(3), "-q:a", "9", gapPath,
    ]);
    concatLines.push(`file '${path.basename(gapPath)}'`);
  }
  await fs.writeFile(concatListPath, concatLines.join("\n"), "utf-8");

  const audioPath = path.join(outDir, `${date}.mp3`);
  await execFileAsync("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", audioPath,
  ]);

  const timings = [];
  let cursorSec = 0;
  for (let i = 0; i < durationsSec.length; i++) {
    const startFrame = Math.round(cursorSec * FPS);
    const isLast = i === durationsSec.length - 1;
    const durationInFrames = Math.round((holds[i] + (isLast ? TAIL_SEC : SLIDE_PAUSE_SEC)) * FPS);
    timings.push({ startFrame, durationInFrames });
    cursorSec += holds[i] + SLIDE_PAUSE_SEC;
  }
  const totalDurationInFrames = timings[timings.length - 1].startFrame + timings[timings.length - 1].durationInFrames;

  const manifest = {
    audioFile: `on-this-day-short/${date}.mp3`,
    timings,
    totalDurationInFrames,
    fps: FPS,
  };
  await fs.writeFile(path.join(outDir, `${date}.json`), JSON.stringify(manifest, null, 2), "utf-8");

  console.log(`Total video: ${(totalDurationInFrames / FPS).toFixed(1)}s`);

  const outPath = path.join(ROOT, "out", `on-this-day-short_${date}.mp4`);
  const propsPath = path.join(outDir, `${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId: date }), "utf-8");

  const cmd = `npx remotion render OnThisDayShort "${outPath}" "--props=${propsPath}"`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  await fs.mkdir(queueDir, { recursive: true });
  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);
  await extractThumbnail(queueDir);
  await cleanupOutFile(outPath);
  await cleanupAudioScratch(outDir, date);

  const coverSlide = content.slides[0];
  const hashtags = ["#Bharat100", "#OnThisDay", "#IndianHistory", "#India2047", "#ViksitBharat"];
  const caption = applyStyleRules(`${coverSlide.headline}\n\n${content.slides
    .slice(1)
    .map((s) => s.body)
    .filter(Boolean)
    .join("\n\n")}\n\n${CROSS_PLATFORM_CTA_FROM_INSTAGRAM}\n\n${DISCLAIMER}\n\n${hashtags.join(" ")}`);
  const captionX = applyStyleRules(buildXCaption(coverSlide.headline, hashtags));
  const captionThreads = applyStyleRules(buildThreadsCaption(caption, coverSlide.headline, hashtags));
  const captionYoutube = applyStyleRules(`${coverSlide.headline}\n\n${CROSS_PLATFORM_CTA_FROM_YOUTUBE}\n\n${DISCLAIMER}\n\n#Shorts ${hashtags.join(" ")}`);

  const card = {
    type: "on-this-day-short",
    title: applyStyleRules(coverSlide.headline),
    pillar: "Builder Story",
    date,
    // content.sources is optional in public/on-this-day/<date>.json — add
    // it there when writing the research (an array of "Source, date -
    // claim verified" strings, same shape as the sector-video scripts'
    // sources field) so the public archive can show real citations, not
    // just an unsourced historical claim.
    sources: content.sources ?? [],
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

  console.log(`\nQueued: content-queue/pending/${date}_on-this-day-short/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
