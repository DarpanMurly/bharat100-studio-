// Called by every render script right after the final video is copied
// into its content-queue/pending/<id>/ folder. Deletes the pure scratch
// files that render leaves behind and never needs again: the raw
// Remotion output in out/ (already duplicated into the queue folder) and
// per-scene TTS audio clips under public/<key>/ (clip_0.mp3, silence.mp3,
// concat.txt, etc. — intermediate build artifacts, not the final video).
// Never touches content JSON files under public/ that the website/
// dashboard or a later re-render might still read (e.g.
// public/on-this-day/<date>.json, public/motivational/<date>.json).

import fs from "node:fs/promises";
import path from "node:path";

const INTERMEDIATE_EXTENSIONS = new Set([".mp3", ".txt"]);

export async function cleanupOutFile(outPath) {
  try {
    await fs.rm(outPath, { force: true });
  } catch {
    // already gone, nothing to do
  }
}

// Deletes narration/audio scratch files (clip_*.mp3, silence.mp3,
// concat.txt, outro_hold.mp3, narration.mp3) from a public/<dir> folder
// that belong to one date's render, but leaves .json files alone (those
// are content/manifest data, not render scratch) and leaves other dates'
// files untouched — some render scripts share one folder across every
// day (e.g. public/motivational-short/ holds every date's audio, not per-
// day subfolders), so only files matching this render's own date/id
// prefix are removed, never the whole directory.
export async function cleanupAudioScratch(dir, filePrefix) {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const ext = path.extname(name);
    if (!INTERMEDIATE_EXTENSIONS.has(ext)) continue;
    // "silence.mp3" has no date prefix (shared/regenerated per run, safe
    // to always remove); everything else must match this render's date
    // to avoid touching another day's still-pending scratch files.
    const matchesThisRun = name === "silence.mp3" || !filePrefix || name.startsWith(filePrefix);
    if (matchesThisRun) {
      await fs.rm(path.join(dir, name), { force: true });
    }
  }
}
