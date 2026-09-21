// Usage: node pipeline/bluesky-slot-runner.mjs
// Called by the GitHub Actions scheduled workflow (.github/workflows/
// bluesky-schedule.yml) — Bluesky's API has no native "schedule for
// later" feature (see bluesky-publish.mjs's own header comment), so
// this project's workaround is a cron-triggered job that fires the
// actual publish call once each pillar's slot instant has passed,
// running independent of any local machine being on.
//
// REWRITTEN 2026-09-10 to check ALL 5 pillars every run instead of
// guessing a single pillar from wall-clock time. The old version had a
// real bug: GitHub Actions schedule triggers are documented to fire
// 10-60+ minutes late under normal load, and the old workflow matched
// wall-clock time against a narrow ~10-minute window per pillar (e.g.
// "02:3*" for Personal Growth) to decide which pillar to post — a late
// firing landed outside every window and silently fell through to a
// wrong default ("video"), which is exactly what happened on
// 2026-09-10: a 02:40 UTC firing (10 minutes late for the 02:30 slot)
// posted Sector Futures' content instead of Personal Growth's, and the
// other 4 pillars never posted at all that day. This version is
// self-healing against delays of any length: every firing independently
// checks every pillar's actual slot instant against real current time,
// and posts whichever ones are due and not yet posted — arbitrarily
// late firings just mean a pillar's post goes out a bit later, never
// to the wrong pillar or silently skipped.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SLOT_HOURS_IST, nextSlotUtc } from "./slots.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PILLARS = ["global-bharat", "motivational-short", "on-this-day-short", "video", "diaspora-dividend", "weekly-recap"];

const SUFFIX_MATCH = {
  "global-bharat": "_global-bharat",
  "motivational-short": "_motivational-short",
  "on-this-day-short": "_on-this-day-short",
  // Added 2026-09-21: weekly-recap was previously excluded outright (see
  // matchesPillar's generic branch below) with no pillar entry to catch
  // it instead, so all 3 weekly recaps to date (Sept 7, 14, 21) never
  // posted to Bluesky at all — a silent 2-week gap, not a cron/timing
  // bug like the others documented in this file's history.
  "weekly-recap": "_weekly-recap",
};

// The folder date for a pillar is NOT always "today in UTC" — a slot
// whose IST hour is less than 5.5 (IST offset) normalizes to a UTC
// instant on the PREVIOUS UTC calendar day (e.g. global-bharat's 5:00
// IST = 23:30 UTC the day before).
function contentDateForPillar(pillarType, now) {
  const hourIst = SLOT_HOURS_IST[pillarType] ?? SLOT_HOURS_IST.video;
  const utcHour = hourIst - 5.5;
  const dayOffset = utcHour < 0 ? 1 : 0;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset));
  return d.toISOString().slice(0, 10);
}

function matchesPillar(dir, pillarType, card) {
  if (SUFFIX_MATCH[pillarType]) return dir.endsWith(SUFFIX_MATCH[pillarType]);
  if (dir.endsWith("_global-bharat") || dir.endsWith("_motivational-short") ||
      dir.endsWith("_on-this-day-short") || dir.endsWith("_weekly-recap")) return false;
  // (weekly-recap now has its own SUFFIX_MATCH entry above and never
  // reaches this generic branch — kept in the exclusion list regardless
  // so a future pillar addition can't accidentally re-absorb it here.)
  // "video" (Sector Futures) and "diaspora-dividend" both come from
  // daily-publish.mjs with a free-form scriptId — the only reliable way
  // to tell them apart is card.type ("diaspora-dividend") vs. no type at
  // all (Sector Futures cards never set `type`, per daily-publish.mjs).
  if (pillarType === "diaspora-dividend") return card.type === "diaspora-dividend";
  if (pillarType === "video") return card.type === undefined;
  return false;
}

// LOOKBACK_DAYS: catches a card that missed its own pillar's exact cron
// firing because it wasn't "scheduled" yet at that moment (e.g. blocked
// on a full Buffer/Instagram queue — found 2026-09-17: 8 cards across
// Sept 17-18 sat at "approved" past their Bluesky slot time, and since
// the old version only ever checked TODAY's folder for each pillar once
// per cron firing, every one of those slots was skipped forever with no
// retry — unlike Buffer's own retry-failed-buffer.mjs, which sweeps back
// over anything still outstanding. This makes Bluesky posting resilient
// to the same kind of transient block, not just to cron scheduling delay.
const LOOKBACK_DAYS = 3;

async function findCandidateCards(pillarType, now) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  let allDirs;
  try {
    allDirs = await fs.readdir(pendingDir);
  } catch {
    return [];
  }

  const dates = [];
  for (let i = 0; i <= LOOKBACK_DAYS; i++) {
    const base = contentDateForPillar(pillarType, now);
    const [y, m, d] = base.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d - i));
    dates.push(dt.toISOString().slice(0, 10));
  }

  const candidates = [];
  for (const dir of allDirs) {
    if (!dates.some((date) => dir.startsWith(date))) continue;
    let card;
    try {
      card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
    } catch {
      continue;
    }
    if (matchesPillar(dir, pillarType, card)) candidates.push({ dir, card });
  }
  return candidates;
}

async function tryPostPillar(pillarType, now) {
  const candidates = await findCandidateCards(pillarType, now);
  if (candidates.length === 0) {
    console.log(`[${pillarType}] No card found in the last ${LOOKBACK_DAYS + 1} days — nothing to post.`);
    return;
  }

  for (const { dir, card } of candidates) {
    if (!(card.platforms ?? []).includes("Bluesky")) {
      console.log(`[${pillarType}] ${dir}: "Bluesky" not in platforms — skipping.`);
      continue;
    }
    if (card.blueskyPostUri) {
      console.log(`[${pillarType}] ${dir}: already posted (${card.blueskyPostUri}) — skipping.`);
      continue;
    }
    if (card.status !== "scheduled" && card.status !== "posted") {
      console.log(`[${pillarType}] ${dir}: status is "${card.status}", not "scheduled" — skipping for now.`);
      continue;
    }

    // The actual "is this pillar's slot due yet" check — this is what
    // makes the whole approach self-healing against arbitrary cron delay,
    // instead of relying on wall-clock pattern matching.
    const slotAt = card.scheduledAt ?? nextSlotUtc(SLOT_HOURS_IST[pillarType] ?? SLOT_HOURS_IST.video, card.date);
    if (new Date(slotAt).getTime() > now.getTime()) {
      console.log(`[${pillarType}] ${dir}: slot (${slotAt}) hasn't happened yet — skipping for now.`);
      continue;
    }

    console.log(`[${pillarType}] Found ${dir}, slot ${slotAt} has passed — publishing to Bluesky.`);
    try {
      const { stdout, stderr } = await execFileAsync("node", [path.join(ROOT, "pipeline", "bluesky-publish.mjs"), dir], {
        cwd: ROOT,
      });
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
    } catch (err) {
      console.error(`[${pillarType}] ${dir}: publish failed — ${err.message ?? err}`);
    }
  }
}

async function main() {
  const now = new Date();
  console.log(`Checking all ${PILLARS.length} pillars (with ${LOOKBACK_DAYS}-day catch-up lookback) at ${now.toISOString()}...`);
  for (const pillarType of PILLARS) {
    await tryPostPillar(pillarType, now);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
