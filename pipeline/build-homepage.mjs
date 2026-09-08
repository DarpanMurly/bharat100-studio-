// Usage: node pipeline/build-homepage.mjs
// Injects the latest archive-data.json into homepage.html's
// __ARCHIVE_DATA__ placeholder, producing the file that actually gets
// published as the Artifact. Run build-archive-data.mjs first (or this
// script always does, so it's never stale).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Static, server-rendered JSON-LD for the archive entries — generated
// here rather than client-side, since search crawlers vary in whether
// they execute JS before indexing. Each entry becomes a NewsArticle-ish
// CreativeWork so the archive's real content (not just the hero) is
// legible as structured data.
function buildArchiveJsonLd(entries) {
  const items = entries.slice(0, 50).map((e) => ({
    "@type": "CreativeWork",
    headline: e.headline,
    datePublished: e.date,
    about: e.pillar,
    ...(e.body.length ? { text: e.body.join(" ") } : {}),
    ...(e.youtubeUrl ? { url: e.youtubeUrl } : {}),
    ...(e.sources.length ? { citation: e.sources } : {}),
  }));
  const graph = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Bharat@100 archive",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item,
    })),
  };
  // Escape "</script" ONLY inside the JSON payload — a headline/citation
  // could theoretically contain that substring — never touch the actual
  // wrapper tags, or the block's real closing tag gets corrupted into an
  // inert escaped one and this script never actually closes (broke once,
  // 2026-09-07: the caller was escaping the whole returned string
  // including these wrapper tags).
  const json = JSON.stringify(graph, null, 2).replace(/<\/script/gi, "<\\/script");
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

async function main() {
  await execFileAsync("node", [path.join(ROOT, "pipeline", "build-archive-data.mjs")], { cwd: ROOT });

  const archiveDataRaw = await fs.readFile(path.join(ROOT, "content-queue", "archive-data.json"), "utf-8");
  const archiveData = JSON.parse(archiveDataRaw);
  const template = await fs.readFile(path.join(ROOT, "homepage.html"), "utf-8");

  if (!template.includes("__ARCHIVE_DATA__")) {
    throw new Error("homepage.html is missing the __ARCHIVE_DATA__ placeholder — was it already substituted? Re-check the source file, not a previously-built copy.");
  }

  // JSON can legally contain "</script>" inside a string, which would
  // break out of the surrounding <script> tag early — escape the slash
  // so it's inert as HTML but round-trips fine through JSON.parse.
  const safeData = archiveDataRaw.replace(/<\/script/gi, "<\\/script");
  let output = template.replace("__ARCHIVE_DATA__", safeData);
  output = output.replace("__ARCHIVE_JSONLD__", buildArchiveJsonLd(archiveData.entries));

  const outPath = path.join(ROOT, "homepage.built.html");
  await fs.writeFile(outPath, output, "utf-8");
  console.log(`Built: ${outPath}`);
  console.log(`Publish THIS file, not homepage.html directly — homepage.html is the editable source with the placeholder still in it.`);

  // Single-page site — one real URL exists (the homepage itself), so the
  // sitemap lists exactly that, honestly, rather than fabricating
  // separate URLs for archive entries that are just in-page anchors, not
  // distinct pages.
  const today = new Date().toISOString().slice(0, 10);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://bharatat100.com/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
  await fs.writeFile(path.join(ROOT, "sitemap.xml"), sitemap, "utf-8");
  console.log(`Built: ${path.join(ROOT, "sitemap.xml")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
