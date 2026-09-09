// Usage: node pipeline/facebook-auth.mjs
// One-time setup: opens a browser for you to log into Facebook and
// approve permissions for the Bharat@100 app, then exchanges the result
// for a long-lived Page access token and saves it to facebook-token.json.
// Mirrors pipeline/youtube-auth.mjs's pattern (local browser login, no
// hosted callback page) — Facebook allows a localhost redirect URI for
// apps still in Development mode, same as this app currently is.
//
// Requires FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env (from the
// Meta App dashboard: Settings -> Basic). Never paste these into chat —
// add them straight to .env yourself.
//
// Re-run this only if the saved token is ever revoked, or if Meta's
// review later grants Advanced Access and a broader permission set is
// needed — Development-mode tokens for a Page you admin do not expire
// on the same 7-day cycle YouTube's test tokens do, but Facebook Page
// tokens generally should still be refreshed periodically.

import "dotenv/config";
import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "facebook-token.json");

const APP_ID = process.env.FACEBOOK_APP_ID;
const APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const PORT = 8731;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// pages_show_list: lets us look up which Page(s) this user manages.
// pages_manage_posts + pages_read_engagement: the actual posting/reading
// permissions this project needs. business_management: REQUIRED because
// the Bharatat100 Page is owned by a Business Portfolio, not a personal
// classic-Page admin relationship — without this scope, the Portfolio's
// owned_pages endpoint returns error 200 ("Requires business_management
// permission"), and the Page never shows up via /me/accounts at all
// (confirmed directly 2026-09-08: /me/accounts only returned the user's
// own profile-linked Page, not the Business-Portfolio-owned Bharatat100
// Page, until this scope was added). All four still work in Development
// mode for the app's own admins/testers without needing Advanced Access
// review — that review only gates access to OTHER people's Pages.
// pages_manage_engagement (added 2026-09-10): required to POST a new
// comment via /<post-id>/comments — distinct from pages_manage_posts,
// which only covers the posts themselves, not comment creation
// (confirmed: the first live attempt without this scope failed with
// "(#200) Permissions error").
const SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "pages_manage_engagement",
  "business_management",
].join(",");

// The Business Portfolio that owns the Bharatat100 Page (from Page
// Settings -> "Manage and view access" -> "Business portfolio (ID: ...)").
const BUSINESS_ID = "1605782571324295";

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

async function exchangeCodeForUserToken(code) {
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("code", code);

  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Token exchange failed: ${json.error.message}`);
  return json.access_token;
}

async function exchangeForLongLivedUserToken(shortLivedToken) {
  const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", APP_ID);
  url.searchParams.set("client_secret", APP_SECRET);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Long-lived token exchange failed: ${json.error.message}`);
  return json.access_token;
}

// /me/accounts only lists Pages via a direct classic-admin relationship —
// it does NOT list Pages owned by a Business Portfolio, even when the
// user has full access there (confirmed directly 2026-09-08). Query the
// Portfolio's own owned_pages endpoint instead.
async function fetchManagedPages(userToken) {
  const url = new URL(`https://graph.facebook.com/v21.0/${BUSINESS_ID}/owned_pages`);
  url.searchParams.set("access_token", userToken);

  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Fetching Pages failed: ${json.error.message}`);
  return json.data ?? [];
}

// owned_pages returns only {id, name} — no access_token field (unlike
// /me/accounts). Fetch each Page's own Page access token separately.
async function fetchPageAccessToken(pageId, userToken) {
  const url = new URL(`https://graph.facebook.com/v21.0/${pageId}`);
  url.searchParams.set("fields", "access_token,name");
  url.searchParams.set("access_token", userToken);

  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Fetching Page access token failed: ${json.error.message}`);
  if (!json.access_token) {
    throw new Error(
      `No access_token returned for Page "${json.name ?? pageId}" — the user token may be missing a required permission, or the account may not have admin (not just viewer) access to this Page.`
    );
  }
  return json.access_token;
}

async function waitForCallback() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error_description") || url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        error
          ? `<html><body style="font-family:sans-serif;padding:40px;"><h2>Authorization failed</h2><p>${error}</p><p>You can close this tab.</p></body></html>`
          : `<html><body style="font-family:sans-serif;padding:40px;"><h2>Authorized</h2><p>You can close this tab and return to the terminal.</p></body></html>`
      );

      server.close();
      if (error) reject(new Error(error));
      else if (code) resolve(code);
      else reject(new Error("No code or error returned in callback."));
    });
    server.listen(PORT);
  });
}

async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.error("Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in .env — add both from the Meta App dashboard (Settings -> Basic) first.");
    process.exit(1);
  }

  const authUrl = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  authUrl.searchParams.set("client_id", APP_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("response_type", "code");
  // Forces Facebook to show the permission/Page-picker dialog again even
  // if this account previously authorized the app — without this, a
  // prior authorization that granted zero Pages can silently reuse that
  // same empty grant instead of prompting again.
  authUrl.searchParams.set("auth_type", "rerequest");

  console.log("Opening a browser window — log in with the Facebook account that admins the Bharat@100 Page.");
  console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
  openBrowser(authUrl.toString());

  const code = await waitForCallback();
  console.log("Authorization received. Exchanging for tokens...");

  const shortLivedUserToken = await exchangeCodeForUserToken(code);
  const longLivedUserToken = await exchangeForLongLivedUserToken(shortLivedUserToken);

  const pages = await fetchManagedPages(longLivedUserToken);
  if (pages.length === 0) {
    throw new Error("No Facebook Pages found under this Business Portfolio — make sure you logged in as an account with access there.");
  }
  if (pages.length > 1) {
    console.log(`Multiple Pages found: ${pages.map((p) => p.name).join(", ")}. Using the first one — edit facebook-token.json manually if this is wrong.`);
  }

  const page = pages[0];
  const pageAccessToken = await fetchPageAccessToken(page.id, longLivedUserToken);

  // Page access tokens derived from a long-lived user token are
  // themselves long-lived (do not expire on their own) as long as the
  // user token they came from stays valid and the user remains a Page
  // admin — Meta's standard pattern for a server-side auto-poster.
  const tokenData = {
    pageId: page.id,
    pageName: page.name,
    pageAccessToken,
    obtainedAt: new Date().toISOString(),
  };
  await fs.writeFile(TOKEN_PATH, JSON.stringify(tokenData, null, 2), "utf-8");

  console.log(`\nSaved Page access token for "${page.name}" to ${TOKEN_PATH}`);
  console.log("You won't need to log in again unless this token is revoked.");
}

main().catch((err) => {
  console.error("Auth failed:", err.message ?? err);
  process.exit(1);
});
