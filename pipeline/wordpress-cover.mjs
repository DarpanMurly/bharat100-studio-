// Usage: node pipeline/wordpress-cover.mjs <date>
// Renders the daily digest's featured/cover image (BlogCover.tsx) from
// that day's 5 pillar headlines, then uploads it to Cloudinary for a
// public URL wordpress-publish.mjs can pass to WordPress's media/new
// endpoint. Expects public/wordpress/<date>.json to already exist (the
// hand-written article) — this appends coverDate/coverHeadlines fields
// to that same file rather than creating a separate one.

import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const PILLAR_ORDER = ["Sector Futures", "Builder Story", "Personal Growth", "Global Bharat", "Diaspora Dividend"];

export async function findDayPillars(date) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => d.startsWith(date) && !d.endsWith("_weekly-recap"));

  const byPillar = {};
  for (const dir of dirs) {
    try {
      const card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
      if (!card.pillar) continue;
      // card.title is sometimes a pre-truncated "..." preview string, not
      // meant for display (same gotcha noted in youtube-upload.mjs and
      // render-weekly-recap.mjs) — the caption's first paragraph is
      // always the real, untruncated headline.
      const fromCaption = (card.caption ?? "").split("\n\n")[0]?.trim();
      byPillar[card.pillar] = fromCaption || card.title;
    } catch {
      // skip unreadable card
    }
  }
  return PILLAR_ORDER.filter((p) => byPillar[p]).map((p) => ({ pillar: p, title: byPillar[p] }));
}

async function findCardTitles(date) {
  return (await findDayPillars(date)).map((p) => p.title);
}

function formatCoverDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/wordpress-cover.mjs <date>");
    process.exit(1);
  }

  const articlePath = path.join(ROOT, "public", "wordpress", `${date}.json`);
  const article = JSON.parse(await fs.readFile(articlePath, "utf-8"));

  const headlines = await findCardTitles(date);
  if (headlines.length === 0) {
    throw new Error(`No pillar cards found for ${date} — generate that day's content first.`);
  }

  article.coverDate = formatCoverDate(date);
  article.coverHeadlines = headlines;
  await fs.writeFile(articlePath, JSON.stringify(article, null, 2), "utf-8");

  console.log(`\n=== Rendering blog cover for ${date} (${headlines.length} headlines) ===`);

  const outPath = path.join(ROOT, "out", `wordpress-cover_${date}.png`);
  const propsPath = path.join(ROOT, "out", `wordpress-cover_${date}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId: date }), "utf-8");
  const cmd = `npx remotion still BlogCover "${outPath}" "--props=${propsPath}" --overwrite`;
  await execAsync(cmd, { cwd: ROOT, maxBuffer: 1024 * 1024 * 20 });
  await fs.rm(propsPath, { force: true });

  console.log(`Uploading cover to Cloudinary...`);
  const imageUrl = await uploadToCloudinary(outPath);

  article.coverImageUrl = imageUrl;
  await fs.writeFile(articlePath, JSON.stringify(article, null, 2), "utf-8");

  await fs.rm(outPath, { force: true });

  console.log(`Cover uploaded: ${imageUrl}`);
}

// Guard added 2026-09-11 — this file exports findDayPillars, which
// wordpress-publish.mjs imports. Without this guard, main() ran on
// every such import (module-level `main().catch(...)` with no check at
// all), silently re-rendering the cover and overwriting the article
// file with a stale in-memory copy — racing wordpress-publish.mjs's own
// write of wordpressPostId/wordpressScheduledAt and wiping it out. This
// is why every published/scheduled WordPress article's local file was
// missing those fields even though the actual posts went out correctly
// (confirmed: card.json prints "Scheduled: <real URL>" but the file on
// disk never persisted wordpressPostId or wordpressScheduledAt).
const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
