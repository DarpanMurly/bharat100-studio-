// Usage: node pipeline/render-motivational.mjs <YYYY-MM-DD>
// Reads public/motivational/<date>.json and renders the daily thought-of-
// the-day image, then copies it into content-queue/pending/ for approval.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildXCaption, buildThreadsCaption } from "./x-caption.mjs";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/render-motivational.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const contentPath = path.join(ROOT, "public", "motivational", `${date}.json`);
  await fs.access(contentPath); // throws if missing — fail loud, not silent

  const outPath = path.join(ROOT, "out", `motivational_${date}.jpeg`);
  const propsPath = path.join(ROOT, "public", "motivational", `${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId: date }), "utf-8");

  console.log(`\n=== Motivational post: ${date} ===`);
  const cmd = `npx remotion still Motivational "${outPath}" "--props=${propsPath}" --overwrite`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_motivational`);
  await fs.mkdir(queueDir, { recursive: true });
  const destImage = path.join(queueDir, "image.jpeg");
  await fs.copyFile(outPath, destImage);

  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));
  const hashtags = ["#Bharat100", "#ThoughtOfTheDay", "#India2047", "#Motivation", "#ViksitBharat"];
  const caption = `${content.thought}\n\n${content.support}\n\n${hashtags.join(" ")}`;
  const captionX = buildXCaption(content.thought, hashtags);
  const captionThreads = buildThreadsCaption(caption, content.thought, hashtags);

  const card = {
    type: "motivational",
    title: content.thought.slice(0, 60) + (content.thought.length > 60 ? "..." : ""),
    pillar: "Personal Growth",
    date,
    caption,
    captionX,
    captionThreads,
    imageFile: "image.jpeg",
    imagePath: path.relative(path.resolve(ROOT, ".."), destImage).replace(/\\/g, "/"),
    status: "pending",
    platforms: ["Instagram", "YouTube", "X", "Threads"],
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued: content-queue/pending/${date}_motivational/`);
  console.log(`Doc id for dashboard: ${date}_motivational`);
  console.log(`\n--- card.json ---`);
  console.log(JSON.stringify(card, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
