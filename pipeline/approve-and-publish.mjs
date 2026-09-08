// Usage: node pipeline/approve-and-publish.mjs <date>_<id> [<date>_<id> ...] [--force]
// The single command for "user said approved in chat, now do the rest."
// Flips the local card.json status from pending to approved, then runs
// publish-all.mjs for it. This replaces the old two-store flow (approve
// in the Content Desk dashboard UI, then separately sync local card.json
// status by hand) — the dashboard is now just a review surface; approval
// happens here, in the one place that can actually trigger publishing.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function findQueueDir(postId) {
  for (const sub of ["approved", "pending"]) {
    const dir = path.join(ROOT, "content-queue", sub, postId);
    try {
      await fs.access(dir);
      return dir;
    } catch {
      // try next
    }
  }
  throw new Error(`No queue folder found for "${postId}" in approved/ or pending/`);
}

async function run(script, args) {
  const { stdout, stderr } = await execFileAsync("node", [path.join(ROOT, "pipeline", script), ...args], {
    cwd: ROOT,
    maxBuffer: 1024 * 1024 * 20,
  });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

async function approveAndPublishOne(postId, extraArgs) {
  const queueDir = await findQueueDir(postId);
  const cardPath = path.join(queueDir, "card.json");
  const card = JSON.parse(await fs.readFile(cardPath, "utf-8"));

  if (card.status === "pending") {
    card.status = "approved";
    card.approvedAt = new Date().toISOString();
    await fs.writeFile(cardPath, JSON.stringify(card, null, 2), "utf-8");
    console.log(`${postId}: pending -> approved`);
  } else {
    console.log(`${postId}: already "${card.status}", not touching status`);
  }

  console.log(`\n=== publish-all.mjs ${postId} ===`);
  await run("publish-all.mjs", [postId, ...extraArgs]);
}

// Bluesky has no native "schedule for later" — the GitHub Actions
// workflow at .github/workflows/bluesky-schedule.yml fires a real job at
// each pillar's slot time to work around that, but it only sees whatever
// is already pushed to GitHub. Push card.json updates (approvedAt,
// status, platform post IDs) right after publishing so that workflow's
// checkout always has current data, without a separate manual step.
async function pushCardUpdates() {
  try {
    await execFileAsync("git", ["add", "content-queue/"], { cwd: ROOT });
    const { stdout: diffStat } = await execFileAsync("git", ["diff", "--cached", "--stat"], { cwd: ROOT });
    if (!diffStat.trim()) {
      console.log("\nNo content-queue changes to push.");
      return;
    }
    await execFileAsync("git", ["commit", "-m", "Approve and publish: sync card.json updates [skip ci]"], { cwd: ROOT });
    await execFileAsync("git", ["push"], { cwd: ROOT });
    console.log("\nPushed card.json updates to GitHub (for the Bluesky scheduled workflow).");
  } catch (err) {
    console.error(`\nWarning: could not push card.json updates to GitHub — the Bluesky scheduled workflow may see stale data until this is pushed manually. (${err.message})`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const extraArgs = args.filter((a) => a.startsWith("--"));
  const postIds = args.filter((a) => !a.startsWith("--"));

  if (postIds.length === 0) {
    console.error("Usage: node pipeline/approve-and-publish.mjs <date>_<id> [<date>_<id> ...] [--force]");
    process.exit(1);
  }

  for (const postId of postIds) {
    await approveAndPublishOne(postId, extraArgs);
  }

  await pushCardUpdates();
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
