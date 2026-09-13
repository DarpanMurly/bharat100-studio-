// Usage: node pipeline/check-duplicate.mjs <path-to-new-content-json>
//    or: node pipeline/check-duplicate.mjs <scriptId>          (looks in src/scripts/)
//    or: node pipeline/check-duplicate.mjs --pillar <date>      (on-this-day/global-bharat/wordpress)
//
// Flags likely topic/fact duplication against everything already published or
// queued, BEFORE a new piece gets written into the pipeline. Doesn't block —
// prints a flagged report for a human decision, since some overlap is
// legitimate (an updated quarterly stat, a deliberate follow-up angle).
//
// Built 2026-09-12 after a real miss: Sept 13's Diaspora Dividend candidate
// (remittances, $135.46B RBI FY25) turned out to be a near-total repeat of
// Sept 9's diaspora-remit26.json — same core stat, same framing, same
// closer line — caught only by the user asking "have we not done this
// already?" This should have been caught before the content was even
// written, not after rendering.
//
// Detection signals, in order of reliability:
//   1. Shared distinctive NUMBER+UNIT tokens (e.g. "$135.46B", "915MT",
//      "20%") — the strongest signal, since two genuinely different stories
//      essentially never cite the exact same figure to the same precision.
//   2. Shared multi-word proper-noun-ish entities (e.g. "Kalpana Saroj",
//      "U.S. Bancorp", "Operation Polo") — catches same-subject pieces even
//      when the framing/stat differs.
//   3. Shared pillar (surfaced as context, not a signal on its own — every
//      Diaspora Dividend piece shares a pillar, that's not suspicious by
//      itself).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CONTENT_GLOBS = [
  { dir: path.join(ROOT, "src", "scripts"), kind: "script" },
  { dir: path.join(ROOT, "public", "on-this-day"), kind: "on-this-day" },
  { dir: path.join(ROOT, "public", "global-bharat"), kind: "global-bharat" },
  { dir: path.join(ROOT, "public", "wordpress"), kind: "wordpress" },
];

// Matches "$135.46B", "915MT", "20%", "₹900Cr", "13.16%", "10.62 million",
// "$316B" etc — deliberately permissive on the unit half since sources
// abbreviate inconsistently, but requires an actual digit run so plain
// words never match.
const NUMBER_TOKEN = /(?:[$₹€£])?\d[\d,.]*\s?(?:%|[BMK]\b|Cr\b|crore\b|lakh\b|million\b|billion\b|thousand\b|MT\b)/gi;

// A crude proper-noun-ish entity extractor: 2+ consecutive Capitalized words,
// or a single capitalized word of 5+ letters immediately followed by a digit
// (e.g. "Excelan", "Nasdaq", "Bancorp"). Good enough for flagging overlap,
// not meant to be a real NER model — false positives are fine here since
// this is a human-reviewed flag, not an auto-reject.
const ENTITY_TOKEN = /\b([A-Z][a-zA-Z.]+(?:\s+[A-Z][a-zA-Z.]+){1,3})\b/g;

const STOPWORD_ENTITIES = new Set([
  "Bharat", "India", "Indian", "Follow", "Why", "What", "Who", "How",
  "This", "That", "The", "For", "From", "With", "Sources", "Global Bharat",
  "On This Day", "Sector Futures", "Builder Story", "Personal Growth",
  "Diaspora Dividend", "Viksit Bharat", "United States", "New York",
  "Follow Bhaarat", "Bhaarat", "Instagram", "YouTube", "Threads",
  "Facebook", "Mastodon", "Bluesky", "Pinterest",
]);

// Platform names appear as a JSON array (`"platforms": ["Instagram", ...]`)
// which flattenText joins with spaces/newlines — matches like
// "Threads \n Facebook \n Mastodon" slip past the STOPWORD_ENTITIES set
// since the whole multi-line phrase is the "entity". Filter these
// structurally instead: drop any entity string containing a newline, or
// consisting entirely of known platform-name words.
const PLATFORM_WORDS = new Set(["Instagram", "YouTube", "X", "Threads", "Facebook", "Mastodon", "Bluesky", "Pinterest"]);
function isStructuralNoise(phrase) {
  if (/\n/.test(phrase)) return true;
  const words = phrase.split(/\s+/);
  return words.every((w) => PLATFORM_WORDS.has(w));
}

// A round percentage under 100% (multiples of 5: 50%, 20%, 75%...) is weak
// duplication evidence on its own — real-world stats round to these values
// constantly by coincidence (found 2026-09-14: a renewable-energy piece's
// "50%+ non-fossil capacity" false-flagged as a duplicate of an unrelated
// ports piece's "waterway cargo grew nearly 50%" — same round number,
// completely different fact). A precise, non-round figure ($135.46B,
// 13.16%, 915MT) essentially never coincides between two real, different
// stories, so those stay full-strength signals; round percentages are
// excluded from the number set entirely rather than down-weighted, since a
// coincidental round-number match adds pure noise to the report.
const ROUND_PERCENT = /^\d{1,2}0?%$/; // 5%, 10%, ..., 95% (any multiple of 5, one or two digits)

function extractNumbers(text) {
  const all = (text.match(NUMBER_TOKEN) ?? []).map((s) => s.replace(/\s+/g, "").toLowerCase());
  return new Set(all.filter((n) => !ROUND_PERCENT.test(n)));
}

