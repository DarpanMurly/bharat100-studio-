// Usage: node pipeline/youtube-auth.mjs
// One-time setup: opens a browser for you to log into the Google account
// tied to your YouTube channel, then saves a reusable token to
// youtube-token.json. Re-run this only if that token is ever revoked or
// expires (test-mode tokens expire after 7 days until the compliance
// audit is approved — see project memory for that context).

import { authenticate } from "@google-cloud/local-auth";
import { google } from "googleapis";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const CREDENTIALS_PATH = path.join(ROOT, "youtube-client-secret.json");
const TOKEN_PATH = path.join(ROOT, "youtube-token.json");

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
  // Search Console — upgraded from webmasters.readonly to the full
  // webmasters scope 2026-09-14, specifically so sites.add() can register
  // a NEW property (bharatat100.wordpress.com) programmatically via API,
  // since WordPress.com's free-tier dashboard has no discoverable "Site
  // Verification Services" page in its current Calypso UI (checked
  // directly — it's not under Settings, and the documented Marketing ->
  // Traffic path either doesn't exist or isn't reachable on this account's
  // plan tier). sites.add() uses Search Console's "delegated ownership"
  // path: since this same Google account/API client already has verified
  // ownership of bharatat100.com, and WordPress.com's post URLs live under
  // that same conceptual property umbrella is NOT automatic — actually
  // requires either domain-level verification or this account being an
  // existing verified owner. If sites.add() still fails after this scope
  // upgrade, the real fix is the meta-tag method through Search Console's
  // UI directly with a manually-located WordPress.com settings page, not
  // further API scope changes. Read/write behavior for existing properties
  // (fetch-search-console.mjs's queries) is unaffected by this widening.
  "https://www.googleapis.com/auth/webmasters",
];

async function main() {
  console.log("Opening a browser window — log in with the Google account tied to your YouTube channel.");

  const client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });

  if (client.credentials) {
    await fs.writeFile(TOKEN_PATH, JSON.stringify(client.credentials, null, 2), "utf-8");
    console.log(`\nSaved token to ${TOKEN_PATH}`);
    console.log("You won't need to log in again unless this token is revoked or expires.");
  }
}

main().catch((err) => {
  console.error("Auth failed:", err.message ?? err);
  process.exit(1);
});
