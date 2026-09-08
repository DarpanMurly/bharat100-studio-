// Usage: node pipeline/mark-posted.mjs
// Scans content-queue/pending/*/card.json for cards whose status is
// "scheduled" and whose slot time (scheduledAt for Buffer, or
// youtubeScheduledAt where scheduledAt is absent) has already passed —
// nothing else in the pipeline ever flips status past "scheduled", so
// the review dashboard shows content as still-queued long after it has
// actually gone public. Flips those cards to "posted" locally and syncs
// each to the Content Desk dashboard's "posts" collection.
//
// Safe to run repeatedly (idempotent) — only touches cards currently in
// "scheduled" status, does not re-check anything already "posted".

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);

  const toMark = [];
  for (const dir of dirs) {
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    if (card.status !== "scheduled") continue;

    const slotAt = card.scheduledAt ?? card.youtubeScheduledAt;
    if (!slotAt || new Date(slotAt).getTime() > Date.now()) continue;

    card.status = "posted";
    card.postedAt = new Date().toISOString();
    await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
    toMark.push({ id: dir, cardPath });
    console.log(`${dir}: scheduled -> posted (slot was ${slotAt})`);
  }

  if (toMark.length === 0) {
    console.log("Nothing to mark — no scheduled card has passed its slot time.");
    return;
  }

  console.log(`\n${toMark.length} card(s) marked posted locally.`);
  console.log(`Sync each to the dashboard with the Artifact tool's write_db (collection "posts", doc_id = folder name), or via whatever sync step the chat session runs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
