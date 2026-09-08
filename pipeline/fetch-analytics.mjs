// Usage: node pipeline/fetch-analytics.mjs
// Pulls performance metrics from Buffer (Instagram/Threads/X) and
// YouTube Analytics, then writes them into the Content Desk artifact's
// database (collection "analytics") for the dashboard's Analytics tab
// to read. Run this periodically (e.g. once a day) to keep numbers fresh
// — Buffer/platforms don't push data to us, we have to pull it.

import "dotenv/config";
import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const ORG_ID = "6a9b31a1d4a31de04ff89696";

async function bufferGraphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${BUFFER_API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchBufferPosts() {
  const query = `
    query {
      posts(input: { organizationId: "${ORG_ID}", filter: { status: sent } }, first: 100) {
        edges {
          node {
            id
            channel { service }
            text
            sentAt
            metrics { name value unit }
          }
        }
      }
    }
  `;
  const data = await bufferGraphql(query);
  return data.posts.edges.map((e) => e.node);
}

// Scheduled (not-yet-sent) Buffer posts, so the dashboard can show
// "scheduled, not live yet" instead of misreading missing rows as
// missing data.
async function fetchScheduledBufferPosts() {
  const query = `
    query {
      posts(input: { organizationId: "${ORG_ID}", filter: { status: scheduled } }, first: 100) {
        edges {
          node {
            id
            channel { service }
            text
            dueAt
          }
        }
      }
    }
  `;
  const data = await bufferGraphql(query);
  return data.posts.edges.map((e) => e.node);
}

async function getYoutubeClient() {
  const credentials = JSON.parse(await fs.readFile(path.join(ROOT, "youtube-client-secret.json"), "utf-8"));
  const token = JSON.parse(await fs.readFile(path.join(ROOT, "youtube-token.json"), "utf-8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  client.setCredentials(token);
  return client;
}

async function fetchYoutubeVideoStats(videoIds) {
  if (videoIds.length === 0) return {};
  let auth;
  try {
    auth = await getYoutubeClient();
  } catch (err) {
    console.log(`  Skipping YouTube stats: ${err.code === "ENOENT" ? "no token file (run youtube-auth.mjs)" : err.message}`);
    return {};
  }
  const youtube = google.youtube({ version: "v3", auth });
  const res = await youtube.videos.list({
    part: ["statistics"],
    id: videoIds,
  });
  const byId = {};
  for (const item of res.data.items ?? []) {
    byId[item.id] = item.statistics;
  }
  return byId;
}

function findYoutubeVideoIds() {
  // Scan content-queue for any card that recorded a youtubeVideoId
  return fs.readdir(path.join(ROOT, "content-queue", "pending")).then(async (dirs) => {
    const ids = [];
    for (const dir of dirs) {
      const cardPath = path.join(ROOT, "content-queue", "pending", dir, "card.json");
      try {
        const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
        if (card.youtubeVideoId) {
          ids.push({
            id: card.youtubeVideoId,
            postId: dir,
            title: card.title,
            pillar: card.pillar ?? null,
            scheduledAt: card.youtubeScheduledAt ?? null,
          });
        }
      } catch {
        // no card.json or unreadable, skip
      }
    }
    return ids;
  });
}

// Maps a Buffer post's leading text back to its pillar by matching
// against every local card's title/caption first line — Buffer's API
// doesn't know about pillars, so this is the only way to attribute a
// post back to Sector Futures / Builder Story / etc for performance
// breakdowns by pillar.
async function buildPillarLookup() {
  const dirs = await fs.readdir(path.join(ROOT, "content-queue", "pending"));
  const lookup = [];
  for (const dir of dirs) {
    const cardPath = path.join(ROOT, "content-queue", "pending", dir, "card.json");
    try {
      const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
      if (!card.pillar) continue;
      // X/Threads posts use captionX/captionThreads, which can lead with
      // a DIFFERENT, separately-truncated headline than the full caption
      // (see buildXCaption/buildThreadsCaption) — index all caption
      // variants' first lines, not just the full one, or short-caption
      // posts silently fail to match and get attributed pillar: null.
      const candidates = [card.caption, card.captionX, card.captionThreads, card.captionYoutube]
        .filter(Boolean)
        .map((c) => c.split("\n\n")[0]?.trim())
        .filter(Boolean);
      for (const headline of candidates) {
        lookup.push({ headline, pillar: card.pillar });
      }
    } catch {
      // skip
    }
  }
  return lookup;
}

function pillarForText(text, lookup) {
  const match = lookup.find((l) => text.startsWith(l.headline.slice(0, 40)));
  return match?.pillar ?? null;
}

function bufferMetricsToObject(metrics) {
  const out = {};
  for (const m of metrics ?? []) {
    out[m.name] = m.value;
  }
  return out;
}

async function main() {
  console.log("Fetching Buffer post metrics...");
  const bufferPosts = await fetchBufferPosts();
  console.log(`  ${bufferPosts.length} sent posts found`);

  console.log("Fetching scheduled Buffer posts...");
  const scheduledPosts = await fetchScheduledBufferPosts();
  console.log(`  ${scheduledPosts.length} scheduled posts found`);

  console.log("Fetching YouTube video stats...");
  const ytEntries = await findYoutubeVideoIds();
  const ytStats = await fetchYoutubeVideoStats(ytEntries.map((e) => e.id));
  console.log(`  ${ytEntries.length} YouTube videos found`);

  const pillarLookup = await buildPillarLookup();

  const now = Date.now();

  // Buffer's free-tier hard cap is 10 SCHEDULED posts per channel (a
  // queue-depth limit, separate from dailyPostingLimits) — discovered via
  // a real publish failure 2026-09-07. Surface current usage so it's
  // visible before the next publish hits it, rather than failing blind.
  const SCHEDULED_QUEUE_LIMIT = 10;
  const scheduledCountByPlatform = {};
  for (const p of scheduledPosts) {
    scheduledCountByPlatform[p.channel.service] = (scheduledCountByPlatform[p.channel.service] ?? 0) + 1;
  }
  const bufferCapacity = Object.fromEntries(
    Object.entries(scheduledCountByPlatform).map(([platform, count]) => [
      platform,
      { scheduled: count, limit: SCHEDULED_QUEUE_LIMIT, remaining: SCHEDULED_QUEUE_LIMIT - count },
    ])
  );

  const summary = {
    fetchedAt: new Date().toISOString(),
    bufferCapacity,
    buffer: bufferPosts.map((p) => ({
      id: p.id,
      platform: p.channel.service,
      text: p.text.slice(0, 80),
      pillar: pillarForText(p.text, pillarLookup),
      sentAt: p.sentAt,
      status: "live",
      metrics: bufferMetricsToObject(p.metrics),
    })).concat(
      scheduledPosts.map((p) => ({
        id: p.id,
        platform: p.channel.service,
        text: p.text.slice(0, 80),
        pillar: pillarForText(p.text, pillarLookup),
        sentAt: null,
        scheduledAt: p.dueAt,
        status: "scheduled",
        metrics: {},
      }))
    ),
    youtube: ytEntries.map((e) => {
      // A video with a future publishAt is still private/scheduled even
      // though the Data API already returns a (meaningless) statistics
      // object for it — treat "scheduled in the future" as not-live yet
      // regardless of what stats.viewCount says.
      const isScheduled = e.scheduledAt && new Date(e.scheduledAt).getTime() > now;
      return {
        videoId: e.id,
        postId: e.postId,
        title: e.title,
        pillar: e.pillar,
        scheduledAt: e.scheduledAt,
        status: isScheduled ? "scheduled" : "live",
        stats: isScheduled ? null : ytStats[e.id] ?? null,
      };
    }),
  };

  const outPath = path.join(ROOT, "content-queue", "analytics-snapshot.json");
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nSnapshot written to ${outPath}`);
  console.log(`Buffer queue: ${Object.entries(bufferCapacity).map(([p, c]) => `${p} ${c.scheduled}/${c.limit}`).join(", ")}`);
  console.log(`Next: push this into the Content Desk artifact's "analytics" collection.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
