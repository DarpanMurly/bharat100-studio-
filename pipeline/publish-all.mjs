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

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/publish-all.mjs <date>_<id> [--force]");
    process.exit(1);
  }
  const extraArgs = process.argv.slice(3);

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  await run("publish-to-buffer.mjs", [postId, ...extraArgs]);

  if (card.videoFile) {
    console.log(`\n--- Also uploading to YouTube ---`);
    await run("youtube-upload.mjs", [postId]);
  } else {
    console.log(`\nSkipping YouTube — no video file on this card (a still image/carousel with no video counterpart).`);
  }
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
