// Usage: node pipeline/check-platform-coverage.mjs
// Cross-platform DETECTION-only check: for each of the last N days, verifies
// every pillar's card actually has a recorded post id on every platform it
// claims to be on, AND that a WordPress digest article exists for that date.
// Built 2026-09-17 after two real, unnoticed gaps: Bluesky silently skipped
// 8 cards because their status never reached "scheduled" (Instagram queue
// jam) with no retry, and WordPress had a 4-day gap because it's a fully
// manual step with nothing watching it at all. Neither surfaced until asked
// about directly — this exists so the daily routine catches both classes of
// gap without anyone needing to ask.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { X_PUBLISHING_PAUSED } from "./publish-to-buffer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
// Optional CLI arg overrides the default 4-day rolling window — used for
// a one-off full-history audit (e.g. `node check-platform-coverage.mjs 30`)
// without changing the fast daily-routine default.
const LOOKBACK_DAYS = Number(process.argv[2]) || 4;

const PLATFORM_FIELD = {
  YouTube: "youtubeVideoId",
  Facebook: "facebookPostId",
  Mastodon: "mastodonStatusId",
  Bluesky: "blueskyPostUri",
  Pinterest: "pinterestPinId",
};
// Instagram/Threads/X live under bufferPostIds[platform], checked separately.
const BUFFER_PLATFORMS = ["Instagram", "Threads", "X"];
// Pinterest has been failing on every post since ~2026-09-08 (Trial access,
// not yet approved for production — see project_pinterest_pending memory).
// This is a known, external, currently-unfixable blocker, not a new bug —
// bucket it separately so it doesn't bury genuinely actionable gaps in the
// same list, but still surface it (rather than silently exclude it) so a
// status approval, once it lands, is noticed promptly.
const KNOWN_EXTERNAL_BLOCKERS = new Set(["Pinterest"]);

function lastNDates(n) {
  const dates = [];
  const today = new Date();
  for (let i = 1; i <= n; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const allDirs = await fs.readdir(pendingDir);
  const dates = lastNDates(LOOKBACK_DAYS);

  const gaps = [];
  const knownBlockers = [];

  for (const date of dates) {
    const dayDirs = allDirs.filter((d) => d.startsWith(date) && !d.endsWith("_weekly-recap"));
    if (dayDirs.length === 0) continue; // handled by check-missed-days.mjs instead

    for (const dir of dayDirs) {
      let card;
      try {
        card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
      } catch {
        continue;
      }
      const platforms = card.platforms ?? [];
      const missing = [];
      const blocked = [];

      for (const p of platforms) {
        if (p === "X" && X_PUBLISHING_PAUSED) continue; // intentionally paused, not a gap
        let hasId;
        if (BUFFER_PLATFORMS.includes(p)) {
          hasId = !!card.bufferPostIds?.[p];
        } else if (PLATFORM_FIELD[p]) {
          hasId = !!card[PLATFORM_FIELD[p]];
        } else {
          continue; // Substack/Medium — separate manual-prep flows, not auto-publish targets
        }
        if (!hasId) {
          if (KNOWN_EXTERNAL_BLOCKERS.has(p)) blocked.push(p);
          else missing.push(p);
        }
      }

      if (missing.length > 0) gaps.push({ dir, date, missing });
      if (blocked.length > 0) knownBlockers.push({ dir, date, blocked });
    }

    // WordPress digest check — separate from per-card fields entirely, since
    // it's one combined article per day with its own file, not attached to
    // any single pillar's card (see feedback_wordpress_digest_manual_gap).
    // The digest pillar (along with Global Bharat/Diaspora Dividend) only
    // launched 2026-09-08 — dates before that genuinely never had one, so
    // skip them rather than flag pre-launch history as a false gap.
    if (date < "2026-09-08") continue;
    const wpPath = path.join(ROOT, "public", "wordpress", `${date}.json`);
    try {
      await fs.access(wpPath);
    } catch {
      gaps.push({ dir: `(WordPress digest)`, date, missing: ["WordPress article not written"] });
    }
  }

  if (gaps.length === 0) {
    console.log(`No actionable platform-coverage gaps in the last ${LOOKBACK_DAYS} days.`);
  } else {
    console.log(`Found ${gaps.length} ACTIONABLE gap(s) in the last ${LOOKBACK_DAYS} days:\n`);
    for (const g of gaps) {
      console.log(`  ${g.date}  ${g.dir}: missing ${g.missing.join(", ")}`);
    }
    console.log(`\nThis is a detection-only report — decide per gap whether to retry, backfill, or accept it.`);
  }

  if (knownBlockers.length > 0) {
    console.log(`\n${knownBlockers.length} entr(y/ies) blocked on a KNOWN external issue (not new, no action needed unless it changes):`);
    for (const b of knownBlockers) {
      console.log(`  ${b.date}  ${b.dir}: ${b.blocked.join(", ")}`);
    }
  }

  if (gaps.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
