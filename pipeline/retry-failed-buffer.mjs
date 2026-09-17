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
import { X_PUBLISHING_PAUSED } from "./publish-to-buffer.mjs";
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";

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

// Buffer's `posts` query defaults to one page — a single unpaginated
// first:100 call with no channel filter silently truncates once total
// posts across ALL channels combined exceeds 100 (found 2026-09-17 in
// fetch-analytics.mjs and sync-buffer-links.mjs, the same root cause:
// real sent-post count that day was 172). Scheduled posts are capped at
// 10/channel so 100 is safe today, but page through fully anyway rather
// than rely on that cap never changing.
async function fetchAllPosts(status, extraFields = "") {
  const query = `
    query Posts($organizationId: OrganizationId!, $first: Int!, $after: String) {
      posts(input: { organizationId: $organizationId, filter: { status: [${status}] } }, first: $first, after: $after) {
        edges { node { channel { service } ${extraFields} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const all = [];
  let after = null;
  for (;;) {
    const data = await graphql(query, { organizationId: ORG_ID, first: 100, after });
    all.push(...data.posts.edges.map((e) => e.node));
    if (!data.posts.pageInfo.hasNextPage) break;
    after = data.posts.pageInfo.endCursor;
  }
  return all;
}

async function getCurrentCapacity() {
  const nodes = await fetchAllPosts("scheduled");
  const counts = {};
  for (const node of nodes) {
    counts[node.channel.service] = (counts[node.channel.service] ?? 0) + 1;
  }
  // Map Buffer's internal service names to this project's platform labels.
  return {
    Instagram: SCHEDULED_QUEUE_LIMIT - (counts.instagram ?? 0),
    Threads: SCHEDULED_QUEUE_LIMIT - (counts.threads ?? 0),
    X: SCHEDULED_QUEUE_LIMIT - (counts.twitter ?? 0),
  };
}

// Real gap found 2026-09-13 via a manual audit: this script only ever
// checked for a MISSING bufferPostIds entry, never whether an EXISTING
// entry was actually still healthy on Buffer's side. A post that fails
// after being recorded (the generic "unknown error", a media-spec issue)
// keeps its id in card.json forever, reading as "already succeeded" to
// every check that only looks at presence, not live status — this is
// exactly how 4 real failures (Sept 6, Sept 11, Sept 13 x2) sat unnoticed
// until the user reported the actual failure emails directly. Fixed by
// also pulling Buffer's own "error" bucket in bulk (one call, not one
// call per post — avoids the rate limit hit during the manual audit that
// prompted this fix) and treating any card whose recorded id shows up
// there as gapped too, same as a missing id.
async function fetchErroredBufferIds() {
  const nodes = await fetchAllPosts("error", "id");
  return new Set(nodes.map((n) => n.id));
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

async function findGappedCards(erroredBufferIds) {
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

    // "approved" is the confirmed partial-failure state; "scheduled" is
    // ALSO checked now (but only for a live-errored id, never a missing
    // one) since a post can fail AFTER already being recorded as
    // successful — see fetchErroredBufferIds()'s comment. Anything else
    // ("posted", "pending", etc.) is left alone entirely.
    if (card.status !== "approved" && card.status !== "scheduled") continue;

    if (card.date) {
      const ageDays = (Date.now() - new Date(`${card.date}T00:00:00Z`).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > MAX_AGE_DAYS) {
        if (card.status === "approved") {
          console.log(`  [${dir}] status is "approved" but ${Math.floor(ageDays)} days old — too stale to auto-retry, needs a human look.`);
        }
        continue;
      }
    }

    const bufferPlatforms = (card.platforms ?? []).filter(
      (p) => ["Instagram", "Threads", "X"].includes(p) && !(p === "X" && X_PUBLISHING_PAUSED)
    );
    if (bufferPlatforms.length === 0) continue;

    const missing = bufferPlatforms.filter((p) => {
      const id = card.bufferPostIds?.[p];
      if (!id) return true; // never attempted, or cleared after a manual fix
      if (erroredBufferIds.has(id)) return true; // recorded, but Buffer says it actually failed
      return false;
    });
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

const DELETE_POST_MUTATION = `
  mutation DeletePost($id: PostId!) {
    deletePost(input: { id: $id }) {
      ... on DeletePostSuccess { id }
      ... on VoidMutationError { message }
    }
  }
`;

async function retryPlatform(dir, cardPath, card, platformLabel, erroredBufferIds) {
  const queueDir = path.join(ROOT, "content-queue", "pending", dir);
  const platformKey = platformLabel.toLowerCase() === "x" ? "twitter" : platformLabel.toLowerCase();

  // If the existing id is a live-errored one (not just missing), delete it
  // on Buffer's side first — otherwise the old errored post lingers
  // forever alongside the fresh replacement.
  const existingId = card.bufferPostIds?.[platformLabel];
  if (existingId && erroredBufferIds.has(existingId)) {
    await graphql(DELETE_POST_MUTATION, { id: existingId });
  }

  // FIXED 2026-09-15: this fell through to the full uncapped card.caption
  // for Instagram, unlike publish-to-buffer.mjs - caused a real retry
  // failure on the weekly recap (2650+ char caption vs. Instagram's 2196
  // cap) even though the card already had a correctly-capped
  // captionInstagram field sitting right there, unused.
  let text = card.caption;
  if (platformKey === "twitter") text = card.captionX ?? card.caption;
  else if (platformKey === "threads") text = card.captionThreads ?? card.caption;
  else if (platformKey === "instagram") text = card.captionInstagram ?? card.caption;

  const media = {};
  if (card.videoFile) {
    media.videoUrl = await uploadToCloudinary(path.join(queueDir, card.videoFile), { resourceType: "video" });
    if (card.thumbnailFrame != null) media.thumbnailFrame = card.thumbnailFrame;
  } else if (card.imageFile) {
    media.imageUrl = await uploadToCloudinary(path.join(queueDir, card.imageFile));
  }

  // REAL BUG found 2026-09-17: this used to call queuePost with no dueAt
  // at all, which made buffer-publish.mjs default to mode "addToQueue" -
  // Buffer's own auto-append behavior, which puts the post at the END of
  // whatever's already scheduled on that channel rather than back at its
  // originally-intended slot time. Every successful Instagram retry was
  // silently pushing that post (and everything queued after it) further
  // into the future - the standing "stay ~1 day ahead" policy (see
  // project memory) drifted to a 5-day-deep queue entirely because of
  // this, not because content was ever actually approved that far ahead.
  // Compute the same real dueAt publish-to-buffer.mjs would have used —
  // but nextSlotUtc(hour, targetDate) has no past-time guard, and a
  // retry is by definition happening after the card's original slot
  // time already passed. Buffer rejects a past dueAt outright ("Scheduled
  // time must be in the future"), so fall back to a few minutes from now
  // whenever the real slot has already elapsed - this is a corrective
  // catch-up post, not a fresh day-ahead schedule, so "as soon as
  // possible" is the correct semantics here, not "queue behind
  // everything else" (addToQueue's old behavior) or "exact original
  // slot" (impossible once that instant has passed).
  const contentType = card.type ?? "video";
  const slotHour = SLOT_HOURS_IST[contentType];
  const intendedDueAt = nextSlotUtc(slotHour, card.date);
  const dueAt = new Date(intendedDueAt) > new Date()
    ? intendedDueAt
    : new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const post = await queuePost(platformKey, text, media, { dueAt });
  card.bufferPostIds = { ...(card.bufferPostIds ?? {}), [platformLabel]: post.id };

  // Flip status back to "scheduled" once every Buffer platform this card
  // actually needs is now present — mirrors the exact same completeness
  // check publish-to-buffer.mjs's 2026-09-14 resilience fix uses. Missed
  // in the first version of this script (found 2026-09-13): a successful
  // retry updated bufferPostIds correctly but left status stuck on
  // "approved" forever, even after every platform succeeded, so the
  // dashboard kept showing a fully-live post as still pending.
  const requiredBufferPlatforms = (card.platforms ?? []).filter(
    (p) => ["Instagram", "Threads", "X"].includes(p) && !(p === "X" && X_PUBLISHING_PAUSED)
  );
  const allPresent = requiredBufferPlatforms.every((p) => card.bufferPostIds[p]);
  if (allPresent) {
    card.status = "scheduled";
  }

  await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
  return post.id;
}

async function main() {
  console.log(`Checking for Buffer platform gaps at ${new Date().toISOString()}...`);

  const erroredBufferIds = await fetchErroredBufferIds();
  console.log(`Buffer currently reports ${erroredBufferIds.size} post(s) in error state.`);

  const gapped = await findGappedCards(erroredBufferIds);

  if (gapped.length === 0) {
    console.log("No gapped cards found — every Buffer-eligible card has all its expected platform posts.");
    return;
  }

  console.log(`Found ${gapped.length} card(s) with a missing or errored Buffer platform:`);
  for (const g of gapped) console.log(`  ${g.dir}: ${g.missing.join(", ")}`);

  const capacity = await getCurrentCapacity();
  console.log(`\nCurrent capacity: Instagram ${capacity.Instagram}, Threads ${capacity.Threads}, X ${capacity.X} free`);

  let anyRetried = false;
  for (const { dir, cardPath, card, missing } of gapped) {
    for (const platformLabel of missing) {
      // An existing-but-errored post occupies its OWN scheduled-queue slot
      // until deleted, so retrying it doesn't need fresh capacity the way
      // a genuinely-missing platform does — only skip on capacity when
      // there was no id there at all.
      const isReplacingErrored = card.bufferPostIds?.[platformLabel] && erroredBufferIds.has(card.bufferPostIds[platformLabel]);
      if (!isReplacingErrored && capacity[platformLabel] <= 0) {
        console.log(`  [${dir}] ${platformLabel}: still full, skipping this run.`);
        continue;
      }
      console.log(`  [${dir}] ${platformLabel}: ${isReplacingErrored ? "replacing errored post" : "capacity available"}, retrying...`);
      try {
        const id = await retryPlatform(dir, cardPath, card, platformLabel, erroredBufferIds);
        console.log(`    -> success: ${id}`);
        if (!isReplacingErrored) capacity[platformLabel]--;
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
