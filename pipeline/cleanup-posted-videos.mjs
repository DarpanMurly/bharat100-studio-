// Usage: node pipeline/cleanup-posted-videos.mjs
// Deletes the local video.mp4/image.jpeg/thumbnail.jpg/slide_*.jpeg files
// from content-queue/pending/<id>/ once that post has been "posted" for
// at least RETENTION_DAYS — YouTube and Buffer already host these
// permanently, so the local copy is pure redundancy after that point.
// card.json is NEVER deleted — it's the permanent record the website
// archive (pipeline/build-archive-data.mjs) and dashboard read from.
//
// Run this periodically (part of the daily cycle) — safe to run
// repeatedly, only acts on cards already marked "posted" by
// pipeline/mark-posted.mjs whose postedAt is old enough, and only once
// per card (media files just won't exist on the next run).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RETENTION_DAYS = 7;

const MEDIA_FIELDS = ["videoFile", "imageFile", "thumbnailFile"];

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);

  let cleaned = 0;
  let totalBytesFreed = 0;

  for (const dir of dirs) {
    const folderPath = path.join(pendingDir, dir);
    const cardPath = path.join(folderPath, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }

    if (card.status !== "posted" || !card.postedAt) continue;

    const ageDays = (Date.now() - new Date(card.postedAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays < RETENTION_DAYS) continue;
    if (card.mediaCleanedUp) continue; // already done, nothing left to remove

    const filesToDelete = [];
    for (const field of MEDIA_FIELDS) {
      if (card[field]) filesToDelete.push(card[field]);
    }
    if (card.slideFiles?.length) filesToDelete.push(...card.slideFiles);

    if (filesToDelete.length === 0) continue;

    let freedThisCard = 0;
    for (const file of filesToDelete) {
      const filePath = path.join(folderPath, file);
      try {
        const stat = await fs.stat(filePath);
        freedThisCard += stat.size;
        await fs.rm(filePath, { force: true });
      } catch {
        // already gone
      }
    }

    card.mediaCleanedUp = true;
    card.mediaCleanedUpAt = new Date().toISOString();
    await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");

    cleaned++;
    totalBytesFreed += freedThisCard;
    console.log(`${dir}: removed ${filesToDelete.join(", ")} (${(freedThisCard / 1024 / 1024).toFixed(1)} MB, posted ${ageDays.toFixed(1)} days ago)`);
  }

  if (cleaned === 0) {
    console.log(`Nothing to clean up — no posted card is older than ${RETENTION_DAYS} days with media still present.`);
    return;
  }

  console.log(`\n${cleaned} card(s) cleaned up, ${(totalBytesFreed / 1024 / 1024).toFixed(1)} MB freed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
