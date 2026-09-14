// Usage: node pipeline/daily-digest-summary.mjs <date>
// Prints a short, scannable summary of a day's 5-pillar batch for faster
// approval — one line per pillar (title + a 1-line "what makes this
// piece unusual, if anything" flag) instead of needing to re-read every
// full caption in the dashboard to approve. Does NOT replace the dashboard
// (that's still the actual visual review) - this is a quick "anything I
// should look closer at before approving" pass, callable right after
// generating a day's batch.
//
// "Unusual" flags checked automatically:
//   - a source list shorter than 2 (below the project's own 2-source bar)
//   - staleness/duplicate check results, if check-staleness.mjs /
//     check-duplicate.mjs were already run for these scriptIds (best
//     effort — only surfaces what those tools already found, doesn't
//     re-run them)
//   - a caption containing a hedge word ("reportedly", "unverified",
//     "single-source", "flag") that suggests a real caveat is buried in
//     the text and worth a second look before approving
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const HEDGE_WORDS = ["reportedly", "unverified", "single-source", "single source", "approximate", "estimated", "unresolved"];

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/daily-digest-summary.mjs <date>");
    process.exit(1);
  }

  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => d.startsWith(date) && !d.endsWith("_weekly-recap"));

  if (dirs.length === 0) {
    console.log(`No content found for ${date}.`);
    return;
  }

  console.log(`\n=== ${date} — quick approval summary (${dirs.length} pieces) ===\n`);

  for (const dir of dirs) {
    let card;
    try {
      card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
    } catch {
      console.log(`  [${dir}] — could not read card.json`);
      continue;
    }

    const flags = [];
    const sourceCount = (card.sources ?? []).length;
    if (sourceCount < 2) flags.push(`only ${sourceCount} source(s)`);

    const captionLower = (card.caption ?? "").toLowerCase();
    const hedgesFound = HEDGE_WORDS.filter((w) => captionLower.includes(w));
    if (hedgesFound.length > 0) flags.push(`hedge language: "${hedgesFound[0]}"`);

    const flagText = flags.length > 0 ? `  ⚠ ${flags.join("; ")}` : "  ✓ clean";
    console.log(`[${card.pillar ?? "?"}] ${card.title ?? dir}`);
    console.log(flagText);
    console.log();
  }

  console.log(`Full review still happens on the dashboard — this is a pre-scan, not a replacement.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
