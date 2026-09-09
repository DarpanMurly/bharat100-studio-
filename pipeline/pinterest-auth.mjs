// Usage: node pipeline/pinterest-auth.mjs
//    or: node pipeline/pinterest-auth.mjs --sandbox
//
// One-time setup: opens a browser for you to log into Pinterest and
// approve access for the Bharat@100 app, then saves a reusable access
// token (plus refresh token) to pinterest-token.json. Mirrors the same
// local-browser OAuth pattern as facebook-auth.mjs and wordpress-auth.mjs.
//
// --sandbox is REQUIRED while this app only has Trial access — Pinterest
// confirmed directly (2026-09-09) that Sandbox and production tokens are
// completely separate and non-interchangeable: a production-obtained
// token gets "Authentication failed" against api-sandbox.pinterest.com,
// and Trial-access apps get an explicit error trying to create Pins
// against the production api.pinterest.com host. Run WITHOUT --sandbox
// only after Pinterest approves Standard access (a second review gate —
// see project memory) and pins need to go live for the public.
//
// Requires PINTEREST_APP_ID and PINTEREST_APP_SECRET in .env (from
// developer.pinterest.com/apps/, only available once Pinterest approves
// Trial access — see project memory for that backstory). Never paste
// these into chat — add them straight to .env yourself.
//
// Pinterest access tokens expire in 30 days; this script also saves the
// refresh token needed to renew without a fresh browser login — see
// pinterest-publish.mjs, which auto-refreshes when the access token is
// stale rather than requiring this script to be re-run monthly.

import "dotenv/config";
import http from "node:http";
import { exec } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "pinterest-token.json");

const APP_ID = process.env.PINTEREST_APP_ID;
const APP_SECRET = process.env.PINTEREST_APP_SECRET;
const PORT = 8733;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

// pins:write + boards:read/write: the actual publishing permissions this
// project needs. user_accounts:read: lets us confirm which account the
// token belongs to. All three work under Trial access (content just
// stays in a private "sandbox" state, invisible to the public, until
// Pinterest separately approves Standard access — see project memory).
const SCOPES = ["pins:read", "pins:write", "boards:read", "boards:write", "user_accounts:read"].join(",");

function openBrowser(url) {
  const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd);
}

async function exchangeCodeForToken(code, isSandbox) {
  const host = isSandbox ? "api-sandbox.pinterest.com" : "api.pinterest.com";
  const basicAuth = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");
  const res = await fetch(`https://${host}/v5/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Token exchange failed: ${json.error_description ?? json.error}`);
  return json; // { access_token, refresh_token, expires_in, ... }
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
    console.error("Missing PINTEREST_APP_ID or PINTEREST_APP_SECRET in .env — check developer.pinterest.com/apps/ (App Secret is only visible once Trial access is approved).");
    process.exit(1);
  }

  const isSandbox = process.argv.includes("--sandbox");

  const authUrl = new URL("https://www.pinterest.com/oauth/");
  authUrl.searchParams.set("client_id", APP_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);

  console.log(`Opening a browser window — log in with the Pinterest account that owns the Bharatat100 business account.${isSandbox ? " (Sandbox token — Trial access.)" : ""}`);
  console.log(`If it doesn't open automatically, visit:\n${authUrl}\n`);
  openBrowser(authUrl.toString());

  const code = await waitForCallback();
  console.log("Authorization received. Exchanging for a token...");

  const tokenData = await exchangeCodeForToken(code, isSandbox);

  const existing = await fs
    .readFile(TOKEN_PATH, "utf-8")
    .then((s) => JSON.parse(s))
    .catch(() => ({}));

  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify(
      {
        ...existing,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        obtainedAt: new Date().toISOString(),
        isSandbox,
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(`\nSaved Pinterest ${isSandbox ? "Sandbox " : ""}access token to ${TOKEN_PATH}`);
  console.log(`Expires: ${new Date(Date.now() + tokenData.expires_in * 1000).toISOString()} — pinterest-publish.mjs will auto-refresh it after that using the saved refresh token.`);
}

main().catch((err) => {
  console.error("Auth failed:", err.message ?? err);
  process.exit(1);
});
