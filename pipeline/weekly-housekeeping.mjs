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
//
// INCREMENTAL BEHAVIOR (added 2026-09-20, per explicit user request):
// the FIRST run ever (no state file yet) scans the project's full
// history on every check that supports a lookback window. Every run
// after that only re-scans back to the last successful run's date
// (plus a small overlap buffer, since a slot posted right at a run
// boundary could otherwise slip through uninspected) — not the full
// history again every single week forever. This state lives in
// content-queue/.housekeeping-state.json, committed to the repo so it
// persists across workflow runs (a GitHub Actions runner is thrown away
// after each job). Only the CHECKS below marked `lookbackArg: true`
// participate in this narrowing — check-weekly-cadence.mjs has no
// "window" concept (it's always "is the next package due right now")
// so it always runs at full, constant cost regardless.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STATE_PATH = path.join(ROOT, "content-queue", ".housekeeping-state.json");

// A few extra days of overlap on every incremental run, cheap insurance
// against a slot that posted right at the edge of the last run's window
// (e.g. a late Buffer retry landing a few hours after this script's own
// run finished) otherwise never getting inspected by any run.
const OVERLAP_DAYS = 3;
// The known start of usable project history — never look back further
// than this even on the very first run, there's nothing there to find.
const PROJECT_FLOOR = "2026-09-04";

async function loadState() {
  try {
    return JSON.parse(await fs.readFile(STATE_PATH, "utf-8"));
  } catch {
    return null;
  }
}
async function saveState(state) {
  await fs.writeFile(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);
}

async function main() {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const priorState = await loadState();

  let lookbackDays;
  let scopeLabel;
  if (!priorState?.lastRunDate) {
    lookbackDays = Math.max(1, daysBetween(PROJECT_FLOOR, todayStr));
    scopeLabel = `FULL HISTORY (first run — scanning back to ${PROJECT_FLOOR})`;
  } else {
    lookbackDays = daysBetween(priorState.lastRunDate, todayStr) + OVERLAP_DAYS;
    scopeLabel = `INCREMENTAL (since last run on ${priorState.lastRunDate}, +${OVERLAP_DAYS}-day overlap = ${lookbackDays} day(s) back)`;
  }

  // Each check declares its own args and whether it supports a lookback
  // override at all. check-weekly-cadence.mjs and the coverage script's
  // WordPress-launch-floor logic are already correct regardless of scope.
  const CHECKS = [
    { name: "Missed days (5-pillar batches + WordPress digest)", script: "check-missed-days.mjs", lookbackArg: true },
    { name: "Cross-platform coverage (all 8 platforms + WordPress)", script: "check-platform-coverage.mjs", lookbackArg: true },
    { name: "Weekly package cadence (Substack/Medium/WordPress weekly/recap video)", script: "check-weekly-cadence.mjs", lookbackArg: false },
    { name: "Website accuracy (live site vs. archive-data.json)", script: "check-website-accuracy.mjs", lookbackArg: true, fullArchiveArg: "all" },
  ];

  console.log(`Weekly housekeeping run — ${now.toISOString()}`);
  console.log(`Scope: ${scopeLabel}\n`);

  const results = [];
  for (const check of CHECKS) {
    // Website accuracy has no meaningful "N days back" concept the way
    // the others do (its cost doesn't scale much with window size, since
    // it's one page fetch either way) — always give it the full archive
    // on a housekeeping run rather than trying to map lookbackDays onto
    // it, so a stale link from months ago is never permanently invisible
    // just because it's outside whatever window this run computed.
    const args = check.fullArchiveArg
      ? [check.fullArchiveArg]
      : check.lookbackArg
        ? [String(lookbackDays)]
        : [];
    results.push(await runCheck({ ...check, args }));
  }

  console.log(`\n${"=".repeat(70)}\nSUMMARY\n${"=".repeat(70)}`);
  for (const r of results) {
    console.log(`  ${r.ok ? "CLEAN" : "FOUND ISSUE(S)"} — ${r.name}`);
  }

  const anyIssues = results.some((r) => !r.ok);
  if (anyIssues) {
    console.log(`\nOne or more checks found something — see the sections above for details.`);
    console.log(`This is detection-only: nothing was changed. Decide per finding whether to backfill, repair, or accept it.`);
  } else {
    console.log(`\nAll checks clean. No drift found in this run's scope.`);
  }

  // Record this run regardless of whether issues were found — an
  // unresolved finding doesn't mean the NEXT run should re-scan from
  // scratch; it was surfaced, and the following run's overlap window
  // will still catch it again if it's still there.
  await saveState({ lastRunDate: todayStr, lastRunAt: now.toISOString() });

  if (anyIssues) process.exitCode = 1;
}

async function runCheck({ name, script, args }) {
  console.log(`\n${"=".repeat(70)}\n${name}${args.length ? ` (args: ${args.join(" ")})` : ""}\n${"=".repeat(70)}`);
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

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
