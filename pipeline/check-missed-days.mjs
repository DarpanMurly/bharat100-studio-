// Usage: node pipeline/check-missed-days.mjs
// Scans the last 14 days for any date that should have had a full 5-pillar
// batch but doesn't (fewer than 5 pillar folders exist, or none at all),
// AND (added 2026-09-17) whether that date's WordPress daily digest article
// was ever written. This is a pure DETECTION tool — it never auto-generates,
// backfills, or reposts anything. Per an explicit 2026-09-14 decision: a
// missed day is surfaced honestly so a human decides what to do about it,
// never silently patched over by reusing old content. A daily archive that
// quietly disguises a gap undermines the exact "honest, dated record"
// premise this project's whole credibility (and long-term business plan)
// depends on.
//
// WordPress is generated the same way as the 5 video pillars — a real
// synthesis pass done once a day, same session, not a separate manual
// chore — but unlike the pillars, nothing was ever checking whether it
// actually happened; a 4-day WordPress gap went unnoticed for exactly that
// reason (see feedback_wordpress_digest_manual_gap memory). Folding it into
// this same check means the same "run this every session" habit that
// already catches a missed video pillar now also catches a missed digest.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPECTED_PILLARS = 5;
// Optional CLI arg overrides the default 14-day rolling window — used by
// weekly-housekeeping.mjs for a narrower incremental scan on any run
// after its first (added 2026-09-20, same pattern as
// check-platform-coverage.mjs's own LOOKBACK_DAYS override).
const LOOKBACK_DAYS = Number(process.argv[2]) || 14;
// The 5-pillar structure (Global Bharat + Diaspora Dividend added to the
// original 3) only existed from this date onward — every day before it
// legitimately has fewer than 5 pillars by design, not as a real gap.
// Never flag anything before this floor.
const FIVE_PILLAR_FLOOR = "2026-09-08";

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);

  const today = new Date();
  const missed = [];

  for (let i = 1; i <= LOOKBACK_DAYS; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    if (dateStr < FIVE_PILLAR_FLOOR) continue;

    const dayDirs = dirs.filter((dir) => dir.startsWith(dateStr) && !dir.endsWith("_weekly-recap"));
    // Count distinct pillars actually present (not just folder count, in
    // case of a rare duplicate) by reading each card's pillar field.
    const pillarsFound = new Set();
    for (const dir of dayDirs) {
      try {
        const card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
        if (card.pillar) pillarsFound.add(card.pillar);
      } catch {
        // unreadable card, skip
      }
    }

    // Checking the file EXISTS is not enough — drafting/checking a digest
    // and actually publishing it are two separate steps, and a digest can
    // sit fully written on disk, having passed check-duplicate.mjs and
    // check-staleness.mjs, without ever being sent to WordPress (found
    // 2026-09-23: the Sept 22 digest was drafted and checked but the
    // wordpress-cover.mjs/wordpress-publish.mjs step was simply never run
    // that session — this check reported "all good" the whole time
    // because the file was present, masking a genuine unpublished gap
    // until the user noticed the article wasn't live). Require a real
    // wordpressPostId, written only after a successful publish.
    let wordpressMissing = false;
    try {
      const wp = JSON.parse(await fs.readFile(path.join(ROOT, "public", "wordpress", `${dateStr}.json`), "utf-8"));
      if (!wp.wordpressPostId) wordpressMissing = true;
    } catch {
      wordpressMissing = true;
    }

    if (pillarsFound.size < EXPECTED_PILLARS || wordpressMissing) {
      missed.push({ date: dateStr, found: pillarsFound.size, pillars: [...pillarsFound], wordpressMissing });
    }
  }

  // Report against the number of days ACTUALLY checked (floored at
  // FIVE_PILLAR_FLOOR), not the raw LOOKBACK_DAYS window size - saying
  // "last 14 days" when the 5-pillar structure has only existed for
  // ~7 is misleading (found 2026-09-15, user caught it directly).
  const todayStr = today.toISOString().slice(0, 10);
  const daysActuallyChecked = Math.max(
    0,
    Math.round((new Date(todayStr) - new Date(FIVE_PILLAR_FLOOR)) / 86400000)
  );

  if (missed.length === 0) {
    console.log(`No missed days since the 5-pillar structure began (${FIVE_PILLAR_FLOOR}, ${daysActuallyChecked} day(s) checked) — every date has a full ${EXPECTED_PILLARS}-pillar batch AND a WordPress digest.`);
    return;
  }

  console.log(`Found ${missed.length} day(s) since ${FIVE_PILLAR_FLOOR} (${daysActuallyChecked} day(s) checked) with an incomplete batch:\n`);
  for (const m of missed) {
    const parts = [];
    if (m.found < EXPECTED_PILLARS) {
      parts.push(`${m.found}/${EXPECTED_PILLARS} pillars present${m.pillars.length ? ` (${m.pillars.join(", ")})` : " (none at all)"}`);
    }
    if (m.wordpressMissing) parts.push("WordPress digest not written");
    console.log(`  ${m.date}: ${parts.join("; ")}`);
  }
  console.log(`\nThis is a detection-only report — nothing was auto-generated or backfilled.`);
  console.log(`Decide per day: backfill honestly-dated (clearly noting it was written later), or accept the gap.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
