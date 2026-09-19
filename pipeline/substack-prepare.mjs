// Usage: node pipeline/substack-prepare.mjs <date>
// Prepares that day's Substack post as a ready-to-paste file — Substack has
// no public posting API for individual creators, so this is NOT an auto-
// publish script like wordpress-publish.mjs. It reuses the day's WordPress
// digest content (already written, sourced, and reviewed) and reformats it
// for Substack's actual editor conventions and fields, then writes a single
// human-readable .md file the user copies straight into Substack's editor.
//
// Requires public/wordpress/<date>.json to already exist (run AFTER the
// WordPress digest is written, same as wordpress-cover.mjs's ordering).
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Substack's own recommended cap is 5 tags per post (more are accepted but
// stop being useful for their topic-page discovery).
const BASE_TAGS = ["India", "India2047", "ViksitBharat", "IndianEconomy", "IndianDiaspora"];

function stripHtml(html) {
  return html
    .replace(/<h2>/g, "\n## ")
    .replace(/<\/h2>/g, "\n")
    .replace(/<p>/g, "")
    .replace(/<\/p>/g, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n") // collapse the runs of blank lines the tag-stripping above leaves behind
    .trim();
}

async function main() {
  const date = process.argv[2];
  const isWeekly = process.argv.includes("--weekly");
  if (!date) {
    console.error("Usage: node pipeline/substack-prepare.mjs <date> [--weekly]");
    process.exit(1);
  }

  const articlePath = path.join(ROOT, "public", "wordpress", `${date}${isWeekly ? "-weekly" : ""}.json`);
  let article;
  try {
    article = JSON.parse(await fs.readFile(articlePath, "utf-8"));
  } catch {
    throw new Error(
      `No WordPress ${isWeekly ? "weekly digest" : "digest"} found at public/wordpress/${date}${isWeekly ? "-weekly" : ""}.json — write that first (Substack reuses it).`
    );
  }

  const bodyMarkdown = stripHtml(article.bodyHtml);
  // A source entry can be a plain string (unchanged, pre-2026-09-14
  // behavior) or {text, url} for a real clickable link — same
  // backward-compatible schema as wordpress-publish.mjs's buildSourcesHtml.
  const renderSource = (s) => {
    if (typeof s === "string") return s;
    if (s && typeof s === "object" && s.url) return `[${s.text ?? s.url}](${s.url})`;
    return s?.text ?? String(s);
  };
  const sourcesBlock = (article.sources ?? []).map((s) => `- ${renderSource(s)}`).join("\n");

  // Split into SECTIONS (a "## Heading" line plus its following paragraph
  // text), not raw paragraphs — a paywall cut needs to land between whole
  // sections, never mid-section, or it reads as a cut-off sentence rather
  // than a deliberate "subscribe to keep reading" moment.
  const sections = bodyMarkdown.split(/\n(?=## )/).map((s) => s.trim());
  // First "section" is the intro paragraph before any heading — always
  // free. A weekly wrap covers ~7 sections (one per day) vs. a daily
  // digest's ~5 (one per pillar) — give it more free sections before the
  // cut (intro + 3, vs. intro + 2 daily), since it's a naturally stronger
  // paid-tier anchor (a longer, reflective piece, not a quick daily read)
  // and deserves more runway to hook a reader before asking them to pay.
  const freeSectionCount = isWeekly ? 4 : 3;
  const paywallMarkerIndex = Math.min(freeSectionCount, sections.length - 1);

  const output = `# ${article.title}

## Subtitle (Substack's own subtitle field, shown under the title)
${article.excerpt}

## Suggested tags (Substack allows up to ~5 for topic-page discovery)
${(isWeekly ? [...BASE_TAGS.slice(0, 4), "WeeklyRecap"] : BASE_TAGS).join(", ")}

## Cover image
Use the same cover already generated for WordPress: ${article.coverImageUrl ?? "(none generated yet — run wordpress-cover.mjs first)"}

---
## POST BODY (copy everything below into Substack's editor)
---

${sections.slice(0, paywallMarkerIndex).join("\n\n")}

<!-- OPTIONAL PAYWALL CUT — if this is a paid-tier post, insert Substack's
     "paid subscribers only" divider here via the editor's own paywall
     button. For a free daily post, ignore this marker and keep scrolling —
     the full text below is already included either way. -->

${sections.slice(paywallMarkerIndex).join("\n\n")}

**Sources**
${sourcesBlock}

*Independent citizen project. Not affiliated with the Government of India.*

Follow the daily version on Instagram, X, YouTube, Threads, Facebook, Bluesky and Mastodon: @bharatat100 (X: @Bharat_at_100_)

---

*Which of today's five stories stuck with you? Reply to this email and tell me — I read every one.*
`;

  const outDir = path.join(ROOT, "public", "substack");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${date}${isWeekly ? "-weekly" : ""}.md`);
  await fs.writeFile(outPath, output, "utf-8");

  console.log(`\nSubstack ${isWeekly ? "weekly wrap" : "post"} prepared: ${outPath}`);
  console.log(`Copy its contents into Substack's editor, set the cover image manually, and choose free/paid + the optional paywall cut yourself.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
