// Usage: node pipeline/deploy-homepage.mjs
// Full homepage refresh + deploy, meant to run after every slot's content
// goes live (not just once a day) so bharatat100.com's archive and
// platform links never drift out of sync with what's actually posted.
//
// Chain: build-archive-data.mjs (scans content-queue for live posts) ->
// build-homepage.mjs (injects that into homepage.html -> homepage.built.html
// + sitemap.xml) -> copy both into netlify-deploy/ (the actual publish
// directory Netlify's Git-linked deploy watches) -> git commit + push.
// Netlify auto-deploys on push (linked 2026-09-09), so a successful push
// here is a live site update within its own build time, no manual step.
//
// Safe to run with nothing new to publish — git commit is skipped (not
// forced) when netlify-deploy/ has no diff, so this can run after every
// slot unconditionally without creating empty commits.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function run(cmd, args) {
  console.log(`$ ${cmd} ${args.join(" ")}`);
  const { stdout } = await execFileAsync(cmd, args, { cwd: ROOT });
  if (stdout.trim()) console.log(stdout.trim());
}

async function main() {
  await run("node", [path.join(ROOT, "pipeline", "build-homepage.mjs")]);

  await fs.copyFile(
    path.join(ROOT, "homepage.built.html"),
    path.join(ROOT, "netlify-deploy", "index.html")
  );
  await fs.copyFile(
    path.join(ROOT, "sitemap.xml"),
    path.join(ROOT, "netlify-deploy", "sitemap.xml")
  );
  console.log("Copied homepage.built.html and sitemap.xml into netlify-deploy/.");

  await run("git", ["add", "netlify-deploy/"]);

  // git diff --cached --quiet exits 1 when there IS a staged diff — that's
  // execFileAsync throwing, not a real error, so check it via the promise
  // rejecting rather than treating any non-zero exit as fatal.
  let hasChanges = true;
  try {
    await execFileAsync("git", ["diff", "--cached", "--quiet"], { cwd: ROOT });
    hasChanges = false;
  } catch {
    hasChanges = true;
  }

  if (!hasChanges) {
    console.log("No changes to netlify-deploy/ — homepage already up to date, nothing to deploy.");
    return;
  }

  const now = new Date().toISOString();
  await run("git", ["commit", "-m", `Sync homepage with latest published content (${now})`]);

  // This workflow, bluesky-schedule.yml, and facebook-first-comment.yml
  // all run around the same slot times and push to main independently —
  // pull --rebase first so a push landing in that window doesn't fail
  // this one with a non-fast-forward rejection (found via a full
  // pipeline audit, 2026-09-10).
  await run("git", ["pull", "--rebase", "origin", "main"]);
  await run("git", ["push", "origin", "main"]);
  console.log("Pushed — Netlify will auto-deploy from this commit.");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
