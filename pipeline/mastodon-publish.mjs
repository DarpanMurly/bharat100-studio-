// Usage: node pipeline/mastodon-publish.mjs <date>_<id>
// Publishes the approved card to Mastodon, scheduled for the same slot
// instant as every other platform. No OAuth, no App Review — a Mastodon
// access token is self-service (account Preferences -> Development ->
// New Application), unlike Meta/Pinterest.
//
// Unlike Bluesky, Mastodon's API DOES support native scheduled
// publishing (the scheduled_at parameter on POST /api/v1/statuses,
// minimum 5 minutes in the future) — so this fits the standard
// publish-all.mjs flow directly, no GitHub Actions workaround needed.
//
// Requires MASTODON_INSTANCE (e.g. "https://mastodon.social") and
// MASTODON_ACCESS_TOKEN in .env.

import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const INSTANCE = process.env.MASTODON_INSTANCE;
const ACCESS_TOKEN = process.env.MASTODON_ACCESS_TOKEN;

// Mastodon's own hard cap on mastodon.social and most instances (some
// instances raise this, but 500 is the safe default to assume).
const MAX_CHARS = 500;

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

// Builds a real Mastodon caption from the FULL caption's actual
// paragraphs (headline + as much body prose as fits), not a reused
// short-platform caption designed for a much tighter budget (see the
// comment at this function's call site). Drops the same trailing
// boilerplate build-archive-data.mjs's bodyParagraphs() already
// excludes (cross-platform CTA, disclaimer, sources, hashtag block),
// then appends the card's own hashtags at the end if room remains —
// so a Mastodon post reads as a real, complete thought instead of a
// bare hook line.
function buildMastodonCaption(card, maxChars) {
  const allParagraphs = (card.caption ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);

  // Not every pillar sets card.hashtags as its own array (e.g.
  // motivational-short embeds hashtags only as the caption's own
  // trailing "#Tag1 #Tag2 ..." paragraph) — fall back to extracting
  // that paragraph from the caption itself so hashtags are never
  // silently dropped just because the array field is absent.
  const hashtagParagraph = allParagraphs.find((p) => p.startsWith("#"));
  const hashtagsFromArray = (card.hashtags ?? []).slice(0, 3).join(" ");
  const hashtags = hashtagsFromArray || (hashtagParagraph ? hashtagParagraph.split(" ").slice(0, 3).join(" ") : "");
  const hashtagBlock = hashtags ? `\n\n${hashtags}` : "";

  const paragraphs = allParagraphs.filter((p) => {
    if (p.startsWith("Also on")) return false;
    if (p.startsWith("Independent citizen project")) return false;
    if (p.startsWith("Sources:")) return false;
    if (p.startsWith("#")) return false;
    return true;
  });

  if (paragraphs.length === 0) return card.title ?? "";

  let text = paragraphs[0];
  for (let i = 1; i < paragraphs.length; i++) {
    const candidate = `${text}\n\n${paragraphs[i]}`;
    if (candidate.length + hashtagBlock.length > maxChars) break;
    text = candidate;
  }

  if (text.length + hashtagBlock.length <= maxChars) {
    text += hashtagBlock;
  } else if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1).trimEnd() + "…";
  }

  return text;
}

async function createStatus({ text, scheduledAtIso }) {
  const res = await fetch(`${INSTANCE}/api/v1/statuses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: text,
      scheduled_at: scheduledAtIso,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Mastodon post failed: ${json.error}`);
  return json; // { id, scheduled_at, ... } (a ScheduledStatus, not a Status, when scheduled_at is set)
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/mastodon-publish.mjs <date>_<id>");
    process.exit(1);
  }
  if (!INSTANCE || !ACCESS_TOKEN) {
    console.error("Missing MASTODON_INSTANCE or MASTODON_ACCESS_TOKEN in .env.");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!(card.platforms ?? []).includes("Mastodon")) {
    console.log(`Skipping Mastodon — "Mastodon" not in this card's platforms list.`);
    return;
  }

  // Was card.captionX (X's caption: bare hook headline + 2 hashtags, no
  // body context) — user reported real Mastodon posts reading as
  // incomplete sentence fragments (2026-09-10), confirmed via the live
  // account: every post was just the hook line, nothing else.
  // card.captionThreads doesn't fix this either: it only returns the
  // FULL caption verbatim when that full caption already fits Threads'
  // 500-char cap — for every pillar whose real caption runs longer than
  // that (on-this-day-short's, e.g., are 1000+ chars), it falls back to
  // the exact same short headline-only text as captionX. So Mastodon
  // needs its own real truncation that includes actual body content up
  // to its 500-char budget, not a reused short-platform caption that
  // was designed around a DIFFERENT, much tighter constraint (X's 280).
  let text = buildMastodonCaption(card, MAX_CHARS);

  const contentType = card.type ?? "video";
  const slotHour = SLOT_HOURS_IST[contentType];
  const dueAtIso = nextSlotUtc(slotHour, card.date);

  // Mastodon requires the scheduled time to be at least 5 minutes in the
  // future — if this card's slot has already passed (e.g. a late manual
  // retry), post immediately instead of erroring.
  const scheduledAtIso = new Date(dueAtIso).getTime() > Date.now() + 5 * 60 * 1000 ? dueAtIso : undefined;

  console.log(`\n=== Publishing "${card.title}" to Mastodon (${INSTANCE}) ===`);
  console.log(scheduledAtIso ? `Scheduled for: ${scheduledAtIso}` : `Slot already passed — posting immediately.`);

  const result = await createStatus({ text, scheduledAtIso });

  console.log(`Posted:`, result.id, result.scheduled_at ? `(scheduled for ${result.scheduled_at})` : "(live now)");

  card.mastodonStatusId = result.id;
  card.mastodonScheduledAt = scheduledAtIso ?? new Date().toISOString();
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
