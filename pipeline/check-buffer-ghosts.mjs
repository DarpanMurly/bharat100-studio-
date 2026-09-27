// Usage: node pipeline/check-buffer-ghosts.mjs [lookbackDays]
// Re-verifies every recorded Instagram/Threads/X bufferPostIds entry
// against Buffer's own API and reports any that don't actually exist.
//
// Built 2026-09-27 after finding 11 genuine "ghost" posts (Sep 22-26):
// Buffer's createPost mutation can return a real-looking success
// response (PostActionSuccess with a post id) for a post that never
// actually gets created — confirmed by direct id lookup AND a text-
// match search across the account's full post history. Every existing
// check (check-platform-coverage.mjs included) only verified that
// bufferPostIds[platform] was PRESENT, never that the id it held was
// real — the exact same "presence isn't proof" gap the WordPress
// digest check had before it required a real wordpressPostId (see
// feedback_wordpress_digest_manual_gap memory). This is that same fix
// applied to Buffer.
//
// queuePostVerified() in buffer-publish.mjs now catches this at the
// moment of publishing (verify-and-retry-once, used by
// publish-to-buffer.mjs and retry-failed-buffer.mjs), so this script is
// the second line of defense: a periodic re-sweep in case Buffer's
// backend has some OTHER failure mode (e.g. a post silently deleted
// after creation) that only shows up some time later. Pure DETECTION —
// never re-queues anything; a real finding here needs a human decision
// (or a manual fix script) the same way check-platform-coverage.mjs's
// findings do.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyPostExists } from "./buffer-publish.mjs";
import { X_PUBLISHING_PAUSED } from "./publish-to-buffer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Same default/override pattern as check-missed-days.mjs and
// check-platform-coverage.mjs, for weekly-housekeeping.mjs's
// incremental scans. Default kept short (5, not the usual 14) — see
// MAX_CHECKS_PER_RUN below for why.
const LOOKBACK_DAYS = Number(process.argv[2]) || 5;
// 1200ms between calls — a 500ms pace across 108 ids still tripped
// Buffer's rate limit mid-sweep on 2026-09-27 (confirmed via a direct
// API test showing a live 429 immediately after). Slower but reliable;
// this check only needs to run weekly, not fast.
const PACE_MS = 1200;
// Buffer enforces TWO stacked limits, confirmed via response headers
// during the 2026-09-27 incident: 100 requests/15min AND a much
// tighter 250 requests/DAY, shared across the whole account (every
// script that calls Buffer's API, not just this one). A single test
// run of 108 checks burned nearly half that daily budget and, combined
// with the same day's other Buffer calls (11 ghost-post fixes,
// diagnostics), fully exhausted it — blocking Buffer API access
// (though not already-scheduled posts, which Buffer delivers
// independently) for the following ~16 hours. This check must never be
// the thing that eats the account's daily quota, so it hard-caps
// itself well under half of it and simply defers the rest to next run
// rather than trying to finish in one pass.
const MAX_CHECKS_PER_RUN = 60;

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);

  const today = new Date();
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);

  const checks = [];
  for (const dir of dirs) {
    const dateStr = dir.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;
    if (new Date(`${dateStr}T00:00:00Z`) < cutoff) continue;

    let card;
    try {
      card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
    } catch {
      continue;
    }
    for (const [platform, id] of Object.entries(card.bufferPostIds ?? {})) {
      if (platform.toLowerCase() === "x" && X_PUBLISHING_PAUSED) continue;
      checks.push({ dir, platform, id });
    }
  }

  const toCheck = checks.slice(0, MAX_CHECKS_PER_RUN);
  const deferred = checks.length - toCheck.length;
  console.log(`Checking ${toCheck.length} of ${checks.length} recorded Buffer post id(s) across the last ${LOOKBACK_DAYS} day(s)${deferred > 0 ? ` (capped at ${MAX_CHECKS_PER_RUN}/run to protect Buffer's 250-req/day account-wide limit — ${deferred} deferred to a future run)` : ""}...`);

  const ghosts = [];
  let checkedCount = 0;
  for (const c of toCheck) {
    let exists;
    try {
      exists = await verifyPostExists(c.id);
    } catch (err) {
      // Rate-limited mid-sweep (confirmed 2026-09-27 this can happen on
      // a sweep this size) — stop immediately rather than let every
      // remaining check fail closed and read as a wave of new ghosts.
      // Whatever was found before the limit hit is still trustworthy;
      // everything after it is simply unchecked, not confirmed missing.
      console.log(`\nStopped after ${checkedCount}/${checks.length} checks — hit a rate limit: ${err.message}`);
      console.log(`Re-run later (or with a shorter lookback) to cover the rest.`);
      break;
    }
    checkedCount++;
    if (!exists) ghosts.push(c);
    await new Promise((r) => setTimeout(r, PACE_MS));
  }

  if (ghosts.length === 0) {
    const uncheckedTotal = checks.length - checkedCount;
    console.log(`All ${checkedCount} checked Buffer post(s) verified live. No ghosts found${uncheckedTotal > 0 ? ` (${uncheckedTotal} left unchecked this run, see above)` : ""}.`);
    return;
  }

  console.log(`\nFound ${ghosts.length} GHOST post(s) — recorded as scheduled but not found on Buffer:`);
  for (const g of ghosts) {
    console.log(`  ${g.dir} / ${g.platform} / ${g.id}`);
  }
  console.log(`\nThis is detection-only: nothing was changed. Re-queue each via queuePostVerified before writing a fixed id back to bufferPostIds.`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
