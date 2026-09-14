// Usage: node pipeline/check-missed-days.mjs
// Scans the last 14 days for any date that should have had a full 5-pillar
// batch but doesn't (fewer than 5 pillar folders exist, or none at all).
// This is a pure DETECTION tool — it never auto-generates, backfills, or
// reposts anything. Per an explicit 2026-09-14 decision: a missed day is
// surfaced honestly so a human decides what to do about it, never silently
// patched over by reusing old content. A daily archive that quietly
// disguises a gap undermines the exact "honest, dated record" premise this
// project's whole credibility (and long-term business plan) depends on.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXPECTED_PILLARS = 5;
const LOOKBACK_DAYS = 14;
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

    if (pillarsFound.size < EXPECTED_PILLARS) {
      missed.push({ date: dateStr, found: pillarsFound.size, pillars: [...pillarsFound] });
    }
  }

  if (missed.length === 0) {
    console.log(`No missed days in the last ${LOOKBACK_DAYS} days — every date has a full ${EXPECTED_PILLARS}-pillar batch.`);
    return;
  }

  console.log(`Found ${missed.length} day(s) in the last ${LOOKBACK_DAYS} with an incomplete batch:\n`);
  for (const m of missed) {
    console.log(`  ${m.date}: ${m.found}/${EXPECTED_PILLARS} pillars present${m.pillars.length ? ` (${m.pillars.join(", ")})` : " (none at all)"}`);
  }
  console.log(`\nThis is a detection-only report — nothing was auto-generated or backfilled.`);
  console.log(`Decide per day: backfill honestly-dated (clearly noting it was written later), or accept the gap.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
