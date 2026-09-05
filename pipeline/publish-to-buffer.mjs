// Usage: node pipeline/publish-to-buffer.mjs <date>_<id>
// Reads content-queue/pending/<date>_<id>/card.json (or approved/), uploads
// its media to Cloudinary for a public URL, then schedules it on Buffer
// across Instagram, Threads, and X at the slot matching its content type.
// YouTube is NOT handled here — it uses a separate direct-API integration.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";
import { queuePost } from "./buffer-publish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// IST slot hours -> content type. Buffer's dueAt is UTC; IST is UTC+5:30.
// "-short" variants are the SAME slot as their static counterpart — every
// content package now posts to all four platforms simultaneously, so the
// video version replaces the still image/carousel in the daily flow
// rather than running as a separate YouTube-only extra.
const SLOT_HOURS_IST = {
  motivational: 8,
  "motivational-short": 8,
  "on-this-day": 13,
  "on-this-day-short": 13,
  video: 19,
};

function nextSlotUtc(hourIst) {
  const now = new Date();
  // Build "today at hourIst IST" as a UTC instant, then push to tomorrow
  // if that instant has already passed.
  const istOffsetMinutes = 5.5 * 60;
  const utcHour = hourIst - istOffsetMinutes / 60;
  const target = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), Math.floor(utcHour), (utcHour % 1) * 60, 0)
  );
  if (target <= now) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return target.toISOString();
}

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // not here, try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/publish-to-buffer.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (card.status !== "approved") {
    console.error(`Refusing to publish: card status is "${card.status}", not "approved".`);
    console.error(`Approve it in the Content Desk dashboard first.`);
    process.exit(1);
  }

  const contentType = card.type ?? "video"; // sector video cards have no "type" field historically
  const slotHour = SLOT_HOURS_IST[contentType];
  const dueAt = nextSlotUtc(slotHour);

  // Date-specific content (On This Day especially — its headline literally
  // names a calendar date) publishing more than a day late is either stale
  // or wrong, and silently pushing it to "next available slot" is exactly
  // how a same-day collision with fresher content happened once already.
  // Require --force to publish anything more than 1 day old.
  if (card.date) {
    const cardDate = new Date(`${card.date}T00:00:00Z`);
    const daysOld = Math.floor((Date.now() - cardDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysOld > 1 && !process.argv.includes("--force")) {
      console.error(
        `Refusing to publish: this content is dated ${card.date} (${daysOld} days ago).`
      );
      if (contentType === "on-this-day") {
        console.error(
          `On This Day content names a specific calendar date in its headline — posting it late will read as wrong, not just stale.`
        );
      }
      console.error(`Re-run with --force if you're sure you want to publish it anyway.`);
      process.exit(1);
    }
  }

  console.log(`\n=== Publishing "${card.title}" (${contentType}) ===`);
  console.log(`Scheduled for: ${dueAt} (UTC) / ${slotHour}:00 IST`);

  // Upload media to Cloudinary for a public URL
  let media = {};
  if (card.slideFiles?.length) {
    console.log(`Uploading ${card.slideFiles.length} carousel slides to Cloudinary...`);
    const urls = [];
    for (const file of card.slideFiles) {
      const url = await uploadToCloudinary(path.join(queueDir, file));
      urls.push(url);
    }
    media.imageUrls = urls;
  } else if (card.videoFile) {
    console.log(`Uploading video to Cloudinary...`);
    media.videoUrl = await uploadToCloudinary(path.join(queueDir, card.videoFile), { resourceType: "video" });
  } else if (card.imageFile) {
    console.log(`Uploading image to Cloudinary...`);
    media.imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
  }

  const platforms = (card.platforms ?? []).filter((p) => p !== "YouTube");
  const results = { ...(card.bufferPostIds ?? {}) };
  for (const platformLabel of platforms) {
    if (results[platformLabel]) {
      console.log(`  Skipping ${platformLabel} — already scheduled (id ${results[platformLabel]}).`);
      continue;
    }

    const platformKey = platformLabel.toLowerCase() === "x" ? "twitter" : platformLabel.toLowerCase();
    if (!["instagram", "threads", "twitter"].includes(platformKey)) continue;

    // X (280 chars) and Threads (500 chars) both cap well under the full
    // Instagram-length caption — each platform gets its own pre-built
    // short version when the full caption would exceed that platform's limit.
    let text = card.caption;
    if (platformKey === "twitter") text = card.captionX ?? card.caption;
    else if (platformKey === "threads") text = card.captionThreads ?? card.caption;

    console.log(`  Scheduling on ${platformLabel}...`);
    const post = await queuePost(platformKey, text, media, { dueAt });
    results[platformLabel] = post.id;
  }

  console.log(`\nScheduled successfully:`, results);

  // mark as posted locally
  card.status = "scheduled";
  card.scheduledAt = dueAt;
  card.bufferPostIds = results;
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  console.log(`\nNote: YouTube is not scheduled by this script — see the YouTube upload track.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
