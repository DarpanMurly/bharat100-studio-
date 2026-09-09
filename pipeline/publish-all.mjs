// Usage: node pipeline/publish-all.mjs <date>_<id> [--force]
// The single command for "approve, then I do the rest": schedules the
// approved post to Instagram/Threads/X via Buffer, and — if it has a
// video file (sector video, motivational-short, or on-this-day-short) —
// uploads it to YouTube directly too. All content packages now go to all
// four platforms simultaneously as of 2026-09-05. Run this after flipping
// a card's status to "approved" in the Content Desk.

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
  });
  if (stdout) console.log(stdout);
  if (stderr) console.error(stderr);
}

// Each platform's publish call is genuinely independent — a Facebook API
// blip has no bearing on whether Mastodon or Pinterest should be
// attempted. Originally these ran as bare `await run(...)` calls, so any
// one throwing aborted every platform after it in the list (found via a
// full pipeline audit, 2026-09-10) — a transient failure on an early
// platform silently cost every later one, with no attempt even made.
// Track failures and report them all at the end instead of stopping at
// the first one; still exit non-zero if anything failed, so a real
// problem is never silently swallowed either.
async function runIndependent(label, script, args, failures) {
  console.log(`\n--- ${label} ---`);
  try {
    await run(script, args);
  } catch (err) {
    console.error(`${label} FAILED: ${err.message ?? err}`);
    failures.push(label);
  }
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/publish-all.mjs <date>_<id> [--force]");
    process.exit(1);
  }
  const extraArgs = process.argv.slice(3);

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  const failures = [];

  await runIndependent("Instagram/Threads/X via Buffer", "publish-to-buffer.mjs", [postId, ...extraArgs], failures);

  if (card.videoFile) {
    await runIndependent("YouTube", "youtube-upload.mjs", [postId], failures);
  } else {
    console.log(`\nSkipping YouTube — no video file on this card (a still image/carousel with no video counterpart).`);
  }

  if ((card.platforms ?? []).includes("Facebook")) {
    await runIndependent("Facebook", "facebook-publish.mjs", [postId], failures);
  }

  if ((card.platforms ?? []).includes("Mastodon")) {
    await runIndependent("Mastodon", "mastodon-publish.mjs", [postId], failures);
  }

  if ((card.platforms ?? []).includes("Pinterest")) {
    await runIndependent("Pinterest", "pinterest-publish.mjs", [postId], failures);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} platform(s) failed: ${failures.join(", ")} — check the errors above.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
