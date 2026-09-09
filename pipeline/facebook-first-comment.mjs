// Usage: node pipeline/facebook-first-comment.mjs <date>_<id>
// Posts an auto-generated engagement question as the first comment on a
// Facebook video post, once that post has actually gone live.
//
// Facebook video posts are scheduled ahead of time (see facebook-publish.mjs:
// published:false + scheduled_publish_time), but the returned video/post ID
// is the SAME id the post keeps once it actually goes live — Facebook
// doesn't mint a new object at publish time, only is_published/
// scheduled_publish_time flip. That means card.facebookPostId (saved at
// approval/schedule time) is already the right id to comment on. BUT this
// script must not run until the post's actual slot time has passed —
// commenting on a still-scheduled (not yet public) post is unreliable and
// the comment could be invisible/fail. Run this via
// .github/workflows/facebook-first-comment.yml, the same "fires at the
// slot instant" pattern already used for Bluesky and homepage-sync.
//
// Scoped to VIDEO posts only (card.videoFile) — this is specifically an
// engagement hook for Reels/video content, not every post type.
import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "facebook-token.json");
const GRAPH_VERSION = "v21.0";

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

async function getPageToken() {
  return JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
}

// One question, built from the card's own title — every day's question
// differs because every day's title differs, without needing a rotating
// template set or an extra LLM call at slot time.
function buildQuestion(card) {
  const title = (card.title ?? "").replace(/\.$/, "");
  return `Did you know this before today? "${title}" — curious what surprised you most. 👇`;
}

async function postComment({ pageAccessToken, objectId, message }) {
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${objectId}/comments`;
  const body = new URLSearchParams({ access_token: pageAccessToken, message });
  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  if (json.error) throw new Error(`Facebook comment failed: ${json.error.message}`);
  return json;
}

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/facebook-first-comment.mjs <date>_<id>");
    process.exit(1);
  }

  const queueDir = await findQueueDir(postId);
  const card = JSON.parse(await fs.readFile(path.join(queueDir, "card.json"), "utf-8"));

  if (!card.videoFile) {
    console.log(`Skipping first-comment — not a video post.`);
    return;
  }
  if (!(card.platforms ?? []).includes("Facebook")) {
    console.log(`Skipping first-comment — "Facebook" not in this card's platforms list.`);
    return;
  }
  if (!card.facebookPostId) {
    console.log(`Skipping first-comment — no facebookPostId on this card (not scheduled to Facebook yet?).`);
    return;
  }
  if (card.facebookFirstCommentId) {
    console.log(`Skipping first-comment — already posted (${card.facebookFirstCommentId}).`);
    return;
  }

  const { pageAccessToken } = await getPageToken();
  const message = buildQuestion(card);

  console.log(`\n=== Posting first comment on Facebook post ${card.facebookPostId} ===`);
  console.log(message);

  const result = await postComment({ pageAccessToken, objectId: card.facebookPostId, message });

  console.log(`Comment posted:`, result.id);

  card.facebookFirstCommentId = result.id;
  await fs.writeFile(path.join(queueDir, "card.json"), JSON.stringify(card, null, 2), "utf-8");
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
