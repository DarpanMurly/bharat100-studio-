// Usage: node pipeline/pinterest-publish.mjs <date>_<id>
// Publishes the approved card to Pinterest as an image pin, using the
// card's thumbnail (not the full video — Pinterest's video-pin format
// needs its own aspect-ratio/duration handling this project's existing
// assets don't cleanly match, so starting with image pins keeps this
// simple and reliable), with a destination link back to the YouTube
// video so Pinterest functions as a discovery/search surface pointing
// at the real content, matching how Pinterest pins are meant to work
// (a landing-page model, unlike native-only platforms).
//
// IMPORTANT: under Pinterest's current Trial access, pins created here
// are "sandboxed" — visible only to this account, NOT the public — until
// Pinterest separately approves Standard access (a second review gate
// requiring a video-recorded OAuth+API demo). See project memory for the
// full backstory. Don't expect these pins to be publicly discoverable
// yet even though this script runs successfully.
//
// Requires pipeline/pinterest-auth.mjs to have been run once already,
// and at least one board per pillar to exist (see pinterest-token.json's
// boardIds map, or re-run the board-creation step if boards are missing).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { uploadToCloudinary } from "./cloudinary-upload.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "pinterest-token.json");

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

async function getToken() {
  const token = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));

  // Auto-refresh if the access token is expired or expiring soon — a
  // daily-running pipeline shouldn't need a manual re-auth every 30 days.
  const expiresAt = new Date(token.expiresAt).getTime();
  if (Date.now() < expiresAt - 24 * 60 * 60 * 1000) {
    return token;
  }

  console.log("Pinterest access token expired or expiring soon — refreshing...");
  const APP_ID = process.env.PINTEREST_APP_ID;
  const APP_SECRET = process.env.PINTEREST_APP_SECRET;
  const host = token.isSandbox ? "api-sandbox.pinterest.com" : "api.pinterest.com";
  const basicAuth = Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");
  const res = await fetch(`https://${host}/v5/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Token refresh failed: ${json.error_description ?? json.error}`);

  const refreshed = {
    ...token,
    accessToken: json.access_token,
    expiresAt: new Date(Date.now() + json.expires_in * 1000).toISOString(),
  };
  await fs.writeFile(TOKEN_PATH, JSON.stringify(refreshed, null, 2), "utf-8");
  return refreshed;
}

async function createPin({ accessToken, boardId, imageUrl, title, description, link, isSandbox }) {
  const host = isSandbox ? "api-sandbox.pinterest.com" : "api.pinterest.com";
  const res = await fetch(`https://${host}/v5/pins`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      board_id: boardId,
      title: title.slice(0, 100), // Pinterest's own title length cap
      description: description.slice(0, 500),
      link,
      media_source: {
        source_type: "image_url",
        url: imageUrl,
      },
    }),
  });
  const json = await res.json();
  if (json.code) throw new Error(`Pinterest pin creation failed: ${json.message ?? JSON.stringify(json)}`);
  return json; // { id, ... }
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/pinterest-publish.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!(card.platforms ?? []).includes("Pinterest")) {
    console.log(`Skipping Pinterest — "Pinterest" not in this card's platforms list.`);
    return;
  }

  const token = await getToken();
  const boardId = token.boardIds?.[card.pillar];
  if (!boardId) {
    throw new Error(`No board ID found for pillar "${card.pillar}" — check pinterest-token.json's boardIds map.`);
  }

  if (!card.thumbnailFile) {
    throw new Error(`Card has no thumbnailFile — nothing to use as the pin image.`);
  }

  console.log(`\n=== Publishing "${card.title}" to Pinterest (board: ${card.pillar}) ===`);
  console.log(`Uploading thumbnail to Cloudinary...`);
  const imageUrl = await uploadToCloudinary(path.join(queueDir, card.thumbnailFile));

  // Pinterest is search/discovery-driven — description should read like
  // a keyword-rich summary, not a social caption. Prefer the caption's
  // first paragraph (the real, untruncated headline) plus a fixed
  // discovery phrase, over pasting the full hashtag-laden social caption.
  const headline = (card.caption ?? "").split("\n\n")[0]?.trim() || card.title;
  const description = `${headline} India's growth story toward 2047, sourced and explained. #Bharat100 #India2047 #ViksitBharat`;
  const link = card.youtubeUrl || `https://bharatat100.com`;

  const result = await createPin({
    accessToken: token.accessToken,
    isSandbox: token.isSandbox,
    boardId,
    imageUrl,
    title: headline,
    description,
    link,
  });

  console.log(`Pin created: ${result.id}`);
  console.log(`Note: under Trial access, this pin is only visible to this account, not the public, until Pinterest approves Standard access.`);

  card.pinterestPinId = result.id;
  card.pinterestPostedAt = new Date().toISOString();
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
