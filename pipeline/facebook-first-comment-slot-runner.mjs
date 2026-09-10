// Usage: node pipeline/facebook-first-comment-slot-runner.mjs
// Called by .github/workflows/facebook-first-comment.yml, so the auto
// first-comment (facebook-first-comment.mjs) only fires once each
// Facebook post has actually gone live — commenting on a still-scheduled
// post is unreliable.
//
// REWRITTEN 2026-09-10 to check ALL 5 pillars every run instead of
// guessing a single pillar from wall-clock time, same fix and same
// reason as bluesky-slot-runner.mjs: GitHub Actions schedule triggers
// are documented to fire 10-60+ minutes late, and matching a narrow
// time window per pillar meant a late firing could miss its window
// entirely and silently skip that day's comment (confirmed: 2 of 5
// Sept 10 pillars never got their first comment). This version checks
// every pillar's actual card every run — self-healing against delay of
// any length, and facebook-first-comment.mjs's own idempotency check
// (skips if facebookFirstCommentId already set) makes it safe to call
// repeatedly across multiple firings in a day.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SLOT_HOURS_IST } from "./slots.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const PILLARS = ["global-bharat", "motivational-short", "on-this-day-short", "video", "diaspora-dividend"];

const SUFFIX_MATCH = {
  "global-bharat": "_global-bharat",
  "motivational-short": "_motivational-short",
  "on-this-day-short": "_on-this-day-short",
};

function contentDateForPillar(pillarType, now) {
  const hourIst = SLOT_HOURS_IST[pillarType] ?? SLOT_HOURS_IST.video;
  const utcHour = hourIst - 5.5;
  const dayOffset = utcHour < 0 ? 1 : 0;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset));
  return d.toISOString().slice(0, 10);
}

async function findCardForPillar(pillarType, date) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  let dirs;
  try {
    dirs = (await fs.readdir(pendingDir)).filter((d) => d.startsWith(date));
  } catch {
    return null;
  }

  if (SUFFIX_MATCH[pillarType]) {
    const match = dirs.find((d) => d.endsWith(SUFFIX_MATCH[pillarType]));
    return match ?? null;
  }

  for (const dir of dirs) {
    if (dir.endsWith("_global-bharat") || dir.endsWith("_motivational-short") ||
        dir.endsWith("_on-this-day-short") || dir.endsWith("_weekly-recap")) continue;
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

async function tryCommentPillar(pillarType, now) {
  const date = contentDateForPillar(pillarType, now);
  const dir = await findCardForPillar(pillarType, date);
  if (!dir) {
    console.log(`[${pillarType}] No ${date} card found — nothing to comment on.`);
    return;
  }

  console.log(`[${pillarType}] Found ${dir} — checking for a Facebook first comment.`);
  try {
    const { stdout, stderr } = await execFileAsync(
      "node",
      [path.join(ROOT, "pipeline", "facebook-first-comment.mjs"), dir],
      { cwd: ROOT }
    );
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
  } catch (err) {
    console.error(`[${pillarType}] ${dir}: comment attempt failed — ${err.message ?? err}`);
  }
}

async function main() {
  const now = new Date();
  console.log(`Checking all 5 pillars at ${now.toISOString()}...`);
  for (const pillarType of PILLARS) {
    await tryCommentPillar(pillarType, now);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
