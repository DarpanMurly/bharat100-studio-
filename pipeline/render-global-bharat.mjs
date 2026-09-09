// Usage: node pipeline/render-global-bharat.mjs <YYYY-MM-DD>
// Diaspora contributor spotlight — same slide format and TTS pipeline as
// render-on-this-day-short.mjs (reuses OnThisDayShort/OnThisDaySlide),
// just a different content directory and its own 6am IST slot, timed for
// US evening scroll time (see pipeline/slots.mjs). Content in
// public/global-bharat/<date>.json, same {theme, slides} shape as
// on-this-day.

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
import { extractThumbnail, ENTRANCE_OFFSET } from "./extract-thumbnail.mjs";
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
    console.error("Usage: node pipeline/render-global-bharat.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_global-bharat`);
  if (!process.argv.includes("--force")) {
    await assertSafeToOverwrite(queueDir);
  }

  const contentPath = path.join(ROOT, "public", "global-bharat", `${date}.json`);
  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));

  // Every video across every pillar ends on a dedicated follow/CTA
  // screen — append it here rather than requiring every day's
  // hand-written content JSON to remember to include one.
  content.slides = [...content.slides, { kind: "cta", headline: "Follow for more Global Bharat stories." }];

  const outDir = path.join(ROOT, "public", "global-bharat-short");
  await fs.mkdir(outDir, { recursive: true });

  console.log(`\n=== Global Bharat: ${date} (${content.slides.length} slides) ===`);

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

  // A slide's VISUAL hold is at least MIN_SLIDE_SEC even when its
  // narration is much shorter (e.g. a name read in ~2s) — the silence
  // gap after that clip must fill the rest of the hold, not a flat
  // SLIDE_PAUSE_SEC, or the next clip's narration starts playing while
  // the current slide is still on screen (confirmed as a real user-
  // reported bug on the Vinod Dham video, 2026-09-08 — same root cause
  // already fixed in render-weekly-recap.mjs the same day).
  const MIN_SLIDE_SEC = 4.5;
  // "Guess the Year" slides (slide.revealYear, see OnThisDaySlide.tsx)
  // withhold the year for a beat before it pops in — give those slides
  // extra hold time so there's a real moment to register the answer.
  const YEAR_REVEAL_EXTRA_SEC = 2;
  // The final CTA slide now shows the full 7-row PlatformHandles list
  // (2026-09-09, was a single 2-handle line) — needs real extra time to
  // read every row, not just MIN_SLIDE_SEC.
  const CTA_EXTRA_SEC = 3.5;
  const holds = durationsSec.map((d, i) => {
    const slide = content.slides[i];
    const extra = slide.revealYear ? YEAR_REVEAL_EXTRA_SEC : slide.kind === "cta" ? CTA_EXTRA_SEC : 0;
    return Math.max(d, MIN_SLIDE_SEC + extra);
  });

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

  // OnThisDayShortComposition's calculateMetadata expects content at
  // public/on-this-day/<contentId>.json and manifest at
  // public/on-this-day-short/<contentId>.json — reuse it via a
  // "gb-" prefixed contentId so this never collides with that day's own
  // On This Day short, without needing a new Remotion composition.
  const contentId = `gb-${date}`;
  await fs.writeFile(
    path.join(ROOT, "public", "on-this-day", `${contentId}.json`),
    JSON.stringify(content, null, 2),
    "utf-8"
  );

  const manifest = {
    audioFile: `global-bharat-short/${date}.mp3`,
    timings,
    totalDurationInFrames,
    fps: FPS,
  };
  await fs.writeFile(
    path.join(ROOT, "public", "on-this-day-short", `${contentId}.json`),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  console.log(`Total video: ${(totalDurationInFrames / FPS).toFixed(1)}s`);

  const outPath = path.join(ROOT, "out", `global-bharat_${date}.mp4`);
  const propsPath = path.join(outDir, `${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId, seriesLabel: "Global Bharat" }), "utf-8");

  const cmd = `npx remotion render OnThisDayShort "${outPath}" "--props=${propsPath}"`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  await fs.mkdir(queueDir, { recursive: true });
  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);
  // Prefer a plain (already-visible) year slide over a revealYear one —
  // a revealYear slide's year is hidden until frame 45
  // (YEAR_REVEAL_DELAY_FRAMES in OnThisDaySlide.tsx), so grabbing it at
  // the usual offset would capture the slide before its payoff appears.
  const plainYearIndex = content.slides.findIndex((s) => s.year && !s.revealYear);
  const revealYearIndex = content.slides.findIndex((s) => s.year && s.revealYear);
  let thumbFrame = null;
  if (plainYearIndex !== -1 && timings[plainYearIndex]) {
    thumbFrame = timings[plainYearIndex].startFrame + ENTRANCE_OFFSET;
  } else if (revealYearIndex !== -1 && timings[revealYearIndex]) {
    thumbFrame = timings[revealYearIndex].startFrame + 45 + 10; // past the reveal pop-in
  }
  const { frame: thumbnailFrame } = await extractThumbnail(queueDir, "video.mp4", null, thumbFrame);
  await cleanupOutFile(outPath);
  await cleanupAudioScratch(outDir, date);

  const coverSlide = content.slides[0];
  const hashtags = ["#Bharat100", "#GlobalBharat", "#IndianDiaspora", "#NRI", "#India2047", "#ViksitBharat"];
  const caption = applyStyleRules(`${coverSlide.headline}\n\n${content.slides
    .slice(1)
    .map((s) => s.body)
    .filter(Boolean)
    .join("\n\n")}\n\n${CROSS_PLATFORM_CTA_FROM_INSTAGRAM}\n\n${DISCLAIMER}\n\n${hashtags.join(" ")}`);
  const captionX = applyStyleRules(buildXCaption(coverSlide.headline, hashtags));
  const captionThreads = applyStyleRules(buildThreadsCaption(caption, coverSlide.headline, hashtags));
  const captionYoutube = applyStyleRules(`${coverSlide.headline}\n\n${CROSS_PLATFORM_CTA_FROM_YOUTUBE}\n\n${DISCLAIMER}\n\n#Shorts ${hashtags.join(" ")}`);

  const card = {
    type: "global-bharat",
    title: applyStyleRules(coverSlide.headline),
    pillar: "Global Bharat",
    date,
    sources: content.sources ?? [],
    caption,
    captionX,
    captionThreads,
    captionYoutube,
    videoFile: "video.mp4",
    videoPath: path.relative(path.resolve(ROOT, ".."), destVideo).replace(/\\/g, "/"),
    thumbnailFile: "thumbnail.jpg",
    thumbnailFrame,
    status: "pending",
    platforms: ["Instagram", "YouTube", "X", "Threads", "Facebook", "Mastodon", "Bluesky", "Pinterest"],
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued: content-queue/pending/${date}_global-bharat/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
