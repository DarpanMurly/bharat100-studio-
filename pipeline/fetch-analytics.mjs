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
const FACEBOOK_GRAPH_VERSION = "v21.0";

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

// YouTube's videos.list hard-caps id[] at 50 per call ("invalid filter
// parameter" is the actual error, not an obvious "too many ids" message) -
// found 2026-09-15 once the archive crossed 51 total videos. Chunk into
// batches of 50 so this keeps working as the archive keeps growing.
const YOUTUBE_ID_BATCH_SIZE = 50;

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
  const byId = {};
  for (let i = 0; i < videoIds.length; i += YOUTUBE_ID_BATCH_SIZE) {
    const batch = videoIds.slice(i, i + YOUTUBE_ID_BATCH_SIZE);
    const res = await youtube.videos.list({
      part: ["statistics"],
      id: batch,
    });
    for (const item of res.data.items ?? []) {
      byId[item.id] = item.statistics;
    }
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

// Shared card scanner for the 4 platforms that don't push data to us and
// have no equivalent of Buffer's "list all my posts" call — Facebook,
// Bluesky, Mastodon, and WordPress all require us to already know which
// specific post/status/article ID to ask about, so this walks every
// queued card once and returns whichever ones carry that platform's own
// id field, same pattern as findYoutubeVideoIds() above.
async function scanCardsForPlatform(idField, scheduledAtField) {
  const dirs = await fs.readdir(path.join(ROOT, "content-queue", "pending"));
  const entries = [];
  for (const dir of dirs) {
    const cardPath = path.join(ROOT, "content-queue", "pending", dir, "card.json");
    try {
      const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
      if (!card[idField]) continue;
      entries.push({
        id: card[idField],
        postId: dir,
        title: card.title,
        pillar: card.pillar ?? null,
        scheduledAt: card[scheduledAtField] ?? null,
      });
    } catch {
      // no card.json or unreadable, skip
    }
  }
  return entries;
}

async function getFacebookPageToken() {
  const token = JSON.parse(await fs.readFile(path.join(ROOT, "facebook-token.json"), "utf-8"));
  return token.pageAccessToken;
}

// Facebook splits engagement across two different call shapes: simple
// counts (comments, shares, likes) come back as plain fields on the post
// object itself via .summary(true), while reach/impressions require a
// SEPARATE /insights call with named metrics — confirmed via Meta's own
// docs, there is no single field that returns both. Both calls use the
// same Page access token already saved by facebook-publish.mjs.
async function fetchFacebookPostStats(entries) {
  if (entries.length === 0) return {};
  let pageAccessToken;
  try {
    pageAccessToken = await getFacebookPageToken();
  } catch (err) {
    console.log(`  Skipping Facebook stats: ${err.code === "ENOENT" ? "no facebook-token.json (run facebook-auth.mjs)" : err.message}`);
    return {};
  }

  const byId = {};
  for (const entry of entries) {
    try {
      // Every card.facebookPostId in this pipeline is a VIDEO object id
      // (facebook-publish.mjs uploads via graph-video.facebook.com/
      // {page-id}/videos, not the Post endpoint) — the Video object has
      // no "shares" edge/field at all (confirmed: requesting it 400s with
      // "Tried accessing nonexisting field (shares)"), unlike a Post.
      const fieldsUrl = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${entry.id}?fields=comments.summary(true),likes.summary(true)&access_token=${pageAccessToken}`;
      const fieldsRes = await fetch(fieldsUrl);
      const fieldsJson = await fieldsRes.json();
      if (fieldsJson.error) throw new Error(fieldsJson.error.message);

      let impressions = null;
      try {
        const insightsUrl = `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${entry.id}/insights?metric=post_impressions_organic&access_token=${pageAccessToken}`;
        const insightsRes = await fetch(insightsUrl);
        const insightsJson = await insightsRes.json();
        impressions = insightsJson.data?.[0]?.values?.[0]?.value ?? null;
      } catch {
        // Insights can fail independently of the simple counts (e.g. not
        // the video's original poster) — don't let that blank the rest.
      }

      byId[entry.id] = {
        Comments: fieldsJson.comments?.summary?.total_count ?? 0,
        Reactions: fieldsJson.likes?.summary?.total_count ?? 0,
        Impressions: impressions,
      };
    } catch (err) {
      console.log(`  Facebook stats failed for ${entry.postId}: ${err.message}`);
    }
  }
  return byId;
}

// Bluesky's public getPosts endpoint returns aggregated engagement
// counts for up to 25 post URIs per call, no auth required for public
// counts — https://docs.bsky.app.
async function fetchBlueskyPostStats(entries) {
  if (entries.length === 0) return {};
  const byId = {};
  // Batch in groups of 25 (API limit).
  for (let i = 0; i < entries.length; i += 25) {
    const batch = entries.slice(i, i + 25);
    const params = batch.map((e) => `uris=${encodeURIComponent(e.id)}`).join("&");
    try {
      const res = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.message ?? json.error);
      for (const post of json.posts ?? []) {
        byId[post.uri] = {
          Reactions: post.likeCount ?? 0,
          Comments: post.replyCount ?? 0,
          Reposts: post.repostCount ?? 0,
        };
      }
    } catch (err) {
      console.log(`  Bluesky stats batch failed: ${err.message}`);
    }
  }
  return byId;
}

// Fetching stats by the id saved at schedule time (GET /api/v1/statuses/
// :id) 404s for every status that was originally SCHEDULED (confirmed
// 2026-09-11, independently verified via an unauthenticated request to
// mastodon.social) — Mastodon's API doesn't document this, but the
// evidence is consistent with a scheduled post receiving a real,
// DIFFERENT status id once it actually publishes, distinct from the
// ScheduledStatus id mastodon-publish.mjs saves at schedule time
// (card.mastodonStatusId). There's no documented field linking the two.
// Workaround: look up the account's own recent statuses (a real,
// published feed, always resolvable) and match each entry by its
// scheduled slot time instead of trusting the saved id.
// This project only has one Mastodon account (@bharatat100) — hardcoded
// rather than derived, since MASTODON_HANDLE isn't a var this pipeline
// already defines anywhere else.
const MASTODON_HANDLE = "bharatat100";

async function fetchMastodonAccountId(instance, token) {
  const res = await fetch(`${instance}/api/v1/accounts/lookup?acct=${MASTODON_HANDLE}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  return json.id ?? null;
}

async function fetchMastodonStatusStats(entries) {
  if (entries.length === 0) return {};
  const instance = process.env.MASTODON_INSTANCE;
  // Deliberately a SEPARATE token from MASTODON_ACCESS_TOKEN (used by
  // mastodon-publish.mjs) — the original posting token was created with
  // only "profile" and "write:statuses" scopes, no "read"/"read:statuses",
  // so GET /api/v1/statuses/:id 403'd with "This action is outside the
  // authorized scopes" (found 2026-09-11). Rather than re-scope the
  // existing posting token (risk of breaking it), created a new
  // application with "read" scope specifically for analytics lookups.
  const token = process.env.MASTODON_ANALYTICS_TOKEN;
  if (!instance || !token) {
    console.log("  Skipping Mastodon stats: missing MASTODON_INSTANCE or MASTODON_ANALYTICS_TOKEN in .env.");
    return {};
  }

  const accountId = await fetchMastodonAccountId(instance, token);
  if (!accountId) {
    console.log("  Skipping Mastodon stats: could not resolve account id.");
    return {};
  }

  let recentStatuses = [];
  try {
    const res = await fetch(`${instance}/api/v1/accounts/${accountId}/statuses?limit=40`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    recentStatuses = await res.json();
    if (!Array.isArray(recentStatuses)) throw new Error(recentStatuses.error ?? "unexpected response");
  } catch (err) {
    console.log(`  Mastodon: failed to fetch recent statuses — ${err.message}`);
    return {};
  }

  const byId = {};
  for (const entry of entries) {
    // First try the saved id directly — it's correct for anything posted
    // WITHOUT scheduling (e.g. a slot already past at approval time), and
    // this avoids the fuzzy match entirely when it works.
    const direct = recentStatuses.find((s) => s.id === entry.id);
    if (direct) {
      byId[entry.id] = {
        Reactions: direct.favourites_count ?? 0,
        Comments: direct.replies_count ?? 0,
        Reposts: direct.reblogs_count ?? 0,
      };
      continue;
    }
    // Fall back to matching by scheduled slot time — Mastodon's
    // created_at for a formerly-scheduled status is the instant it
    // actually published, which should line up with our own
    // mastodonScheduledAt to within a minute or two.
    if (entry.scheduledAt) {
      const targetMs = new Date(entry.scheduledAt).getTime();
      const match = recentStatuses.find((s) => Math.abs(new Date(s.created_at).getTime() - targetMs) < 5 * 60 * 1000);
      if (match) {
        byId[entry.id] = {
          Reactions: match.favourites_count ?? 0,
          Comments: match.replies_count ?? 0,
          Reposts: match.reblogs_count ?? 0,
        };
        continue;
      }
    }
    console.log(`  Mastodon: could not find a real status matching ${entry.postId} (saved id ${entry.id} not found, no time match either).`);
  }
  return byId;
}

async function getWordpressToken() {
  return JSON.parse(await fs.readFile(path.join(ROOT, "wordpress-token.json"), "utf-8"));
}

// WordPress splits the same way Facebook does: view counts come from a
// dedicated Stats endpoint (up to 100 post IDs per call), while comment/
// like counts are plain fields on the post object itself.
async function fetchWordpressStats(entries) {
  if (entries.length === 0) return {};
  let accessToken, blogId;
  try {
    ({ accessToken, blogId } = await getWordpressToken());
  } catch (err) {
    console.log(`  Skipping WordPress stats: ${err.code === "ENOENT" ? "no wordpress-token.json (run wordpress-auth.mjs)" : err.message}`);
    return {};
  }

  const byId = {};
  let viewsByPostId = {};
  try {
    const postIds = entries.map((e) => e.id).join(",");
    const viewsRes = await fetch(
      `https://public-api.wordpress.com/rest/v1.1/sites/${blogId}/stats/views/posts?post_ids=${postIds}&num=30`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const viewsJson = await viewsRes.json();
    for (const p of viewsJson.posts ?? []) {
      // WordPress's stats/views/posts endpoint returns "ID" (uppercase),
      // unlike almost every other WordPress.com endpoint's lowercase
      // "id" — confirmed directly, this was silently reading undefined
      // before and always falling back to null.
      viewsByPostId[p.ID] = p.views;
    }
  } catch (err) {
    console.log(`  WordPress view stats failed: ${err.message}`);
  }

  for (const entry of entries) {
    try {
      const res = await fetch(
        `https://public-api.wordpress.com/rest/v1.1/sites/${blogId}/posts/${entry.id}?fields=like_count,discussion`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const json = await res.json();
      if (json.error) throw new Error(json.message ?? json.error);
      byId[entry.id] = {
        Views: viewsByPostId[entry.id] ?? null,
        Reactions: json.like_count ?? 0,
        Comments: json.discussion?.comment_count ?? 0,
      };
    } catch (err) {
      console.log(`  WordPress stats failed for post ${entry.id}: ${err.message}`);
    }
  }
  return byId;
}

async function findWordpressArticles() {
  // WordPress articles aren't per-pillar cards — they live as their own
  // files in public/wordpress/<date>.json, one per day (plus an optional
  // -weekly.json). Scan those instead of content-queue.
  const dir = path.join(ROOT, "public", "wordpress");
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const entries = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const article = JSON.parse(await fs.readFile(path.join(dir, file), "utf-8"));
      if (!article.wordpressPostId) continue;
      entries.push({
        id: article.wordpressPostId,
        postId: file.replace(/\.json$/, ""),
        title: article.title,
        pillar: null,
        scheduledAt: article.wordpressScheduledAt ?? null,
      });
    } catch {
      // unreadable, skip
    }
  }
  return entries;
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

  console.log("Fetching Facebook post stats...");
  const fbEntries = await scanCardsForPlatform("facebookPostId", "facebookScheduledAt");
  const fbStats = await fetchFacebookPostStats(fbEntries.filter((e) => !e.scheduledAt || new Date(e.scheduledAt).getTime() <= Date.now()));
  console.log(`  ${fbEntries.length} Facebook posts found`);

  console.log("Fetching Bluesky post stats...");
  const bskyEntries = await scanCardsForPlatform("blueskyPostUri", "blueskyPostedAt");
  const bskyStats = await fetchBlueskyPostStats(bskyEntries);
  console.log(`  ${bskyEntries.length} Bluesky posts found`);

  console.log("Fetching Mastodon status stats...");
  const mastoEntries = await scanCardsForPlatform("mastodonStatusId", "mastodonScheduledAt");
  const mastoStats = await fetchMastodonStatusStats(mastoEntries.filter((e) => !e.scheduledAt || new Date(e.scheduledAt).getTime() <= Date.now()));
  console.log(`  ${mastoEntries.length} Mastodon statuses found`);

  console.log("Fetching WordPress article stats...");
  const wpEntries = await findWordpressArticles();
  const wpStats = await fetchWordpressStats(wpEntries.filter((e) => !e.scheduledAt || new Date(e.scheduledAt).getTime() <= Date.now()));
  console.log(`  ${wpEntries.length} WordPress articles found`);

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
    facebook: fbEntries.map((e) => {
      const isScheduled = e.scheduledAt && new Date(e.scheduledAt).getTime() > now;
      return {
        id: e.id,
        postId: e.postId,
        title: e.title,
        pillar: e.pillar,
        scheduledAt: e.scheduledAt,
        status: isScheduled ? "scheduled" : "live",
        metrics: isScheduled ? {} : fbStats[e.id] ?? {},
      };
    }),
    bluesky: bskyEntries.map((e) => ({
      // Bluesky has no advance scheduling of its own (see bluesky-
      // publish.mjs) — blueskyPostUri only ever gets set at the moment
      // it actually goes live, so every entry here is already live.
      id: e.id,
      postId: e.postId,
      title: e.title,
      pillar: e.pillar,
      scheduledAt: null,
      status: "live",
      metrics: bskyStats[e.id] ?? {},
    })),
    mastodon: mastoEntries.map((e) => {
      const isScheduled = e.scheduledAt && new Date(e.scheduledAt).getTime() > now;
      return {
        id: e.id,
        postId: e.postId,
        title: e.title,
        pillar: e.pillar,
        scheduledAt: e.scheduledAt,
        status: isScheduled ? "scheduled" : "live",
        metrics: isScheduled ? {} : mastoStats[e.id] ?? {},
      };
    }),
    wordpress: wpEntries.map((e) => {
      const isScheduled = e.scheduledAt && new Date(e.scheduledAt).getTime() > now;
      return {
        id: e.id,
        postId: e.postId,
        title: e.title,
        pillar: e.pillar,
        scheduledAt: e.scheduledAt,
        status: isScheduled ? "scheduled" : "live",
        metrics: isScheduled ? {} : wpStats[e.id] ?? {},
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
