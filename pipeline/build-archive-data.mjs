// Usage: node pipeline/build-archive-data.mjs
// Scans content-queue/pending/*/card.json for every published (non-
// pending) post and produces a single archive-data.json the homepage's
// archive page reads from. This is the durable-record piece of the
// project: a growing, searchable record of every fact/story ever
// published, independent of what any social platform's feed still shows.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyStyleRules } from "./style.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function firstParagraph(text) {
  return (text ?? "").split("\n\n")[0]?.trim() ?? "";
}

function bodyParagraphs(text) {
  // Drop the first paragraph (headline, already shown separately), the
  // cross-platform CTA line, the disclaimer line, and the trailing
  // hashtag block — leaving just the substantive body paragraphs.
  const paras = (text ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);
  return paras.slice(1).filter((p) => {
    if (p.startsWith("Also on")) return false;
    if (p.startsWith("Independent citizen project")) return false;
    if (p.startsWith("Sources:")) return false;
    if (p.startsWith("#")) return false;
    return true;
  });
}

async function main() {
  const pendingDir = path.join(ROOT, "content-queue", "pending");
  const dirs = await fs.readdir(pendingDir);

  const rawEntries = [];
  for (const dir of dirs) {
    const cardPath = path.join(pendingDir, dir, "card.json");
    let card;
    try {
      card = JSON.parse(await fs.readFile(cardPath, "utf-8"));
    } catch {
      continue;
    }
    // Only genuinely LIVE content belongs in a public archive. "approved"
    // means queued-but-not-yet-live. Both "scheduled" and "posted" can
    // mean genuinely live — this comment used to say nothing in the
    // pipeline ever sets "posted", but that's since become false (found
    // 2026-09-10: most real cards ARE marked "posted" once live, and this
    // filter's status!=="scheduled" check was silently excluding almost
    // all of them from the archive — only 2 entries were making it
    // through instead of 25+). Accept either status, still gated on the
    // slot instant actually being in the past (or unset, which only
    // happens on cards old enough to predate scheduledAt/
    // youtubeScheduledAt being recorded at all — those are unambiguously
    // already live too).
    if (card.status !== "scheduled" && card.status !== "posted") continue;
    const slotAt = card.scheduledAt ?? card.youtubeScheduledAt;
    if (slotAt && new Date(slotAt).getTime() > Date.now()) continue;
    if (card.type === "weekly-recap") continue; // a recap of other entries, not its own story

    rawEntries.push({ dir, date: card.date, type: card.type, card });
  }

  // A legacy still-image post and its later Short-video replacement (same
  // day, same pillar: "motivational" + "motivational-short", "on-this-day"
  // + "on-this-day-short") are the SAME story, not two archive entries —
  // same dedup principle as render-weekly-recap.mjs. Prefer the Short
  // (video) version, since that's the one that actually carries a
  // youtubeUrl and is the primary asset per the unified video-everywhere
  // format.
  const LEGACY_OF_SHORT = { "motivational-short": "motivational", "on-this-day-short": "on-this-day" };
  const shortDayKeys = new Set(
    rawEntries.filter((e) => LEGACY_OF_SHORT[e.type]).map((e) => `${e.date}:${LEGACY_OF_SHORT[e.type]}`)
  );
  const deduped = rawEntries.filter((e) => !shortDayKeys.has(`${e.date}:${e.type}`));

  // A future pipeline change could produce a card missing `date` or
  // `caption` entirely (a new content type built without this contract
  // in mind) — skip it rather than publish a garbage entry (empty
  // headline, "undefined" date) to a PUBLIC archive page. Log so it's
  // visible during generation, not a silent gap discovered later.
  const entries = [];
  for (const { dir, card } of deduped) {
    const headline = applyStyleRules(firstParagraph(card.caption));
    if (!card.date || !headline) {
      console.warn(`  Skipping ${dir}: missing date or caption — not a valid archive entry.`);
      continue;
    }
    entries.push({
      id: dir,
      date: card.date,
      pillar: card.pillar ?? "Unknown",
      // Style rules (hyphens, no serial comma) are applied here too, not
      // just at generation time — legacy cards from before pipeline/
      // style.mjs existed still have raw em dashes/Oxford commas in their
      // stored caption text, and this archive is a new, more permanent
      // public surface for that old text.
      headline,
      body: bodyParagraphs(card.caption).map((p) => applyStyleRules(p)),
      sources: (card.sources ?? []).map((s) => applyStyleRules(s)),
      youtubeUrl: card.youtubeUrl ?? null,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const outPath = path.join(ROOT, "content-queue", "archive-data.json");
  await fs.writeFile(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), entries }, null, 2), "utf-8");
  console.log(`Archive data written: ${entries.length} entries -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
