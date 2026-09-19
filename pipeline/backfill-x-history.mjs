// Usage: node pipeline/backfill-x-history.mjs
// One-off historical backfill: re-posts X content for every card in
// content-queue/pending whose recorded bufferPostIds.X (if any) points to
// the OLD, now-suspended @Bharat_at_100 account's Buffer connection, or
// is missing entirely, onto the new @Bharat_at_100_ account. Built
// 2026-09-19 per explicit user request — the suspended account is "as
// good as dead," and the goal is for the site's archive and any manual
// search to find every historical post live on the new account too, not
// just posts made after the migration.
//
// Unlike retry-failed-buffer.mjs (a narrow, safety-capped RECOVERY tool
// for very recent gaps), this is a deliberate one-time mass backfill:
// it has no MAX_AGE_DAYS cap and no "not due yet" guard, since every
// card here is already long past its original slot and was never
// supposed to wait for anything. Every post goes out "as soon as
// possible" (a few minutes apart, respecting Buffer's queue cap) rather
// than at any original or simulated slot time — there is no meaningful
// "correct" historical slot to preserve for a same-day mass catch-up.
//
// Paces itself against Buffer's 10-scheduled-post-per-channel cap:
// posts as many as there's room for, then stops — re-run this script
// again once the queue drains (it's idempotent: cards already carrying
// a bufferPostIds.X id created AFTER this script's own run are skipped
// via the --since-run marker file, see below).
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";
import { queuePost } from "./buffer-publish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ORG_ID = "6a9b31a1d4a31de04ff89696";
const NEW_X_CHANNEL_ID = process.env.BUFFER_CHANNEL_TWITTER;
const SCHEDULED_QUEUE_LIMIT = 10;
// Migration cutover instant — any bufferPostIds.X id RECORDED at or after
// this run started is already on the new account (either from today's
// live daily pipeline or a previous run of this same script) and must
// never be re-posted. Persisted so repeat runs stay idempotent.
const MARKER_PATH = path.join(ROOT, "content-queue", ".x-backfill-marker.json");

async function graphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.BUFFER_API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getXQueueCount() {
  const query = `
    query Posts($organizationId: OrganizationId!, $first: Int!, $channelIds: [ChannelId!]!) {
      posts(input: { organizationId: $organizationId, filter: { status: [scheduled], channelIds: $channelIds } }, first: $first) {
        edges { node { id } }
      }
    }
  `;
  const data = await graphql(query, { organizationId: ORG_ID, first: 50, channelIds: [NEW_X_CHANNEL_ID] });
  return data.posts.edges.length;
}

async function loadMarker() {
  try {
    return JSON.parse(await fs.readFile(MARKER_PATH, "utf-8"));
  } catch {
    // First run — record every card id already backfilled by earlier
    // ad-hoc work this session (the suspension-window recovery), so
    // this script doesn't double-post those.
    return { postedIds: [] };
  }
}
async function saveMarker(marker) {
  await fs.writeFile(MARKER_PATH, JSON.stringify(marker, null, 2), "utf-8");
}

async function main() {
  if (!NEW_X_CHANNEL_ID) throw new Error("BUFFER_CHANNEL_TWITTER not set in .env");

  const marker = await loadMarker();
  const postedSet = new Set(marker.postedIds);

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => !d.endsWith("_weekly-recap")).sort();

  const candidates = [];
  for (const dir of dirs) {
    if (postedSet.has(dir)) continue;
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    if (!(card.platforms ?? []).includes("X")) continue;
    if (card.status !== "posted" && card.status !== "scheduled") continue;
    // Skip anything whose slot is still genuinely in the future (e.g.
    // Sept 20's batch) — those will post to X normally via the regular
    // daily pipeline now that it's unpaused, no backfill needed.
    if (card.scheduledAt && new Date(card.scheduledAt).getTime() > Date.now()) continue;
    candidates.push({ dir, cardPath, card });
  }

  if (candidates.length === 0) {
    console.log("No historical cards left needing an X backfill.");
    return;
  }

  console.log(`${candidates.length} card(s) remaining to backfill onto the new X account.`);

  let queueCount = await getXQueueCount();
  let freeSlots = SCHEDULED_QUEUE_LIMIT - queueCount;
  console.log(`Current X queue: ${queueCount}/${SCHEDULED_QUEUE_LIMIT} — ${freeSlots} free slot(s) this run.`);

  let posted = 0;
  for (const { dir, cardPath, card } of candidates) {
    if (freeSlots <= 0) {
      console.log(`Queue full — stopping here. Re-run this script once these posts fire to continue.`);
      break;
    }

    const queueDir = path.join(pendingDir, dir);
    const text = card.captionX ?? card.caption;
    if (!text) {
      console.log(`  [${dir}] no caption text at all — skipping.`);
      continue;
    }

    const media = {};
    try {
      if (card.videoFile) {
        media.videoUrl = await uploadToCloudinary(path.join(queueDir, card.videoFile), { resourceType: "video" });
        if (card.thumbnailFrame != null) media.thumbnailFrame = card.thumbnailFrame;
      } else if (card.imageFile) {
        media.imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
      }
    } catch (err) {
      console.log(`  [${dir}] media upload failed (${err.message}) — posting text-only.`);
    }

    try {
      const post = await queuePost("twitter", text, media, {});
      card.bufferPostIds = { ...(card.bufferPostIds ?? {}), X: post.id };
      await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
      postedSet.add(dir);
      posted++;
      freeSlots--;
      console.log(`  [${dir}] -> ${post.id}`);
    } catch (err) {
      console.log(`  [${dir}] FAILED: ${err.message}`);
    }
  }

  await saveMarker({ postedIds: [...postedSet] });
  console.log(`\nBackfilled ${posted} post(s) this run. ${candidates.length - posted} remaining — re-run once the X queue drains.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
