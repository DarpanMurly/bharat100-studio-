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
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// X/Twitter: the original @Bharat_at_100 was suspended 2026-09-15
// (appeal filed, still unresolved) — X publishing was paused here so
// content didn't silently pile up as "already scheduled" against a
// suspended account. RESUMED 2026-09-19: Buffer reconnected to a new
// fallback account, @Bharat_at_100_ (see x-migration-plan.md), new
// BUFFER_CHANNEL_TWITTER channel id set in .env and GitHub secrets.
// Flipped back to false after one manual test post confirmed the new
// channel actually publishes correctly. This same flag is checked in
// retry-failed-buffer.mjs and check-platform-coverage.mjs — keep all
// three in sync if this ever needs to change again.
export const X_PUBLISHING_PAUSED = false;

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
    console.error(`Run pipeline/approve-and-publish.mjs instead of this script directly.`);
    process.exit(1);
  }

  const contentType = card.type ?? "video"; // sector video cards have no "type" field historically
  const slotHour = SLOT_HOURS_IST[contentType];
  // card.date is the day this content is FOR (today or explicitly a day
  // ahead) — pass it through so a next-day-generated post always targets
  // its own correct slot instant, never colliding with today's.
  const dueAt = nextSlotUtc(slotHour, card.date);

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
    if (card.thumbnailFile) {
      console.log(`Uploading thumbnail to Cloudinary...`);
      media.thumbnailUrl = await uploadToCloudinary(path.join(queueDir, card.thumbnailFile));
    }
    // Pass the exact same frame the YouTube thumbnail uses (see
    // extract-thumbnail.mjs) so Instagram's cover frame via Buffer's
    // thumbnailOffset points at the identical big-number/stat moment,
    // instead of buffer-publish.mjs's own hardcoded fallback constant
    // silently diverging from whatever frame was actually chosen for
    // this specific video (found 2026-09-10: they'd drifted apart).
    if (card.thumbnailFrame != null) {
      media.thumbnailFrame = card.thumbnailFrame;
    }
  } else if (card.imageFile) {
    console.log(`Uploading image to Cloudinary...`);
    media.imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
  }

  const platforms = (card.platforms ?? []).filter(
    (p) => p !== "YouTube" && !(p === "X" && X_PUBLISHING_PAUSED)
  );
  const results = { ...(card.bufferPostIds ?? {}) };
  // Per-platform try/catch, not one loop-wide try/catch — a real bug found
  // 2026-09-14: one platform hitting Buffer's 10/10 scheduled-post cap
  // (a per-CHANNEL limit, so Instagram can be full while Threads/X still
  // have room) threw and aborted the whole loop, losing even platforms
  // that had already succeeded earlier in the same run (results was only
  // ever written to disk after the loop completed, never incrementally).
  // Now each platform is attempted independently; a failure on one is
  // recorded and reported, but never blocks the others from being tried
  // or from having their success actually saved.
  const failures = {};
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
    // Instagram normally just uses the full caption directly (its own cap,
    // 2196 chars, is generous enough that no daily pillar ever hit it) —
    // but a card can opt into its OWN capped captionInstagram when needed
    // (added 2026-09-14: the weekly recap's full numbered story list can
    // exceed 2196 chars on a week with many stories, which no daily card
    // ever produces since each only ever lists one story).
    let text = card.caption;
    if (platformKey === "twitter") text = card.captionX ?? card.caption;
    else if (platformKey === "threads") text = card.captionThreads ?? card.caption;
    else if (platformKey === "instagram") text = card.captionInstagram ?? card.caption;

    console.log(`  Scheduling on ${platformLabel}...`);
    try {
      const post = await queuePost(platformKey, text, media, { dueAt });
      results[platformLabel] = post.id;
    } catch (err) {
      console.error(`  ${platformLabel} FAILED: ${err.message ?? err}`);
      failures[platformLabel] = err.message ?? String(err);
    }
  }

  console.log(`\nScheduled successfully:`, results);
  if (Object.keys(failures).length > 0) {
    console.error(`\nFailed platforms (not scheduled, retry individually once capacity frees up):`, failures);
  }

  // mark as posted locally — status only flips to "scheduled" if EVERY
  // requested Buffer platform actually succeeded; a partial success stays
  // "approved" so it's still picked up by a future retry pass instead of
  // silently reading as fully done.
  const allBufferPlatformsSucceeded = platforms
    .filter((p) => ["instagram", "threads", "x"].includes(p.toLowerCase()))
    .every((p) => results[p]);
  if (allBufferPlatformsSucceeded) {
    card.status = "scheduled";
    card.scheduledAt = dueAt;
  }
  card.bufferPostIds = results;
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");

  if (Object.keys(failures).length > 0) {
    process.exitCode = 1;
  }

  console.log(`\nNote: YouTube is not scheduled by this script — see the YouTube upload track.`);
}

// isMain guard — this file is now also imported by retry-failed-buffer.mjs
// (for the X_PUBLISHING_PAUSED constant), so main() must not run just
// because the file was imported. See feedback_wordpress_cover_data_loss
// memory for the exact class of bug this prevents (wordpress-cover.mjs
// hit this same thing 2026-09-11: a plain import silently also ran a
// script's own CLI main(), corrupting whatever the importer was doing).
const isMain = path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
