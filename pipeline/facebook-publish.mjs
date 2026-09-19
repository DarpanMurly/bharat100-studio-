// Usage: node pipeline/facebook-publish.mjs <date>_<id>
// Publishes the approved card to the Bharat@100 Facebook Page, scheduled
// for the same slot instant as Buffer/YouTube (via slots.mjs). Requires
// facebook-auth.mjs to have been run once already.
//
// Facebook's Graph API schedules a Page post with published:false plus
// scheduled_publish_time (a Unix timestamp) — same "queue it for later,
// don't post now" pattern as YouTube's publishAt, so this stays in sync
// with the rest of the day's platforms rather than going live immediately
// (see youtube-upload.mjs's note on that exact bug from 2026-09-05/06 —
// don't repeat it here).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "facebook-token.json");
const GRAPH_VERSION = "v21.0";

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

async function getPageToken() {
  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
  return token;
}

async function publishVideo({ pageId, pageAccessToken, videoUrl, caption, scheduledUnix }) {
  const url = `https://graph-video.facebook.com/${GRAPH_VERSION}/${pageId}/videos`;
  const body = new URLSearchParams({
    access_token: pageAccessToken,
    file_url: videoUrl,
    description: caption,
  });
  // scheduledUnix is null for a past-due backfill — publish immediately
  // instead of asking the Graph API to schedule into the past (which it
  // rejects outright; scheduled_publish_time must be 10min-6mo in the
  // future). Same "schedule if future, else publish now" pattern as
  // wordpress-publish.mjs.
  if (scheduledUnix) {
    body.set("published", "false");
    body.set("scheduled_publish_time", String(scheduledUnix));
  }
  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  if (json.error) throw new Error(`Facebook video publish failed: ${json.error.message}`);
  return json;
}

async function publishPhoto({ pageId, pageAccessToken, imageUrl, caption, scheduledUnix }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${pageId}/photos`;
  const body = new URLSearchParams({
    access_token: pageAccessToken,
    url: imageUrl,
    caption,
  });
  if (scheduledUnix) {
    body.set("published", "false");
    body.set("scheduled_publish_time", String(scheduledUnix));
  }
  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  if (json.error) throw new Error(`Facebook photo publish failed: ${json.error.message}`);
  return json;
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/facebook-publish.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!(card.platforms ?? []).includes("Facebook")) {
    console.log(`Skipping Facebook — "Facebook" not in this card's platforms list.`);
    return;
  }

  // Facebook posts need a public media URL, same as Buffer — publish-to-
  // buffer.mjs uploads to Cloudinary too but never persists that URL onto
  // card.json, so this uploads its own copy rather than depending on it.
  let videoUrl = null;
  let imageUrl = null;
  if (card.videoFile) {
    console.log(`Uploading video to Cloudinary...`);
    videoUrl = await uploadToCloudinary(path.join(queueDir, card.videoFile), { resourceType: "video" });
  } else if (card.imageFile) {
    console.log(`Uploading image to Cloudinary...`);
    imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
  } else {
    throw new Error(`Card has no videoFile or imageFile — nothing to publish to Facebook.`);
  }

  const { pageId, pageAccessToken, pageName } = await getPageToken();

  const contentType = card.type ?? "video";
  const slotHour = SLOT_HOURS_IST[contentType];
  const dueAtIso = nextSlotUtc(slotHour, card.date);
  const isPastDue = new Date(dueAtIso).getTime() <= Date.now();
  const scheduledUnix = isPastDue ? null : Math.floor(new Date(dueAtIso).getTime() / 1000);

  console.log(`\n=== Publishing "${card.title}" to Facebook Page "${pageName}" ===`);
  if (isPastDue) {
    console.log(`Slot time ${dueAtIso} is already in the past — publishing immediately (backfill).`);
  } else {
    console.log(`Scheduled for: ${dueAtIso} (UTC)`);
  }

  const caption = card.caption ?? "";
  const result = videoUrl
    ? await publishVideo({ pageId, pageAccessToken, videoUrl, caption, scheduledUnix })
    : await publishPhoto({ pageId, pageAccessToken, imageUrl, caption, scheduledUnix });

  console.log(isPastDue ? `Published immediately:` : `Scheduled successfully:`, result);

  card.facebookPostId = result.id ?? result.post_id ?? null;
  card.facebookScheduledAt = isPastDue ? new Date().toISOString() : dueAtIso;
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
