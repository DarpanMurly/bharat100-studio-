// Usage: node pipeline/check-staleness.mjs <path-to-content-json | scriptId | date>
//
// Flags a candidate piece whose cited data year is old relative to its
// publishDate, so an outdated stat doesn't get treated as "the latest" by
// mistake. Does NOT auto-block (some pillars, like On This Day, are
// legitimately about old dates on purpose) — prints a flagged report for a
// human decision, same pattern as check-duplicate.mjs.
//
// Built 2026-09-13 after a real incident: a Diaspora Dividend candidate used
// NRI tourism arrival data from calendar year 2024 in a piece meant to
// publish September 2026 — a 2-year-old figure sitting next to other pieces
// the same week citing FY2025-26 data. The number itself turned out to
// still be the genuine latest-available figure (government tourism data
// lags 12-18 months, confirmed by checking for a newer release before
// concluding this), so the right fix wasn't a newer number, it was framing
// ("latest available data, released Feb 2026") — but that should be an
// explicit, checked decision, not something that slips through unnoticed.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Pillars where citing an old year is the entire point, not staleness —
// never flag these on year-distance alone.
const EXEMPT_PILLARS = new Set(["Builder Story", "On This Day"]);

// Matches "2024", "FY2024-25", "FY 2025-26", "financial year 2024-25",
// "in 2019" etc. Captures the FIRST (earliest) year in a range like
// "2024-25" since that's the year the underlying data actually describes.
const YEAR_TOKEN = /\bFY\s?(\d{4})-\d{2}\b|\b(\d{4})-\d{2}\b|\b(20[12]\d)\b/g;

function extractYears(text) {
  const years = new Set();
  for (const m of text.matchAll(YEAR_TOKEN)) {
    const y = Number(m[1] ?? m[2] ?? m[3]);
    if (y >= 2015 && y <= 2030) years.add(y);
  }
  return years;
}

function flattenText(json) {
  const parts = [];
  // publishDate/date are ISO strings like "2026-09-13" — structurally
  // identical to a "YYYY-MM" fiscal-year-range match, but they describe
  // WHEN this piece publishes, not what year its cited data is from.
  // Scanning them would make every piece look artificially "current" (a
  // real bug hit while building this: publishDate "2026-09-13" matched as
  // fiscal year "2026-09", inflated to effective year 2027, which then
  // made a genuinely 2-year-stale 2024 stat register as "current").
  //
  // sources is ALSO excluded — a "Publication, 2026 - ..." citation names
  // when the source was READ/published, not what year the underlying data
  // describes (a second real bug hit here: "ThePrint, 2026" in a sources
  // array made a genuinely 2-year-old 2024 tourism stat register as
  // "current" for the same reason). The actual data-year lives in the
  // narrative/stat text (scenes, slides, caption), not the citation list.
  const { publishDate, date, sources, ...rest } = json ?? {};
  const walk = (val) => {
    if (typeof val === "string") parts.push(val);
    else if (Array.isArray(val)) val.forEach(walk);
    else if (val && typeof val === "object") Object.values(val).forEach(walk);
  };
  walk(rest);
  return parts.join(" \n ");
}

async function resolveCandidatePath(arg) {
  try {
    await fs.access(arg);
    return arg;
  } catch {
    // fall through
  }
  const guesses = [
    path.join(ROOT, "src", "scripts", `${arg}.json`),
    path.join(ROOT, "public", "on-this-day", `${arg}.json`),
    path.join(ROOT, "public", "global-bharat", `${arg}.json`),
    path.join(ROOT, "public", "wordpress", `${arg}.json`),
  ];
  for (const g of guesses) {
    try {
      await fs.access(g);
      return g;
    } catch {
      // try next
    }
  }
  throw new Error(`Could not find content JSON for "${arg}" — pass a full path or a known scriptId/date.`);
}

// A fiscal-year-aware "how old is this data" measure: FY2025-26 running
// through March 2027 is treated as referring to 2026 (its later half),
// not 2025, since that's the year most of the FY actually covers and how
// people read "this financial year" in a Sept 2026 post. Plain calendar
// years are used as-is.
function effectiveDataYear(year, rawMatch) {
  if (/FY|(\d{4})-\d{2}/.test(rawMatch)) return year + 1;
  return year;
}

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node pipeline/check-staleness.mjs <path-to-content-json | scriptId | date>");
    process.exit(1);
  }

  const candidatePath = await resolveCandidatePath(arg);
  const json = JSON.parse(await fs.readFile(candidatePath, "utf-8"));
  const text = flattenText(json);

  const publishDate = json.publishDate ? new Date(json.publishDate) : new Date();
  const publishYear = publishDate.getUTCFullYear();

  console.log(`\n=== Staleness check: ${path.basename(candidatePath)} (publishing ${publishDate.toISOString().slice(0, 10)}) ===`);

  if (EXEMPT_PILLARS.has(json.pillar)) {
    console.log(`Pillar "${json.pillar}" is exempt (old dates are the point of this format) — skipping.`);
    return;
  }

  const rawMatches = [...text.matchAll(YEAR_TOKEN)];
  if (rawMatches.length === 0) {
    console.log("No year references found in this content — nothing to check.");
    return;
  }

  const distances = new Map(); // effectiveYear -> raw match strings seen
  for (const m of rawMatches) {
    const year = Number(m[1] ?? m[2] ?? m[3]);
    if (year < 2015 || year > 2030) continue;
    const eff = effectiveDataYear(year, m[0]);
    if (!distances.has(eff)) distances.set(eff, new Set());
    distances.get(eff).add(m[0]);
  }

  const newestYear = Math.max(...distances.keys());
  const staleness = publishYear - newestYear;

  console.log(`Newest data-year reference found: ${newestYear} (${publishYear - newestYear} year(s) behind publish year ${publishYear})`);
  for (const [year, raws] of [...distances.entries()].sort((a, b) => b[0] - a[0])) {
    console.log(`  ${year}: ${[...raws].join(", ")}`);
  }

  if (staleness >= 2) {
    console.log(`\nVERDICT: FLAGGED — most recent cited data is ${staleness} years old relative to publish date.`);
    console.log(`Do not treat this as ready to publish yet. First, actively search for a newer release —`);
    console.log(`don't assume this is latest-available just because an earlier check said so. If a newer`);
    console.log(`figure exists, use it instead. If this is genuinely still the latest published data`);
    console.log(`(common for annual government datasets, which can lag 12-18+ months), the piece must say`);
    console.log(`so explicitly ("latest available data, released <month/year>") rather than reading as`);
    console.log(`current-year — re-run this check after that framing is added to confirm it passes.`);
    process.exitCode = 1;
  } else if (staleness === 1) {
    console.log(`\nVERDICT: OK, mildly aged (1 year behind) — common for annual data with reporting lag. No action needed unless a newer release is known to exist.`);
  } else {
    console.log(`\nVERDICT: OK — data is current relative to publish date.`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
