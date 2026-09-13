// Usage: node pipeline/retry-failed-buffer.mjs
// Scans every card for a Buffer platform gap (approved/scheduled for
// publishing on a platform, but with no bufferPostIds entry for it — either
// never attempted, or a prior attempt errored and was cleared) and retries
// each one that currently has Buffer queue capacity. Meant to run
// PERIODICALLY (manually, or via a scheduled job — see
// .github/workflows/retry-buffer.yml), not just once after a failure is
// noticed by a human.
//
// Built 2026-09-13 after a real gap in the pipeline: recovering a failed
// Buffer post (media error, generic "unknown error", or the 10/10 queue
// cap) was entirely MANUAL — someone had to notice an error email, report
// it, and a person had to run a one-off delete+requeue script. Nothing
// tracked "does every content package have every platform it's supposed
// to have," so a partial failure could sit unnoticed indefinitely unless
// someone happened to check the specific post on the specific platform.
// This script is the fix: it IS the tracking + auto-recovery, run on a
// schedule so a freed-up queue slot gets used automatically instead of
// waiting for the next manual check-in.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";
import { queuePost } from "./buffer-publish.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ORG_ID = "6a9b31a1d4a31de04ff89696";
const API_KEY = process.env.BUFFER_API_KEY;
const SCHEDULED_QUEUE_LIMIT = 10;

async function graphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function getCurrentCapacity() {
  const query = `
    query {
      posts(input: { organizationId: "${ORG_ID}", filter: { status: scheduled } }, first: 100) {
        edges { node { channel { service } } }
      }
    }
  `;
  const data = await graphql(query);
  const counts = {};
  for (const { node } of data.posts.edges) {
    counts[node.channel.service] = (counts[node.channel.service] ?? 0) + 1;
  }
  // Map Buffer's internal service names to this project's platform labels.
  return {
    Instagram: SCHEDULED_QUEUE_LIMIT - (counts.instagram ?? 0),
    Threads: SCHEDULED_QUEUE_LIMIT - (counts.threads ?? 0),
    X: SCHEDULED_QUEUE_LIMIT - (counts.twitter ?? 0),
  };
}

// A card has a genuine Buffer GAP when: it lists a Buffer platform in
// card.platforms, that platform is one of Instagram/Threads/X, and
// bufferPostIds has no entry for it — but ONLY when we can be confident
// this really means "attempted and failed," not "posted before Buffer
// tracking existed for it." Real incident while building this (2026-09-13):
// a first version with no status/age filter found 2026-09-05_motivational-
// short "missing" all 3 Buffer platforms and auto-reposted it to X — but
// that card's status was "posted" (published back on Sept 5 through
// whatever flow predated bufferPostIds tracking), not an actual failure.
// The retry created a genuine week-old duplicate that had to be manually
// deleted before it fired. Fixed with two independent guards:
//   1. card.status must be "approved" — the exact state
//      publish-to-buffer.mjs's resilience fix (2026-09-14) leaves a card in
//      when a Buffer attempt partially failed. "posted"/"scheduled" means
//      either full success already, or success recorded through some other
//      path this script has no business overriding.
//   2. card.date must be within the last 3 days — even a genuinely
//      approved-but-gapped card that's this old is more likely a stale
//      artifact than something safe to silently fire now; a gap that old
//      belongs in front of a human, not auto-resolved.
const MAX_AGE_DAYS = 3;

async function findGappedCards() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);
  const gapped = [];

  for (const dir of dirs) {
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    if (!card.videoFile && !card.imageFile && !card.slideFiles?.length) continue; // no media, not a Buffer-eligible card
    if (card.status !== "approved") continue; // only a confirmed partial-failure state, never "posted"/"scheduled"/"pending"

    if (card.date) {
      const ageDays = (Date.now() - new Date(`${card.date}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_AGE_DAYS) {
        console.log(`  [${dir}] status is "approved" but ${Math.floor(ageDays)} days old — too stale to auto-retry, needs a human look.`);
        continue;
      }
    }

    const bufferPlatforms = (card.platforms ?? []).filter((p) => ["Instagram", "Threads", "X"].includes(p));
    if (bufferPlatforms.length === 0) continue;

    const missing = bufferPlatforms.filter((p) => !card.bufferPostIds?.[p]);
    if (missing.length === 0) continue;

    // Skip anything whose slot hasn't happened yet — this is a RECOVERY
    // tool for things that should already be live/queued, not a way to
    // schedule tomorrow's content early.
    const slotAt = card.scheduledAt;
    if (slotAt && new Date(slotAt).getTime() > Date.now() + 60 * 60 * 1000) continue; // more than 1hr in the future, not due yet

    gapped.push({ dir, cardPath, card, missing });
  }
  return gapped;
}

async function retryPlatform(dir, cardPath, card, platformLabel) {
  const queueDir = path.join(ROOT, "content-queue", "pending", dir);
  const platformKey = platformLabel.toLowerCase() === "x" ? "twitter" : platformLabel.toLowerCase();

  let text = card.caption;
  if (platformKey === "twitter") text = card.captionX ?? card.caption;
  else if (platformKey === "threads") text = card.captionThreads ?? card.caption;

  const media = {};
  if (card.videoFile) {
    media.videoUrl = await uploadToCloudinary(path.join(queueDir, card.videoFile), { resourceType: "video" });
    if (card.thumbnailFrame != null) media.thumbnailFrame = card.thumbnailFrame;
  } else if (card.imageFile) {
    media.imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
  }

  const post = await queuePost(platformKey, text, media, {});
  card.bufferPostIds = { ...(card.bufferPostIds ?? {}), [platformLabel]: post.id };
  await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
  return post.id;
}

async function main() {
  console.log(`Checking for Buffer platform gaps at ${new Date().toISOString()}...`);
  const gapped = await findGappedCards();

  if (gapped.length === 0) {
    console.log("No gapped cards found — every Buffer-eligible card has all its expected platform posts.");
    return;
  }

  console.log(`Found ${gapped.length} card(s) with a missing Buffer platform:`);
  for (const g of gapped) console.log(`  ${g.dir}: missing ${g.missing.join(", ")}`);

  const capacity = await getCurrentCapacity();
  console.log(`\nCurrent capacity: Instagram ${capacity.Instagram}, Threads ${capacity.Threads}, X ${capacity.X} free`);

  let anyRetried = false;
  for (const { dir, cardPath, card, missing } of gapped) {
    for (const platformLabel of missing) {
      if (capacity[platformLabel] <= 0) {
        console.log(`  [${dir}] ${platformLabel}: still full, skipping this run.`);
        continue;
      }
      console.log(`  [${dir}] ${platformLabel}: capacity available, retrying...`);
      try {
        const id = await retryPlatform(dir, cardPath, card, platformLabel);
        console.log(`    -> success: ${id}`);
        capacity[platformLabel]--;
        anyRetried = true;
      } catch (err) {
        console.error(`    -> FAILED again: ${err.message ?? err}`);
      }
    }
  }

  if (!anyRetried) {
    console.log(`\nNo capacity available for any gapped platform this run — will retry again next scheduled check.`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
