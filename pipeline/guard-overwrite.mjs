// Every render-*.mjs / daily-publish.mjs script writes a fresh card.json
// for content-queue/pending/<date>_<id>/. If that folder already has a
// card whose status is past "pending" (approved/scheduled/posted), a
// re-render silently wipes its approvedAt/scheduledAt/bufferPostIds/
// youtubeVideoId fields even though the actual published post is
// untouched — a real incident, 2026-09-07 (see project memory). Call
// this before writing a new card.json; it throws instead of silently
// clobbering.
import fs from "node:fs/promises";
import path from "node:path";

export async function assertSafeToOverwrite(queueDir) {
  const cardPath = path.join(queueDir, "card.json");
  let existing;
  try {
    existing = JSON.parse(await fs.readFile(cardPath, "utf-8"));
  } catch {
    return; // no existing card, or unreadable — nothing to protect
  }

  if (existing.status && existing.status !== "pending") {
    throw new Error(
      `Refusing to re-render: ${cardPath} already has status "${existing.status}" ` +
      `(approvedAt=${existing.approvedAt ?? "n/a"}, scheduledAt=${existing.scheduledAt ?? "n/a"}). ` +
      `Re-rendering would wipe its bufferPostIds/youtubeVideoId tracking even though the ` +
      `actual published post is untouched. If you genuinely need to re-render this exact ` +
      `date (e.g. fixing a bug before it's approved), first save the current card.json's ` +
      `publish IDs, then pass --force to skip this check and restore them manually after.`
    );
  }
}
