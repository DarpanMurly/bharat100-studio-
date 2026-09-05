// Single source of truth for the legal disclaimer line every piece of
// content must carry — the core protection against implying government
// affiliation. Import this everywhere a caption is built; never
// hand-write the disclaimer text inline in a script or pipeline, so
// there is exactly one place to fix if the wording ever needs to change.
export const DISCLAIMER = "Independent citizen project. Not affiliated with the Government of India.";

// Appends the disclaimer to a caption if it isn't already present
// (case-insensitive substring check) — safe to call even on captions
// that already include it by hand, so it can be applied unconditionally
// at the pipeline level without producing duplicates.
export function ensureDisclaimer(caption) {
  if (caption.toLowerCase().includes("not affiliated")) return caption;
  return `${caption}\n\n${DISCLAIMER}`;
}
