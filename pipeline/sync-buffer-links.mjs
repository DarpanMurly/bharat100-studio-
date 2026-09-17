// Usage: node pipeline/sync-buffer-links.mjs
// Buffer's own post id (stored in card.bufferPostIds) is Buffer's internal
// id, not Instagram/Threads' native post shortcode — there's no way to
// build a real public URL from it directly. Buffer's own `externalLink`
// field on a SENT post has the actual live permalink, so this script
// bulk-fetches that field for every sent Instagram/Threads post and writes
// it back to each card as bufferPostLinks.{Instagram,Threads}, for the
// homepage archive to link to (see build-archive-data.mjs).
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const API_KEY = process.env.BUFFER_API_KEY;

const CHANNEL_IDS = {
  Instagram: process.env.BUFFER_CHANNEL_INSTAGRAM,
  Threads: process.env.BUFFER_CHANNEL_THREADS,
};

async function graphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

const ORG_QUERY = `query { account { organizations { id } } }`;
const POSTS_QUERY = `
  query Posts($organizationId: OrganizationId!, $channelIds: [ChannelId!]!, $first: Int!, $after: String) {
    posts(input: { organizationId: $organizationId, filter: { channelIds: $channelIds, status: [sent] } }, first: $first, after: $after) {
      edges { node { id externalLink } cursor }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

// The default page size (10) badly undercounts a channel with 50+ sent
// posts — found 2026-09-17 while wiring up homepage platform links: a
// card's Threads post existed and had a real externalLink, but a
// single-page, no-pagination query never reached it. Page through
// everything sent so far instead of trusting any one page to be complete.
async function fetchAllSentLinks(organizationId, channelId) {
  const links = {};
  let after = null;
  for (;;) {
    const data = await graphql(POSTS_QUERY, { organizationId, channelIds: [channelId], first: 100, after });
    for (const { node } of data.posts.edges) {
      if (node.externalLink) links[node.id] = node.externalLink;
    }
    if (!data.posts.pageInfo.hasNextPage) break;
    after = data.posts.pageInfo.endCursor;
  }
  return links;
}

async function main() {
  const { account } = await graphql(ORG_QUERY);
  const orgId = account.organizations[0].id;

  // id -> externalLink, per platform
  const linksByPlatform = {};
  for (const [platform, channelId] of Object.entries(CHANNEL_IDS)) {
    if (!channelId) continue;
    linksByPlatform[platform] = await fetchAllSentLinks(orgId, channelId);
  }

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);
  let updated = 0;

  for (const dir of dirs) {
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    if (!card.bufferPostIds) continue;

    let changed = false;
    const bufferPostLinks = { ...(card.bufferPostLinks ?? {}) };
    for (const [platform, postId] of Object.entries(card.bufferPostIds)) {
      const link = linksByPlatform[platform]?.[postId];
      if (link && bufferPostLinks[platform] !== link) {
        bufferPostLinks[platform] = link;
        changed = true;
      }
    }

    if (changed) {
      card.bufferPostLinks = bufferPostLinks;
      await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
      updated++;
    }
  }

  console.log(`Synced Buffer external links for ${updated} card(s).`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
