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
        if (card.youtubeVideoId) ids.push({ id: card.youtubeVideoId, postId: dir, title: card.title });
      } catch {
        // no card.json or unreadable, skip
      }
    }
    return ids;
  });
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

  console.log("Fetching YouTube video stats...");
  const ytEntries = await findYoutubeVideoIds();
  const ytStats = await fetchYoutubeVideoStats(ytEntries.map((e) => e.id));
  console.log(`  ${ytEntries.length} YouTube videos found`);

  const summary = {
    fetchedAt: new Date().toISOString(),
    buffer: bufferPosts.map((p) => ({
      id: p.id,
      platform: p.channel.service,
      text: p.text.slice(0, 80),
      sentAt: p.sentAt,
      metrics: bufferMetricsToObject(p.metrics),
    })),
    youtube: ytEntries.map((e) => ({
      videoId: e.id,
      postId: e.postId,
      title: e.title,
      stats: ytStats[e.id] ?? null,
    })),
  };

  const outPath = path.join(ROOT, "content-queue", "analytics-snapshot.json");
  await fs.writeFile(outPath, JSON.stringify(summary, null, 2), "utf-8");
  console.log(`\nSnapshot written to ${outPath}`);
  console.log(`Next: push this into the Content Desk artifact's "analytics" collection.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
