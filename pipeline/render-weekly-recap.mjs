// Usage: node pipeline/render-weekly-recap.mjs <YYYY-MM-DD>
// Builds a 4th weekly content package with ZERO new research or writing:
// it scans content-queue/pending/*/card.json for the 7 days ending the
// day before <date> and turns their already-approved titles into a
// recap video, reusing the OnThisDayShort composition and OnThisDaySlide
// component so it looks/sounds like the rest of the daily output.
// Goes through the exact same review-queue -> approve-and-publish flow
// as the other three packages — this does not bypass approval.

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
const MIN_SLIDE_SEC = 4.5;

function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// Scans the 7 days ending the day before `date` (so a recap generated
// for the same day-ahead date as the other 3 packages covers the week
// that just finished, not an empty/partial week including itself).
async function collectWeekCards(date) {
  const days = [];
  for (let i = 7; i >= 1; i--) days.push(addDays(date, -i));

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const allDirs = await fs.readdir(pendingDir);
  const cards = [];
  for (const day of days) {
    const matches = allDirs.filter((d) => d.startsWith(`${day}_`));
    for (const dir of matches) {
      try {
        const card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
        if (card.status === "cancelled" || card.status === "rejected") continue;
        // Never fold a previous week's recap into this week's recap — it
        // would recursively summarize a summary instead of the week's
        // actual stories.
        if (card.type === "weekly-recap") continue;
        cards.push({ dir, day, card });
      } catch {
        // no card.json or unreadable, skip
      }
    }
  }

  // A "-short" video and its legacy still-image counterpart (same day,
  // same pillar: "motivational" + "motivational-short", "on-this-day" +
  // "on-this-day-short") are the SAME story in two formats, not two
  // stories — keep only the video version so the recap doesn't double-list
  // the same headline.
  const LEGACY_OF_SHORT = { "motivational-short": "motivational", "on-this-day-short": "on-this-day" };
  const shortDayKeys = new Set(
    cards.filter((c) => LEGACY_OF_SHORT[c.card.type]).map((c) => `${c.day}:${LEGACY_OF_SHORT[c.card.type]}`)
  );
  return cards.filter((c) => !shortDayKeys.has(`${c.day}:${c.card.type}`));
}

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
    console.error("Usage: node pipeline/render-weekly-recap.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_weekly-recap`);
  if (!process.argv.includes("--force")) {
    await assertSafeToOverwrite(queueDir);
  }

  const weekCards = await collectWeekCards(date);
  if (weekCards.length === 0) {
    console.error(`No content found in the 7 days before ${date} - nothing to recap.`);
    process.exit(1);
  }
  console.log(`\n=== Weekly Recap: ${date} (${weekCards.length} posts from the past week) ===`);

  const outDir = path.join(ROOT, "public", "weekly-recap");
  await fs.mkdir(outDir, { recursive: true });

  // card.title is sometimes a pre-truncated "..." preview string not meant
  // for display elsewhere (see youtube-upload.mjs's own note on this same
  // gotcha). The full caption's first paragraph is always the real,
  // untruncated headline regardless of card type, so prefer that.
  const headlines = weekCards.map((c) => {
    const fromCaption = (c.card.caption ?? "").split("\n\n")[0]?.trim();
    const clean = fromCaption || c.card.youtubeTitle || c.card.title || "";
    return applyStyleRules(clean);
  });

  const slides = [
    {
      kind: "cover",
      eyebrow: "Weekly Recap",
      headline: `This week in India's growth story.`,
    },
    {
      kind: "recap-list",
      eyebrow: "What we covered",
      headline: `${weekCards.length} stories, one week.`,
      listItems: headlines,
    },
    {
      kind: "closer",
      eyebrow: "Why it matters for Viksit Bharat 2047",
      headline: "Every week adds another piece.",
      body: "None of these stories are the whole picture on their own - the picture is what they add up to, one week at a time, for the next 20 years.",
    },
    {
      kind: "cta",
      headline: "Follow for next week's stories.",
    },
  ];

  console.log(`Slides: cover, recap list (${headlines.length} items), closer, cta`);

  // The list slide is NOT narrated in full (9 headlines read aloud runs
  // 50s+, far past the Shorts sweet spot) — same principle as the daily
  // On This Day short, which narrates headline-only and lets body text be
  // visual-only. Here the whole list is visual-only; narration is just a
  // short pointer to it, matching the on-screen hold time instead of
  // driving it.
  const narrationTexts = [
    normalizeForSpeech(slides[0].headline),
    normalizeForSpeech(`This week, ${headlines.length} stories - scroll to see all of them.`),
    normalizeForSpeech(slides[2].headline + ". " + slides[2].body),
    normalizeForSpeech(slides[3].headline),
  ];

  const durationsSec = [];
  const clipPaths = [];
  for (let i = 0; i < narrationTexts.length; i++) {
    const clipPath = path.join(outDir, `${date}_clip_${i}.mp3`);
    process.stdout.write(`  [${i + 1}/${narrationTexts.length}] narrating... `);
    const dur = await narrate(narrationTexts[i], clipPath);
    durationsSec.push(dur);
    clipPaths.push(clipPath);
    console.log(`${dur.toFixed(2)}s`);
  }

  // The recap-list slide needs longer on screen than its narration to let
  // viewers actually read every headline — hold it based on item count,
  // not narration length. Every other slide holds at least MIN_SLIDE_SEC.
  // These holds drive BOTH the video timings and the audio track below —
  // computing them once, up front, is what keeps narration in sync with
  // the slide it belongs to (previously the audio used a flat 0.4s gap
  // between clips regardless of how long the video actually held the
  // list slide, so the closer's narration started playing while the
  // list slide was still on screen).
  const listHoldSec = Math.max(durationsSec[1], 3 + headlines.length * 1.6);
  const holds = [
    Math.max(durationsSec[0], MIN_SLIDE_SEC),
    listHoldSec,
    Math.max(durationsSec[2], MIN_SLIDE_SEC),
    Math.max(durationsSec[3], MIN_SLIDE_SEC),
  ];

  // Build one silence clip per gap, sized to fill exactly what's left of
  // that slide's hold time after its own narration finishes — not a flat
  // pause — so clip i+1 always starts exactly when slide i+1 begins.
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
  for (let i = 0; i < holds.length; i++) {
    const startFrame = Math.round(cursorSec * FPS);
    const isLast = i === holds.length - 1;
    const durationInFrames = Math.round((holds[i] + (isLast ? TAIL_SEC : SLIDE_PAUSE_SEC)) * FPS);
    timings.push({ startFrame, durationInFrames });
    cursorSec += holds[i] + SLIDE_PAUSE_SEC;
  }
  const totalDurationInFrames = timings[timings.length - 1].startFrame + timings[timings.length - 1].durationInFrames;

  // OnThisDayShortComposition's calculateMetadata always looks for
  // public/on-this-day/<contentId>.json (content) and
  // public/on-this-day-short/<contentId>.json (manifest) — use a
  // "-recap" suffixed contentId so this never collides with that day's
  // own On This Day short, without needing a new composition.
  const contentId = `${date}-recap`;
  const contentJson = { theme: "heritage", slides };
  await fs.writeFile(
    path.join(ROOT, "public", "on-this-day", `${contentId}.json`),
    JSON.stringify(contentJson, null, 2),
    "utf-8"
  );

  const manifest = {
    audioFile: `weekly-recap/${date}.mp3`,
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

  const outPath = path.join(ROOT, "out", `weekly-recap_${date}.mp4`);
  const propsPath = path.join(outDir, `${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId }), "utf-8");

  const cmd = `npx remotion render OnThisDayShort "${outPath}" "--props=${propsPath}"`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  await fs.mkdir(queueDir, { recursive: true });
  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);
  await extractThumbnail(queueDir);
  await cleanupOutFile(outPath);
  await cleanupAudioScratch(outDir, date);

  const hashtags = ["#Bharat100", "#WeeklyRecap", "#India2047", "#ViksitBharat", "#IndiaGrowthStory"];
  const summaryLine = `This week in India's growth story: ${headlines.length} stories covering history, sectors and mindset.`;
  const caption = applyStyleRules(
    `${summaryLine}\n\n${headlines.map((h, i) => `${i + 1}. ${h}`).join("\n")}\n\n${CROSS_PLATFORM_CTA_FROM_INSTAGRAM}\n\n${DISCLAIMER}\n\n${hashtags.join(" ")}`
  );
  const captionX = applyStyleRules(buildXCaption(summaryLine, hashtags));
  const captionThreads = applyStyleRules(buildThreadsCaption(caption, summaryLine, hashtags));
  const captionYoutube = applyStyleRules(
    `${summaryLine}\n\n${CROSS_PLATFORM_CTA_FROM_YOUTUBE}\n\n${DISCLAIMER}\n\n#Shorts ${hashtags.join(" ")}`
  );

  const card = {
    type: "weekly-recap",
    title: "This week in India's growth story.",
    pillar: "Weekly Recap",
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
    sourcePostIds: weekCards.map((c) => c.dir),
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued: content-queue/pending/${date}_weekly-recap/`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
