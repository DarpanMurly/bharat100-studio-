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
