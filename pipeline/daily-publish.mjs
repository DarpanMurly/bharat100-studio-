// Usage: node pipeline/daily-publish.mjs <scriptId> [YYYY-MM-DD]
// Renders the given script (assumes src/scripts/<scriptId>.json already
// exists — written by the daily research step) and moves the finished
// video + a review card into content-queue/pending/ for approval.
// The optional date argument sets card.date (the day this content is FOR,
// used by publish-to-buffer.mjs's scheduling and staleness checks) — pass
// tomorrow's date explicitly when generating a day ahead. Defaults to
// today if omitted, matching the original same-day behavior.

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildXCaption, buildThreadsCaption } from "./x-caption.mjs";
import { ensureDisclaimer } from "./disclaimer.mjs";
import { applyStyleRules } from "./style.mjs";
import { assertSafeToOverwrite } from "./guard-overwrite.mjs";
import { extractThumbnail } from "./extract-thumbnail.mjs";
import { cleanupOutFile, cleanupAudioScratch } from "./cleanup-render-artifacts.mjs";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const scriptId = process.argv[2];
  if (!scriptId) {
    console.error("Usage: node pipeline/daily-publish.mjs <scriptId>");
    process.exit(1);
  }

  const scriptPath = path.join(ROOT, "src", "scripts", `${scriptId}.json`);
  const script = JSON.parse(await fs.readFile(scriptPath, "utf-8"));

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = process.argv[3] ?? todayLocal;
  const queueDir = path.join(ROOT, "content-queue", "pending", `${today}_${scriptId}`);
  if (!process.argv.includes("--force")) {
    await assertSafeToOverwrite(queueDir);
  }

  console.log(`\n=== Daily publish: ${scriptId} ===`);

  await execFileAsync("node", [path.join(ROOT, "pipeline", "build.mjs"), scriptId], {
    cwd: ROOT,
  });

  const outPath = path.join(ROOT, "out", `${scriptId}.mp4`);
  const propsPath = path.join(ROOT, "public", scriptId, "props.json");
  await fs.writeFile(propsPath, JSON.stringify({ scriptId }), "utf-8");
  const renderCmd = `npx remotion render Bharat100 "${outPath}" "--props=${propsPath}"`;
  await execAsync(renderCmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  await fs.mkdir(queueDir, { recursive: true });

  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);
  await extractThumbnail(queueDir, "video.mp4", scriptId);
  await cleanupOutFile(outPath);
  // public/<scriptId>/ is unique per script (not shared across dates
  // like the other pillars' outDirs), so no filePrefix is needed — every
  // .mp3/.txt scratch file in it belongs to this one render.
  await cleanupAudioScratch(path.join(ROOT, "public", scriptId));

  // Hashtags are appended directly into the caption text (not kept as a
  // separate field) so there's exactly one block to copy per post.
  const hashtags = script.hashtags ?? [];
  const title = script.title ? applyStyleRules(script.title) : script.title;
  const baseCaption = ensureDisclaimer(script.caption ?? "");
  const fullCaption =
    hashtags.length > 0 ? `${baseCaption}\n\n${hashtags.join(" ")}` : baseCaption;
  const captionX = buildXCaption(title ?? baseCaption, hashtags, script.scenes ?? []);
  const captionThreads = buildThreadsCaption(fullCaption, title ?? baseCaption, hashtags);

  const card = {
    scriptId,
    // Legacy sector-video scripts have no explicit type — publish-to-buffer
    // and youtube-upload both fall back to "video" (7pm slot) when this is
    // undefined, so leave it unset unless a script opts into a distinct
    // slot (e.g. "diaspora-dividend") via its own JSON's "type" field.
    ...(script.type ? { type: script.type } : {}),
    title,
    pillar: script.pillar,
    date: today,
    sources: script.sources ?? [],
    caption: fullCaption || null,
    captionX,
    captionThreads,
    hashtags,
    videoFile: "video.mp4",
    videoPath: path
      .relative(path.resolve(ROOT, ".."), destVideo)
      .replace(/\\/g, "/"),
    thumbnailFile: "thumbnail.jpg",
    status: "pending",
    platforms: script.platforms ?? ["Instagram", "YouTube", "X", "Threads", "Facebook", "Mastodon", "Bluesky", "Pinterest"],
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued for approval: content-queue/pending/${today}_${scriptId}/`);
  console.log(`Doc id for dashboard: ${today}_${scriptId}`);
  console.log(`\n--- card.json (paste into Content Desk db) ---`);
  console.log(JSON.stringify(card, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
