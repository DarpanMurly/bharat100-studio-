// Usage: node pipeline/render-on-this-day.mjs <YYYY-MM-DD>
// Reads public/on-this-day/<date>.json and renders every slide as a
// separate image, then copies the set into content-queue/pending/ as a
// carousel for approval.

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
    console.error("Usage: node pipeline/render-on-this-day.mjs <YYYY-MM-DD>");
    process.exit(1);
  }

  const contentPath = path.join(ROOT, "public", "on-this-day", `${date}.json`);
  await fs.access(contentPath);
  const content = JSON.parse(await fs.readFile(contentPath, "utf-8"));

  // "heritage" is the standing theme for every On This Day post — kept
  // visually distinct from the sector-video theme rotation (saffron/teal/
  // gold) so the two formats never look interchangeable. Enforced here,
  // not just documented, so a stray value in the content JSON can't
  // silently drift the series off-brand.
  if (content.theme !== "heritage") {
    console.log(`  Note: overriding theme "${content.theme}" -> "heritage" (standing convention)`);
    content.theme = "heritage";
  }

  console.log(`\n=== On This Day: ${date} (${content.slides.length} slides) ===`);

  const queueDir = path.join(ROOT, "content-queue", "pending", `${date}_on-this-day`);
  await fs.mkdir(queueDir, { recursive: true });

  const slideFiles = [];
  for (let i = 0; i < content.slides.length; i++) {
    const outPath = path.join(ROOT, "out", `on-this-day_${date}_${i}.jpeg`);
    const propsPath = path.join(ROOT, "public", "on-this-day", `${date}.props.json`);
    await fs.writeFile(
      propsPath,
      JSON.stringify({ contentId: date, slideIndex: i }),
      "utf-8"
    );

    process.stdout.write(`  [${i + 1}/${content.slides.length}] rendering slide... `);
    const cmd = `npx remotion still OnThisDay "${outPath}" "--props=${propsPath}" --overwrite`;
    await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });

    const destSlide = path.join(queueDir, `slide_${i + 1}.jpeg`);
    await fs.copyFile(outPath, destSlide);
    slideFiles.push(`slide_${i + 1}.jpeg`);
    console.log("done");
  }

  const coverSlide = content.slides[0];
  const closerSlide = content.slides[content.slides.length - 1];
  const hashtags = ["#Bharat100", "#OnThisDay", "#IndianHistory", "#India2047", "#ViksitBharat"];
  const caption = `${coverSlide.headline}\n\n${content.slides
    .slice(1)
    .map((s) => s.body)
    .filter(Boolean)
    .join("\n\n")}\n\n${hashtags.join(" ")}`;
  const captionX = buildXCaption(coverSlide.headline, hashtags);
  const captionThreads = buildThreadsCaption(caption, coverSlide.headline, hashtags);

  const card = {
    type: "on-this-day",
    title: coverSlide.headline,
    pillar: "Builder Story",
    date,
    caption,
    captionX,
    captionThreads,
    slideFiles,
    imagePath: path
      .relative(path.resolve(ROOT, ".."), path.join(queueDir, "slide_1.jpeg"))
      .replace(/\\/g, "/"),
    slideCount: content.slides.length,
    status: "pending",
    platforms: ["Instagram", "YouTube", "X", "Threads", "Facebook", "Mastodon", "Bluesky", "Pinterest"],
  };
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nQueued: content-queue/pending/${date}_on-this-day/`);
  console.log(`Doc id for dashboard: ${date}_on-this-day`);
  console.log(`\n--- card.json ---`);
  console.log(JSON.stringify(card, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
