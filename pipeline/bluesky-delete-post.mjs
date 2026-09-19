// Usage: node pipeline/bluesky-delete-post.mjs <at://did:.../app.bsky.feed.post/rkey>
// One-off cleanup tool: deletes a single Bluesky post by its at:// URI.
// Not part of the normal pipeline — added 2026-09-19 to remove a genuine
// accidental duplicate created during a platform-coverage backfill audit
// (a workflow_dispatch re-trigger fired before the first run's card.json
// write had landed, so the script correctly saw no recorded URI and
// posted again). Requires BLUESKY_HANDLE and BLUESKY_APP_PASSWORD.
import "dotenv/config";

const SERVICE = "https://bsky.social";
const HANDLE = process.env.BLUESKY_HANDLE;
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;

async function createSession() {
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Bluesky login failed: ${json.message ?? json.error}`);
  return json;
}

async function main() {
  const uri = process.argv[2];
  if (!uri || !uri.startsWith("at://")) {
    console.error("Usage: node pipeline/bluesky-delete-post.mjs <at://...>");
    process.exit(1);
  }
  if (!HANDLE || !APP_PASSWORD) {
    console.error("Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD.");
    process.exit(1);
  }

  // at://did:plc:xxx/app.bsky.feed.post/rkey
  const parts = uri.replace("at://", "").split("/");
  const repo = parts[0];
  const collection = parts[1];
  const rkey = parts[2];

  const session = await createSession();
  const res = await fetch(`${SERVICE}/xrpc/com.atproto.repo.deleteRecord`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ repo, collection, rkey }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
  console.log(`Deleted: ${uri}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
