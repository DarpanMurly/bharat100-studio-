// Usage: node pipeline/bluesky-slot-runner.mjs <pillarType>
// Called by the GitHub Actions scheduled workflow (.github/workflows/
// bluesky-schedule.yml) at each pillar's exact slot time — Bluesky's API
// has no native "schedule for later" feature (see bluesky-publish.mjs's
// own header comment), so this project's workaround is a cron-triggered
// job that fires the actual publish call at the right instant, running
// independent of any local machine being on.
//
// <pillarType> is one of: global-bharat, motivational-short,
// on-this-day-short, video, diaspora-dividend — matching the slot
// key names in pipeline/slots.mjs. This script finds TODAY's queue
// folder for that pillar (folder naming isn't 100% consistent — sector-
// video and diaspora-dividend cards have no reliable `type` field, only
// a scriptId — so this matches by folder-name pattern, not by reading
// card.type alone) and calls bluesky-publish.mjs on it.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SLOT_HOURS_IST } from "./slots.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Folder-name suffixes that identify each pillar. "video"/"diaspora-
// dividend" cards use a free-form scriptId (e.g. "evgrowth26",
// "diaspora-philanthropy26") instead of a fixed suffix, so those two are
// matched by reading card.type/card.pillar instead of the folder name.
const SUFFIX_MATCH = {
  "global-bharat": "_global-bharat",
  "motivational-short": "_motivational-short",
  "on-this-day-short": "_on-this-day-short",
};

// The folder date for a pillar is NOT always "today in UTC" — a slot
// whose IST hour is less than 5.5 (IST offset) normalizes to a UTC
// instant on the PREVIOUS UTC calendar day (e.g. global-bharat's 5:00
// IST = 23:30 UTC the day before). Bug found 2026-09-10: this function
// used to always return the current UTC date, so global-bharat's cron
// (firing at 23:30 UTC) looked for the wrong day's folder every single
// day, silently found nothing, and logged a false-success "nothing to
// post" — global-bharat never actually posted to Bluesky. Compute the
// real content date the same way nextSlotUtc does, instead of assuming.
function contentDateForPillar(pillarType) {
  const now = new Date();
  const hourIst = SLOT_HOURS_IST[pillarType] ?? SLOT_HOURS_IST.video;
  const utcHour = hourIst - 5.5;
  // If the slot's UTC hour is negative, this instant belongs to the
  // NEXT UTC calendar day's folder (mirrors nextSlotUtc's normalization
  // via Date.UTC's automatic rollover, applied here in reverse to go
  // from "now" back to "which folder date is this").
  const dayOffset = utcHour < 0 ? 1 : 0;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset));
  return d.toISOString().slice(0, 10);
}

async function findCardForPillar(pillarType, date) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => d.startsWith(date));

  if (SUFFIX_MATCH[pillarType]) {
    const match = dirs.find((d) => d.endsWith(SUFFIX_MATCH[pillarType]));
    return match ?? null;
  }

  // "video" (Sector Futures) and "diaspora-dividend" both come from
  // daily-publish.mjs with a free-form scriptId — the only reliable way
  // to tell them apart is card.type ("diaspora-dividend") vs. no type at
  // all (Sector Futures cards never set `type`, per daily-publish.mjs).
  for (const dir of dirs) {
    if (SUFFIX_MATCH["global-bharat"] && dir.endsWith(SUFFIX_MATCH["global-bharat"])) continue;
    if (dir.endsWith("_motivational-short") || dir.endsWith("_on-this-day-short") || dir.endsWith("_weekly-recap")) continue;
    try {
      const card = JSON.parse(await fs.readFile(path.join(pendingDir, dir, "card.json"), "utf-8"));
      if (pillarType === "diaspora-dividend" && card.type === "diaspora-dividend") return dir;
      if (pillarType === "video" && card.type === undefined) return dir;
    } catch {
      // unreadable card, skip
    }
  }
  return null;
}

async function main() {
  const pillarType = process.argv[2];
  if (!pillarType) {
    console.error("Usage: node pipeline/bluesky-slot-runner.mjs <pillarType>");
    process.exit(1);
  }

  const date = contentDateForPillar(pillarType);
  const dir = await findCardForPillar(pillarType, date);
  if (!dir) {
    console.log(`No ${date} card found for pillar "${pillarType}" — nothing to post to Bluesky this slot.`);
    return;
  }

  const cardPath = path.join(ROOT, "content-queue", "pending", dir, "card.json");
  const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
  if (!(card.platforms ?? []).includes("Bluesky")) {
    console.log(`${dir}: "Bluesky" not in this card's platforms list — skipping.`);
    return;
  }
  if (card.status !== "scheduled" && card.status !== "posted") {
    console.log(`${dir}: status is "${card.status}", not "scheduled" — skipping (not yet approved/published on other platforms).`);
    return;
  }
  if (card.blueskyPostUri) {
    console.log(`${dir}: already posted to Bluesky (${card.blueskyPostUri}) — skipping.`);
    return;
  }

  console.log(`Found ${dir} for pillar "${pillarType}" — publishing to Bluesky.`);
  const { stdout, stderr } = await execFileAsync("node", [path.join(ROOT, "pipeline", "bluesky-publish.mjs"), dir], {
    cwd: ROOT,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
