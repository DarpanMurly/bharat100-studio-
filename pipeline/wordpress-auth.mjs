// Usage: node pipeline/wordpress-auth.mjs
// One-time setup: opens a browser for you to log into WordPress.com and
// approve API access for the Bharat@100 app, then saves a reusable
// access token to wordpress-token.json. Mirrors the same local-browser
// OAuth pattern as facebook-auth.mjs and youtube-auth.mjs.
//
// Requires WORDPRESS_CLIENT_ID and WORDPRESS_CLIENT_SECRET in .env (from
// developer.wordpress.com/apps/, registered as a "Native" application
// type with redirect URL http://localhost:8732/callback). Never paste
// these into chat — add them straight to .env yourself.
//
// WordPress.com access tokens do not expire on their own (unlike a
// typical short-lived OAuth token) as long as the user doesn't revoke
// access — no refresh-token handling needed for this project's daily
// publishing use case.

import "dotenv/config";
import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "wordpress-token.json");

const CLIENT_ID = process.env.WORDPRESS_CLIENT_ID;
const CLIENT_SECRET = process.env.WORDPRESS_CLIENT_SECRET;
const PORT = 8732;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// "global" scope is required to publish posts via the REST API — a
// narrower scope only allows reading public data. Note: with "global"
// scope, the token exchange response's blog_id/blog_url come back as
// "0"/null (account-wide token, not site-scoped) — the actual site is
// looked up separately below via its known slug.
const SCOPE = "global";
const SITE_SLUG = "bharatat100.wordpress.com";

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

async function exchangeCodeForToken(code) {
  const res = await fetch("https://public-api.wordpress.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code",
      code,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Token exchange failed: ${json.error_description ?? json.error}`);
  return json; // { access_token, blog_id, blog_url, token_type, scope }
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
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing WORDPRESS_CLIENT_ID or WORDPRESS_CLIENT_SECRET in .env — register a Native app at developer.wordpress.com/apps/ first.");
    process.exit(1);
  }

  const authUrl = new URL("https://public-api.wordpress.com/oauth2/authorize");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);

  console.log("Opening a browser window — log in with the WordPress.com account that owns bharatat100.wordpress.com.");
  console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
  openBrowser(authUrl.toString());

  const code = await waitForCallback();
  console.log("Authorization received. Exchanging for a token...");

  const tokenData = await exchangeCodeForToken(code);

  // "global" scope returns blog_id "0" / blog_url null (account-wide
  // token, not site-scoped) — look the real site up by its known slug.
  const siteRes = await fetch(`https://public-api.wordpress.com/rest/v1.1/sites/${SITE_SLUG}`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const site = await siteRes.json();
  if (site.error) throw new Error(`Site lookup failed: ${site.message ?? site.error}`);

  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify(
      {
        accessToken: tokenData.access_token,
        blogId: String(site.ID),
        blogUrl: site.URL,
        obtainedAt: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`\nSaved WordPress.com access token for "${site.URL}" to ${TOKEN_PATH}`);
  console.log("You won't need to log in again unless this token is revoked.");
}

main().catch((err) => {
  console.error("Auth failed:", err.message ?? err);
  process.exit(1);
});
