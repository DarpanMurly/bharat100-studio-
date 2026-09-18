// Usage: node pipeline/heal-mastodon.mjs
// Self-heal for Mastodon posts that silently vanished after being
// recorded. Unlike Bluesky (which has no native scheduling at all, see
// bluesky-slot-runner.mjs), Mastodon DOES support real scheduled
// publishing — but a scheduled or published status can still disappear
// afterward (found 2026-09-18: 11 statuses across Sept 10-13 were
// recorded in card.json via mastodonStatusId but no longer exist on the
// account at all, confirmed by paginating the account's FULL status
// history, not just the most recent page). Nothing previously re-checked
// whether a recorded Mastodon post was still actually live — this closes
// that gap the same way bluesky-slot-runner.mjs's lookback closes the
// missed-post gap for Bluesky.
//
// Scans the last LOOKBACK_DAYS days of cards with a Mastodon platform
// entry, checks each recorded mastodonStatusId against the account's
// real status history (paginated, not just the most recent 40), and
// re-posts (via mastodon-publish.mjs's own posting path) any card whose
// recorded status is missing. A freshly re-posted status always goes out
// immediately (its original slot time has long passed by definition of
// being an already-published card) — this is a repair of an existing
// gap, not a new scheduled post.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const LOOKBACK_DAYS = 7;

const INSTANCE = process.env.MASTODON_INSTANCE;
const ANALYTICS_TOKEN = process.env.MASTODON_ANALYTICS_TOKEN;
const MASTODON_HANDLE = "bharatat100";

function lastNDates(n) {
  const dates = [];
  const today = new Date();
  for (let i = 0; i <= n; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function fetchAccountId() {
  const res = await fetch(`${INSTANCE}/api/v1/accounts/lookup?acct=${MASTODON_HANDLE}`, {
    headers: { Authorization: `Bearer ${ANALYTICS_TOKEN}` },
  });
  const json = await res.json();
  return json.id ?? null;
}

// REAL BUG found and fixed 2026-09-18, the hard way: a card whose slot is
// still in the FUTURE (i.e. genuinely still sitting as a Mastodon
// ScheduledStatus, not yet published) is correctly absent from the
// account's published status history — that's not loss, that's normal.
// The first version of this script only checked published history and
// treated that absence as "gone," then re-posted a real duplicate
// (2026-09-18_panchanathan26, due 17:00 UTC that day — id 281212 was
// still validly scheduled; the healer created a second scheduled status,
// 281383, with identical text for the same instant). Checking
// GET /api/v1/scheduled_statuses (uses the POSTING token, not the
// analytics one — scheduled_statuses needs write:statuses scope) closes
// this: a status still pending there is alive and must never be touched.
async function fetchScheduledStatusIds() {
  const postToken = process.env.MASTODON_ACCESS_TOKEN;
  if (!postToken) return new Set();
  const res = await fetch(`${INSTANCE}/api/v1/scheduled_statuses?limit=40`, {
    headers: { Authorization: `Bearer ${postToken}` },
  });
  const json = await res.json();
  if (!Array.isArray(json)) return new Set();
  return new Set(json.map((s) => s.id));
}

// Full history, not just the most recent page — a post several days old
// falls outside a single ?limit=40 call, which is exactly what made the
// original "not found" warnings ambiguous (too old to see vs. actually
// gone). Pages back via max_id until either exhausted or clearly past
// the lookback window.
async function fetchFullStatusHistory(accountId, oldestDate) {
  const all = [];
  let maxId = null;
  const oldestMs = new Date(oldestDate).getTime();
  for (let page = 0; page < 20; page++) {
    const url = maxId
      ? `${INSTANCE}/api/v1/accounts/${accountId}/statuses?limit=40&max_id=${maxId}`
      : `${INSTANCE}/api/v1/accounts/${accountId}/statuses?limit=40`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${ANALYTICS_TOKEN}` } });
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    const last = batch[batch.length - 1];
    if (new Date(last.created_at).getTime() < oldestMs) break;
    maxId = last.id;
  }
  return all;
}

async function main() {
  if (!INSTANCE || !ANALYTICS_TOKEN) {
    console.error("Missing MASTODON_INSTANCE or MASTODON_ANALYTICS_TOKEN in .env.");
    process.exit(1);
  }

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const allDirs = await fs.readdir(pendingDir);
  const dates = lastNDates(LOOKBACK_DAYS);

  const candidates = [];
  for (const date of dates) {
    for (const dir of allDirs.filter((d) => d.startsWith(date))) {
      let card;
      try {
        card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
      } catch {
        continue;
      }
      if (!(card.platforms ?? []).includes("Mastodon")) continue;
      if (!card.mastodonStatusId) continue; // never posted at all — a different, already-tracked gap
      // Defense in depth alongside the scheduled_statuses API check below:
      // a card whose own recorded slot time hasn't happened yet is never
      // a candidate, full stop — this is the exact class of card that
      // caused a real duplicate post the first time this script ran
      // (2026-09-18_panchanathan26, slot still ~4 hours out).
      if (card.mastodonScheduledAt && new Date(card.mastodonScheduledAt).getTime() > Date.now()) continue;
      candidates.push({ dir, card });
    }
  }

  if (candidates.length === 0) {
    console.log("No Mastodon-eligible cards with a recorded status in the lookback window.");
    return;
  }

  const accountId = await fetchAccountId();
  if (!accountId) {
    console.error("Could not resolve Mastodon account id — aborting.");
    process.exit(1);
  }

  const oldestDate = dates[dates.length - 1];
  const [history, scheduledIds] = await Promise.all([
    fetchFullStatusHistory(accountId, oldestDate),
    fetchScheduledStatusIds(),
  ]);
  const liveIds = new Set(history.map((s) => s.id));

  function stillAlive(card) {
    // Still genuinely in the future, sitting as a ScheduledStatus — never
    // touch this, regardless of what published history shows (it won't
    // show up there yet by definition). Checked FIRST and unconditionally.
    if (scheduledIds.has(card.mastodonStatusId)) return true;
    if (liveIds.has(card.mastodonStatusId)) return true;
    // Also treat a time-window match as "still alive" — a scheduled
    // post's published id differs from its original ScheduledStatus id
    // (see fetch-analytics.mjs's own note on this), so a raw id miss
    // alone isn't proof of loss if a status exists near the right
    // timestamp.
    if (card.mastodonScheduledAt) {
      const targetMs = new Date(card.mastodonScheduledAt).getTime();
      return history.some((s) => Math.abs(new Date(s.created_at).getTime() - targetMs) < 5 * 60 * 1000);
    }
    return false;
  }

  const missing = candidates.filter(({ card }) => !stillAlive(card));

  if (missing.length === 0) {
    console.log(`Checked ${candidates.length} card(s) — all recorded Mastodon statuses are still live.`);
    return;
  }

  console.log(`Found ${missing.length} card(s) whose recorded Mastodon status no longer exists:`);
  for (const { dir } of missing) console.log(`  ${dir}`);

  for (const { dir } of missing) {
    console.log(`\nRe-posting ${dir}...`);
    try {
      const { stdout, stderr } = await execFileAsync("node", [path.join(ROOT, "pipeline", "mastodon-publish.mjs"), dir], {
        cwd: ROOT,
      });
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (err) {
      console.error(`  ${dir}: re-post failed — ${err.message ?? err}`);
    }
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
