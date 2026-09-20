// Usage: node pipeline/check-website-accuracy.mjs
// Post-deploy verification: fetches the LIVE bharatat100.com homepage and
// confirms it's actually serving what content-queue/archive-data.json
// (the source of truth build-homepage.mjs generates from) says it should.
// This is deliberately separate from check-platform-coverage.mjs, which
// only checks whether a card HAS a recorded platform link — it never
// confirms the live site actually shows that link (a stale deploy, a
// caching layer, or a broken build could all pass coverage but still
// serve a wrong or outdated page). Built 2026-09-19 per the user's
// explicit ask that the daily website update be checked for accuracy,
// not just assumed correct because the deploy step didn't error.
//
// Checks a bounded recent sample by default (fast daily check, 3 days),
// but accepts an optional CLI arg for a full-archive sweep — the entire
// archiveData object is embedded directly in the page's own JS (not
// server-side-paginated), so every entry's links ARE actually checkable
// here, not just the most recent ones; the day-window only exists to
// keep the routine daily check fast, same pattern as
// check-platform-coverage.mjs's own LOOKBACK_DAYS override (added
// 2026-09-20 for weekly-housekeeping.mjs's full-history sweep).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITE_URL = "https://bharatat100.com/";
// "all" checks every entry in the archive regardless of date.
const argRaw = process.argv[2];
const CHECK_LAST_N_DAYS = argRaw === "all" ? Infinity : Number(argRaw) || 3;

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

async function main() {
  const archivePath = path.join(ROOT, "content-queue", "archive-data.json");
  const { entries } = JSON.parse(await fs.readFile(archivePath, "utf-8"));

  const checkingAll = !Number.isFinite(CHECK_LAST_N_DAYS);
  const recentDates = checkingAll ? null : new Set(lastNDates(CHECK_LAST_N_DAYS));
  const recentEntries = checkingAll ? entries : entries.filter((e) => recentDates.has(e.date));
  const windowLabel = checkingAll ? "the full archive" : `the last ${CHECK_LAST_N_DAYS} days`;

  if (recentEntries.length === 0) {
    console.log(`No archive entries in ${windowLabel} to check against — nothing to verify.`);
    return;
  }

  let html;
  try {
    const res = await fetch(SITE_URL, { headers: { "Cache-Control": "no-cache" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.error(`Could not fetch the live site at ${SITE_URL}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  const mismatches = [];
  for (const entry of recentEntries) {
    const links = entry.platformLinks ?? {};
    if (entry.youtubeUrl) links.YouTube = entry.youtubeUrl;

    for (const [platform, url] of Object.entries(links)) {
      if (!url) continue;
      if (!html.includes(url)) {
        mismatches.push({ date: entry.date, id: entry.id, platform, url });
      }
    }
  }

  if (mismatches.length === 0) {
    console.log(`Live site at ${SITE_URL} matches archive data for all ${recentEntries.length} entr(y/ies) in ${windowLabel}.`);
  } else {
    console.log(`Found ${mismatches.length} LINK MISMATCH(ES) between archive-data.json and the live site:\n`);
    for (const m of mismatches) {
      console.log(`  ${m.date}  ${m.id}: ${m.platform} link not found on live page (${m.url})`);
    }
    console.log(`\nThis means the live site is stale or the last deploy didn't actually publish this data — re-run deploy-homepage.mjs and check the Pages deploy workflow.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