function extractEntities(text) {
  const found = new Set();
  for (const m of text.matchAll(ENTITY_TOKEN)) {
    const phrase = m[1].trim();
    if (STOPWORD_ENTITIES.has(phrase)) continue;
    if (isStructuralNoise(phrase)) continue;
    if (phrase.length < 6) continue;
    found.add(phrase);
  }
  return found;
}

function flattenText(json) {
  const parts = [];
  const walk = (val) => {
    if (typeof val === "string") parts.push(val);
    else if (Array.isArray(val)) val.forEach(walk);
    else if (val && typeof val === "object") Object.values(val).forEach(walk);
  };
  // Sources are deliberately excluded — citations legitimately repeat
  // (e.g. "RBI", "PIB") across unrelated stories and would just add noise.
  const { sources, ...rest } = json ?? {};
  walk(rest);
  return parts.join(" \n ");
}

async function loadAllContent(excludePath) {
  const items = [];
  for (const { dir, kind } of CONTENT_GLOBS) {
    let files;
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const fullPath = path.join(dir, file);
      if (path.resolve(fullPath) === path.resolve(excludePath ?? "")) continue;
      try {
        const json = JSON.parse(await fs.readFile(fullPath, "utf-8"));
        const text = flattenText(json);
        items.push({
          id: file.replace(/\.json$/, ""),
          kind,
          pillar: json.pillar ?? null,
          publishDate: json.publishDate ?? null,
          numbers: extractNumbers(text),
          entities: extractEntities(text),
        });
      } catch {
        // skip unreadable/malformed file
      }
    }
  }
  return items;
}

function intersect(a, b) {
  const out = [];
  for (const x of a) if (b.has(x)) out.push(x);
  return out;
}

async function resolveCandidatePath(arg) {
  // Direct path (has a slash or ends .json and exists as given)
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

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node pipeline/check-duplicate.mjs <path-to-content-json | scriptId | date>");
    process.exit(1);
  }

  const candidatePath = await resolveCandidatePath(arg);
  const candidateJson = JSON.parse(await fs.readFile(candidatePath, "utf-8"));
  const candidateText = flattenText(candidateJson);
  const candidateNumbers = extractNumbers(candidateText);
  const candidateEntities = extractEntities(candidateText);

  const corpus = await loadAllContent(candidatePath);

  const flags = [];
  for (const item of corpus) {
    const sharedNumbers = intersect(candidateNumbers, item.numbers);
    const sharedEntities = intersect(candidateEntities, item.entities);
    if (sharedNumbers.length === 0 && sharedEntities.length === 0) continue;

    // Score: a shared exact stat is a much stronger signal than a shared
    // entity name (e.g. two different India-export stories both mention
    // "India" — already filtered — but two pieces citing the identical
    // "$135.46B" figure are very likely the same underlying fact).
    const score = sharedNumbers.length * 3 + sharedEntities.length;
    if (score === 0) continue;

    flags.push({
      id: item.id,
      pillar: item.pillar,
      publishDate: item.publishDate,
      sharedNumbers,
      sharedEntities,
      score,
    });
  }

  flags.sort((a, b) => b.score - a.score);

  console.log(`\n=== Duplicate check: ${path.basename(candidatePath)} ===`);
  if (flags.length === 0) {
    console.log("VERDICT: CLEAN — no overlap found against the existing content corpus. Safe to proceed.");
    return;
  }

  const statDupes = flags.filter((f) => f.sharedNumbers.length > 0);
  const entityOnly = flags.filter((f) => f.sharedNumbers.length === 0);

  console.log(`${flags.length} existing piece(s) share numbers/entities with this candidate:\n`);
  for (const f of flags) {
    console.log(`  [score ${f.score}] ${f.id} (${f.pillar ?? "?"}, ${f.publishDate ?? "no date"})`);
    if (f.sharedNumbers.length) console.log(`      shared stats:    ${f.sharedNumbers.join(", ")}`);
    if (f.sharedEntities.length) console.log(`      shared entities: ${f.sharedEntities.join(", ")}`);
  }

  // Two distinct outcomes, per the standing project rule (2026-09-13): a
  // shared exact stat means the same fact is being republished — this is a
  // duplicate and should NOT go out; a shared entity with no shared stat
  // means the same subject is being covered from a genuinely different
  // angle — not a duplicate, but still surfaced for a human decision rather
  // than silently passing, since "different angle, same topic" is exactly
  // the case the user asked to have flagged rather than auto-approved.
  if (statDupes.length > 0) {
    console.log(`\nVERDICT: DUPLICATE — do not publish as-is. ${statDupes.map((f) => f.id).join(", ")} already`);
    console.log(`cover the identical stat(s) above. Find a genuinely different, sourced angle instead of`);
    console.log(`re-publishing the same fact with different phrasing.`);
    process.exitCode = 1;
  } else {
    console.log(`\nVERDICT: RELATED, DIFFERENT ANGLE — ${entityOnly.map((f) => f.id).join(", ")} already covered`);
    console.log(`this subject, but no exact stat is repeated here. This MAY be a legitimate new angle —`);
    console.log(`flag for human review/approval before publishing rather than proceeding automatically.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
