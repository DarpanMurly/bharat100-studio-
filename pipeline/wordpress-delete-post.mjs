// Usage: node pipeline/wordpress-delete-post.mjs <postId>
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TOKEN_PATH = path.join(ROOT, "wordpress-token.json");

async function main() {
  const postId = process.argv[2];
  if (!postId) {
    console.error("Usage: node pipeline/wordpress-delete-post.mjs <postId>");
    process.exit(1);
  }
  const { accessToken, blogId } = JSON.parse(await fs.readFile(TOKEN_PATH, "utf-8"));
  const url = `https://public-api.wordpress.com/rest/v1.1/sites/${blogId}/posts/${postId}/delete`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Delete failed: ${JSON.stringify(data)}`);
  }
  console.log(`Deleted post ${postId}. Status: ${data.status}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
