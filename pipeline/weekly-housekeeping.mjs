// Usage: node pipeline/weekly-housekeeping.mjs
// Runs the full suite of DETECTION-only health checks in one pass and
// prints one consolidated report. Built 2026-09-20 per an explicit user
// request: the project is built for a 20-year horizon, so drift of any
// kind (a missed day, a dead platform link, a stale website, a missed
// weekly package) needs to surface on a forced, regular cadence — not
// only when someone happens to notice or ask. Individual checks already
// existed (check-missed-days, check-platform-coverage, etc.) but each
// ran ad hoc or buried inside a different workflow; nothing ran the
// FULL set together and reported the combined picture.
//
// This script itself changes NOTHING — every check it calls is read-
// only/detection-only by its own contract. Fixing a found gap is always
// a separate, deliberate step (a human decision, or one of the existing
// backfill/heal scripts run on purpose), same principle as every
// individual check already follows (see check-missed-days.mjs's own
// header on why a gap is surfaced honestly rather than silently
// patched).
//
// Runs weekly (see .github/workflows/weekly-housekeeping.yml) — chosen
// over daily specifically to avoid repeating the Buffer API rate-limit
// incident from 2026-09-19/20, where hitting Buffer too often in the
// same short window got the whole pipeline rate-limited for ~12 hours.
// Weekly keeps every repair "at most a few days old" (the user's own
// stated goal) while keeping total API call volume low.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Each check declares its own args (matching how it's normally invoked
// elsewhere) and whether a real finding should make the OVERALL run
// exit non-zero (so a scheduled workflow shows red and is actually
// noticed, not just logged into the void).
const CHECKS = [
  { name: "Missed days (5-pillar batches + WordPress digest, last 14 days)", script: "check-missed-days.mjs", args: [] },
  { name: "Cross-platform coverage (last 30 days, full history)", script: "check-platform-coverage.mjs", args: ["30"] },
  { name: "Weekly package cadence (Substack/Medium/WordPress weekly/recap video)", script: "check-weekly-cadence.mjs", args: [] },
  { name: "Website accuracy (live site vs. archive-data.json)", script: "check-website-accuracy.mjs", args: [] },
];

async function runCheck({ name, script, args }) {
  console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`);
  try {
    const { stdout, stderr } = await execFileAsync("node", [path.join(ROOT, "pipeline", script), ...args], {
      cwd: ROOT,
      maxBuffer: 1024 * 1024 * 20,
    });
    if (stdout) console.log(stdout.trim());
    if (stderr) console.error(stderr.trim());
    return { name, ok: true };
  } catch (err) {
    // A check script exits non-zero when it found something real — that
    // is EXPECTED behavior, not a crash. Its own stdout already explains
    // what it found; just surface it and record the finding.
    if (err.stdout) console.log(err.stdout.trim());
    if (err.stderr) console.error(err.stderr.trim());
    return { name, ok: false };
  }
}

async function main() {
  console.log(`Weekly housekeeping run — ${new Date().toISOString()}`);
  console.log(`Running ${CHECKS.length} detection-only checks against the project's full history...`);

  const results = [];
  for (const check of CHECKS) {
    results.push(await runCheck(check));
  }

  console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
  for (const r of results) {
    console.log(`  ${r.ok ? "CLEAN" : "FOUND ISSUE(S)"} — ${r.name}`);
  }

  const anyIssues = results.some((r) => !r.ok);
  if (anyIssues) {
    console.log(`\nOne or more checks found something — see the sections above for details.`);
    console.log(`This is detection-only: nothing was changed. Decide per finding whether to backfill, repair, or accept it.`);
    process.exitCode = 1;
  } else {
    console.log(`\nAll checks clean. No drift found this week.`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
