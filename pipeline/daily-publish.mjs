// Usage: node pipeline/daily-publish.mjs <scriptId>
// Renders the given script (assumes src/scripts/<scriptId>.json already
// exists — written by the daily research step) and moves the finished
// video + a review card into content-queue/pending/ for approval.

import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildXCaption, buildThreadsCaption } from "./x-caption.mjs";
import { ensureDisclaimer } from "./disclaimer.mjs";

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

  console.log(`\n=== Daily publish: ${scriptId} ===`);

  await execFileAsync("node", [path.join(ROOT, "pipeline", "build.mjs"), scriptId], {
    cwd: ROOT,
  });

  const outPath = path.join(ROOT, "out", `${scriptId}.mp4`);
  const propsPath = path.join(ROOT, "public", scriptId, "props.json");
  await fs.writeFile(propsPath, JSON.stringify({ scriptId }), "utf-8");
  const renderCmd = `npx remotion render Bharat100 "${outPath}" "--props=${propsPath}"`;
  await execAsync(renderCmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const queueDir = path.join(ROOT, "content-queue", "pending", `${today}_${scriptId}`);
  await fs.mkdir(queueDir, { recursive: true });

  const destVideo = path.join(queueDir, "video.mp4");
  await fs.copyFile(outPath, destVideo);

  // Hashtags are appended directly into the caption text (not kept as a
  // separate field) so there's exactly one block to copy per post.
  const hashtags = script.hashtags ?? [];
  const baseCaption = ensureDisclaimer(script.caption ?? "");
  const fullCaption =
    hashtags.length > 0 ? `${baseCaption}\n\n${hashtags.join(" ")}` : baseCaption;
  const captionX = buildXCaption(script.title ?? baseCaption, hashtags);
  const captionThreads = buildThreadsCaption(fullCaption, script.title ?? baseCaption, hashtags);

  const card = {
    scriptId,
    title: script.title,
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
    status: "pending",
    platforms: script.platforms ?? ["Instagram", "YouTube", "X", "Threads"],
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
