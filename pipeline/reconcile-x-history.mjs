// Usage: node pipeline/reconcile-x-history.mjs
// One-off reconciliation: fetches the REAL, complete list of posts
// (sent + scheduled) on the new X channel directly from Buffer — ground
// truth — and rebuilds every content-queue card's bufferPostIds.X field
// to match reality, instead of trusting local logs/marker files that
// went out of sync when Buffer's API started rate-limiting mid-backfill
// on 2026-09-19 (some successful posts' card.json writes were lost when
// the process failed on a LATER card in the same batch).
//
// Matching a Buffer post back to a specific local card is done by exact
// text match against that card's captionX (or caption, as a fallback) —
// the same field backfill-x-history.mjs used to create the post in the
// first place, so this is a reliable round-trip key, not a guess.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ORG_ID = "6a9b31a1d4a31de04ff89696";
const NEW_X_CHANNEL_ID = process.env.BUFFER_CHANNEL_TWITTER;

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

async function fetchAllXPosts(status) {
  const query = `
    query Posts($organizationId: OrganizationId!, $first: Int!, $after: String, $channelIds: [ChannelId!]!) {
      posts(input: { organizationId: $organizationId, filter: { status: [${status}], channelIds: $channelIds } }, first: $first, after: $after) {
        edges { node { id text dueAt } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const all = [];
  let after = null;
  while (true) {
    const data = await graphql(query, { organizationId: ORG_ID, first: 50, after, channelIds: [NEW_X_CHANNEL_ID] });
    all.push(...data.posts.edges.map((e) => e.node));
    if (!data.posts.pageInfo.hasNextPage) break;
    after = data.posts.pageInfo.endCursor;
  }
  return all;
}

function normalize(text) {
  return (text ?? "").trim().replace(/\s+/g, " ");
}

async function main() {
  if (!NEW_X_CHANNEL_ID) throw new Error("BUFFER_CHANNEL_TWITTER not set in .env");

  console.log("Fetching all sent + scheduled posts on the new X channel...");
  const [sent, scheduled] = await Promise.all([fetchAllXPosts("sent"), fetchAllXPosts("scheduled")]);
  const allPosts = [...sent, ...scheduled];
  console.log(`Found ${sent.length} sent + ${scheduled.length} scheduled = ${allPosts.length} total posts on the new X account.`);

  // Build a lookup by normalized text -> post id (first match wins if
  // duplicates exist, which the report below will flag).
  const byText = new Map();
  const duplicates = [];
  for (const post of allPosts) {
    const key = normalize(post.text);
    if (byText.has(key)) duplicates.push({ text: key.slice(0, 60), ids: [byText.get(key), post.id] });
    else byText.set(key, post.id);
  }

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => !d.endsWith("_weekly-recap")).sort();

  let matched = 0;
  let alreadyCorrect = 0;
  let stillMissing = [];
  const usedPostIds = new Set();

  for (const dir of dirs) {
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    if (!(card.platforms ?? []).includes("X")) continue;
    if (card.status !== "posted" && card.status !== "scheduled") continue;

    const text = normalize(card.captionX ?? card.caption);
    const foundId = byText.get(text);

    const currentId = card.bufferPostIds?.X;
    if (foundId) {
      usedPostIds.add(foundId);
      if (currentId === foundId) {
        alreadyCorrect++;
      } else {
        card.bufferPostIds = { ...(card.bufferPostIds ?? {}), X: foundId };
        await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
        matched++;
        console.log(`  [${dir}] corrected: X -> ${foundId}`);
      }
    } else {
      // Not found on the new account at all — this is a real remaining
      // gap (future-dated Sept 20 cards are expected here, everything
      // else is a genuine miss).
      stillMissing.push(dir);
    }
  }

  console.log(`\n${alreadyCorrect} already correct, ${matched} corrected, ${stillMissing.length} still missing.`);
  if (duplicates.length > 0) {
    console.log(`\n${duplicates.length} DUPLICATE post(s) found on the new X account (same text posted twice):`);
    for (const d of duplicates) console.log(`  "${d.text}..." -> ${d.ids.join(", ")}`);
  }
  const unmatchedPosts = allPosts.filter((p) => !usedPostIds.has(p.id));
  if (unmatchedPosts.length > 0) {
    console.log(`\n${unmatchedPosts.length} post(s) exist on X but don't match any known card by text (could be the weekly recap, a stray manual post, or a caption that's since been edited):`);
    for (const p of unmatchedPosts.slice(0, 20)) console.log(`  ${p.id}: "${normalize(p.text).slice(0, 60)}..."`);
  }
  if (stillMissing.length > 0) {
    console.log(`\nCards still missing an X post entirely:`);
    for (const d of stillMissing) console.log(`  ${d}`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
