// Usage: node pipeline/facebook-first-comment-slot-runner.mjs <pillarType>
// Called by .github/workflows/facebook-first-comment.yml shortly after
// each pillar's slot time, so the auto first-comment (facebook-first-
// comment.mjs) only fires once the Facebook post has actually gone live
// — commenting on a still-scheduled post is unreliable. Same "find
// today's card for this pillar" logic as bluesky-slot-runner.mjs,
// reused here rather than duplicated with drift.
//
// <pillarType> is one of: global-bharat, motivational-short,
// on-this-day-short, video, diaspora-dividend — matching the slot key
// names in pipeline/slots.mjs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SUFFIX_MATCH = {
  "global-bharat": "_global-bharat",
  "motivational-short": "_motivational-short",
  "on-this-day-short": "_on-this-day-short",
};

function todayIsoUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function findCardForPillar(pillarType, date) {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = (await fs.readdir(pendingDir)).filter((d) => d.startsWith(date));

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

async function main() {
  const pillarType = process.argv[2];
  if (!pillarType) {
    console.error("Usage: node pipeline/facebook-first-comment-slot-runner.mjs <pillarType>");
    process.exit(1);
  }

  const date = todayIsoUtc();
  const dir = await findCardForPillar(pillarType, date);
  if (!dir) {
    console.log(`No ${date} card found for pillar "${pillarType}" — nothing to comment on this slot.`);
    return;
  }

  console.log(`Found ${dir} for pillar "${pillarType}" — checking for a Facebook first comment.`);
  const { stdout, stderr } = await execFileAsync(
    "node",
    [path.join(ROOT, "pipeline", "facebook-first-comment.mjs"), dir],
    { cwd: ROOT }
  );
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
