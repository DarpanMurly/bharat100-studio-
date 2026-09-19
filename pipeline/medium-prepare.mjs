// Usage: node pipeline/medium-prepare.mjs <date> [--weekly]
// Prepares that week's Medium post as a ready-to-paste file — like
// Substack, Medium has no public posting API for an individual creator
// account (only Medium's own Integration Tokens for publications, which
// this project doesn't have), so this is NOT an auto-publish script.
// Reuses the same WordPress weekly-wrap content substack-prepare.mjs
// reuses and reformats it for Medium's own conventions (its own tag cap
// of 5, no native paywall mechanic — Medium's Partner Program pays per
// read-time, not via a manual cut — and its own follow/CTA phrasing).
//
// Requires public/wordpress/<date>-weekly.json to already exist. Unlike
// Substack (which also runs daily), Medium is weekly-only per the user's
// own stated cadence — see check-weekly-cadence.mjs for the automated
// "is one due" check that drives when this actually gets run.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Medium's own recommended cap is 5 tags per post.
const TAGS = ["India", "India2047", "ViksitBharat", "IndianDiaspora", "WeeklyRecap"];

function stripHtml(html) {
  return html
    .replace(/<h2>/g, "\n## ")
    .replace(/<\/h2>/g, "\n")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function main() {
  const date = process.argv[2];
  if (!date) {
    console.error("Usage: node pipeline/medium-prepare.mjs <date>");
    process.exit(1);
  }

  const articlePath = path.join(ROOT, "public", "wordpress", `${date}-weekly.json`);
  let article;
  try {
    article = JSON.parse(await fs.readFile(articlePath, "utf-8"));
  } catch {
    throw new Error(
      `No WordPress weekly digest found at public/wordpress/${date}-weekly.json — write that first (Medium reuses it, same as Substack).`
    );
  }

  const bodyMarkdown = stripHtml(article.bodyHtml);
  const renderSource = (s) => {
    if (typeof s === "string") return s;
    if (s && typeof s === "object" && s.url) return `[${s.text ?? s.url}](${s.url})`;
    return s?.text ?? String(s);
  };
  const sourcesBlock = (article.sources ?? []).map((s) => `- ${renderSource(s)}`).join("\n");

  const output = `# ${article.title}

## Subtitle (Medium's own subtitle field, shown under the title)
${article.excerpt}

## Suggested tags (Medium allows up to 5)
${TAGS.join(", ")}

## Cover image
Use the same cover already generated for WordPress: ${article.coverImageUrl ?? "(none generated yet — run wordpress-cover.mjs first)"}

---
## POST BODY (copy everything below into Medium's editor)
---

${bodyMarkdown}

**Sources**
${sourcesBlock}

*Independent citizen project. Not affiliated with the Government of India.*

Follow the daily version on Instagram, X, YouTube, Threads, Facebook, Bluesky and Mastodon: @bharatat100 (X: @Bharat_at_100_)
`;

  const outDir = path.join(ROOT, "public", "medium");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${date}-weekly.md`);
  await fs.writeFile(outPath, output, "utf-8");

  console.log(`\nMedium weekly post prepared: ${outPath}`);
  console.log(`Copy its contents into Medium's editor, set the cover image manually, and publish.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
