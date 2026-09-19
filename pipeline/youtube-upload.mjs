// Usage: node pipeline/youtube-upload.mjs <date>_<id>
// Uploads the approved video at content-queue/(approved|pending)/<id>/video.mp4
// to YouTube. Requires youtube-auth.mjs to have been run once already.
//
// Always uploads as private with publishAt set to the same slot instant
// publish-to-buffer.mjs uses for Instagram/X/Threads (via slots.mjs), so
// YouTube flips public automatically in sync with the other three
// platforms instead of going live the moment this script runs. Do not
// hardcode privacyStatus: "public" here again — see the incident on
// 2026-09-05/06 where all three platforms were meant to go live together
// at the scheduled slot, but YouTube uploads went public immediately.

import { google } from "googleapis";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CREDENTIALS_PATH = path.join(ROOT, "youtube-client-secret.json");
const TOKEN_PATH = path.join(ROOT, "youtube-token.json");

async function getAuthedClient() {
  const credentials = JSON.parse(await fsp.readFile(CREDENTIALS_PATH, "utf-8"));
  const token = JSON.parse(await fsp.readFile(TOKEN_PATH, "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  client.setCredentials(token);
  return client;
}

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fsp.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

// Broad, always-relevant discovery keywords added to every upload's tags
// on top of the post's own hashtags — these are the terms someone
// searching for this channel's subject matter would actually type,
// distinct from the narrower per-post hashtags.
const BASE_TAGS = [
  "India",
  "Viksit Bharat 2047",
  "India 2047",
  "Indian economy",
  "India growth story",
  "Make in India",
];

const PILLAR_TAGS = {
  "Sector Futures": ["India manufacturing", "India economy news", "India business"],
  "Builder Story": ["Indian history", "on this day India", "Indian history facts"],
  "Personal Growth": ["motivation India", "success mindset", "daily motivation"],
};

function buildTags(card) {
  const own = (card.hashtags ?? []).map((h) => h.replace(/^#/, ""));
  const pillar = PILLAR_TAGS[card.pillar] ?? [];
  // De-dupe case-insensitively while preserving first-seen casing —
  // YouTube's 500-char total tag budget makes redundant tags wasteful.
  const seen = new Set();
  const out = [];
  for (const tag of [...own, ...pillar, ...BASE_TAGS]) {
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

// YouTube Shorts discovery favors #Shorts appearing in the TITLE itself,
// not just the description — front-load it isn't right (hurts
// readability), so append when there's room within the 100-char cap.
function buildYoutubeTitle(card) {
  const base = (card.youtubeTitle ?? card.title).slice(0, 100);
  if (!card.videoFile) return base; // non-Shorts content, no tag needed
  if (base.toLowerCase().includes("#shorts")) return base;
  const withTag = `${base} #Shorts`;
  return withTag.length <= 100 ? withTag : base;
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/youtube-upload.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fsp.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (card.status !== "approved" && card.status !== "scheduled") {
    console.error(`Refusing to upload: card status is "${card.status}", not "approved".`);
    process.exit(1);
  }

  if (!card.videoFile) {
    console.error(`No videoFile on this card — YouTube upload only applies to sector videos, not images/carousels.`);
    process.exit(1);
  }

  const videoPath = path.join(queueDir, card.videoFile);
  const auth = await getAuthedClient();
  const youtube = google.youtube({ version: "v3", auth });

  // Match the same slot instant Buffer schedules Instagram/X/Threads to,
  // so all four platforms go live simultaneously rather than YouTube
  // jumping the queue at upload time.
  const contentType = card.type ?? "video";
  const slotHour = SLOT_HOURS_IST[contentType];
  const publishAt = nextSlotUtc(slotHour, card.date);

  console.log(`\n=== Uploading "${card.title}" to YouTube (scheduled for ${publishAt}) ===`);

  const res = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        // youtubeTitle (when present) is the clean, untruncated-by-preview
        // title meant for actual publishing; card.title can be a shortened
        // internal preview string (e.g. already ending in "...") that must
        // never be truncated a second time here. #Shorts is appended when
        // it fits — Shorts discovery favors it appearing in the title
        // itself, not just the description.
        title: buildYoutubeTitle(card),
        // #Shorts must appear in the description/title for YouTube to
        // reliably classify the upload as a Short even though duration +
        // aspect ratio should be enough on their own.
        description: card.captionYoutube ?? card.caption ?? "",
        // Own hashtags first (most specific), then pillar-level and
        // channel-wide discovery keywords — see buildTags(). Broad terms
        // like "India" or "Viksit Bharat 2047" help suggested-Shorts
        // placement beyond whoever already searches this exact headline.
        tags: buildTags(card),
        categoryId: "25", // News & Politics
      },
      status: {
        // YouTube only honors publishAt when privacyStatus is "private" at
        // upload time — it flips to public automatically at that instant.
        privacyStatus: "private",
        publishAt,
        selfDeclaredMadeForKids: false,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = res.data.id;
  console.log(`\nUploaded (scheduled): https://youtube.com/watch?v=${videoId}`);
  console.log(`Will go public at: ${publishAt}`);

  // Custom thumbnail: a deliberately-extracted frame (see
  // extract-thumbnail.mjs) with fully-visible headline text, set instead
  // of leaving YouTube to auto-pick a random frame that might land on a
  // transition/blur with nothing readable. Requires the channel's
  // custom-thumbnail permission (phone-verified 2026-09-07) — if a
  // future channel/account doesn't have it, this fails loudly rather
  // than silently, which is correct: better to notice than to publish
  // videos nobody bothered to give a thumbnail.
  // Retries once before giving up — a transient failure here (rate limit,
  // the freshly-uploaded video not being fully processed yet) used to
  // silently fall back to YouTube's auto-picked thumbnail with nothing
  // recorded anywhere, so the gap only ever surfaced by someone noticing
  // a bad thumbnail by eye (found 2026-09-19). card.thumbnailSetOk now
  // records the real outcome either way, so check-platform-coverage.mjs
  // (or any other daily check) can catch a failure without a human
  // needing to look at the video first.
  if (card.thumbnailFile) {
    const thumbPath = path.join(queueDir, card.thumbnailFile);
    let setOk = false;
    for (let attempt = 1; attempt <= 2 && !setOk; attempt++) {
      try {
        await youtube.thumbnails.set({
          videoId,
          media: { body: fs.createReadStream(thumbPath) },
        });
        console.log(`Custom thumbnail set.`);
        setOk = true;
      } catch (err) {
        console.error(`Thumbnail upload attempt ${attempt} failed: ${err.message}`);
        if (attempt === 1) {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
    card.thumbnailSetOk = setOk;
    if (!setOk) {
      console.error(`Thumbnail upload failed after retry (video itself uploaded fine) — YouTube will use its own auto-picked frame instead.`);
    }
  } else {
    console.log(`No thumbnailFile on this card — run extract-thumbnail.mjs before uploading to get a custom thumbnail.`);
    card.thumbnailSetOk = false;
  }

  card.youtubeVideoId = videoId;
  card.youtubeUrl = `https://youtube.com/watch?v=${videoId}`;
  card.youtubeScheduledAt = publishAt;
  await fsp.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
