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

// Weekly digest headlines come from the 7 days ending the day before
// <date> (same window render-weekly-recap.mjs uses), one representative
// headline per day (its Sector Futures/video pillar, falling back to
// whichever pillar exists) rather than all 5x7=35 - a weekly cover has
// far less room per headline than a daily one already does with just 5.
async function findWeeklyCardTitles(date) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const endDate = new Date(`${date}T00:00:00Z`);
  const titles = [];
  for (let i = 7; i >= 1; i--) {
    const d = new Date(endDate);
    d.setUTCDate(d.getUTCDate() - i);
    const dayStr = d.toISOString().slice(0, 10);
    const pillars = await findDayPillars(dayStr);
    if (pillars.length > 0) {
      // Prefer Sector Futures as the day's representative headline (most
      // consistently present pillar); fall back to whichever exists first.
      const rep = pillars.find((p) => p.pillar === "Sector Futures") ?? pillars[0];
      titles.push(rep.title);
    }
  }
  return titles;
}

async function main() {
  const date = process.argv[2];
  const isWeekly = process.argv.includes("--weekly");
  if (!date) {
    console.error("Usage: node pipeline/wordpress-cover.mjs <date> [--weekly]");
    process.exit(1);
  }

  const articlePath = path.join(ROOT, "public", "wordpress", `${date}${isWeekly ? "-weekly" : ""}.json`);
  const article = JSON.parse(await fs.readFile(articlePath, "utf-8"));

  const headlines = isWeekly ? await findWeeklyCardTitles(date) : await findCardTitles(date);
  if (headlines.length === 0) {
    throw new Error(`No pillar cards found for ${date} — generate that ${isWeekly ? "week's" : "day's"} content first.`);
  }

  article.coverDate = isWeekly ? `Week of ${formatCoverDate(date)}` : formatCoverDate(date);
  article.coverHeadlines = headlines;
  await fs.writeFile(articlePath, JSON.stringify(article, null, 2), "utf-8");

  console.log(`\n=== Rendering blog cover for ${date}${isWeekly ? " (weekly)" : ""} (${headlines.length} headlines) ===`);

  const contentId = isWeekly ? `${date}-weekly` : date;
  const outPath = path.join(ROOT, "out", `wordpress-cover_${contentId}.png`);
  const propsPath = path.join(ROOT, "out", `wordpress-cover_${contentId}.props.json`);
  await fs.writeFile(propsPath, JSON.stringify({ contentId }), "utf-8");
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
