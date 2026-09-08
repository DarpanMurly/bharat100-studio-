// Single source of truth for the legal disclaimer line every piece of
// content must carry - the core protection against implying government
// affiliation. Import this everywhere a caption is built; never
// hand-write the disclaimer text inline in a script or pipeline, so
// there is exactly one place to fix if the wording ever needs to change.
import { applyStyleRules } from "./style.mjs";

export const DISCLAIMER = "Independent citizen project. Not affiliated with the Government of India.";

// One-line cross-platform pointer, added to the full Instagram caption and
// the YouTube description only (X/Threads captions are already tight
// against their character caps and don't have room without cutting
// something else). Points wherever the viewer ISN'T already, not back to
// the platform they're already on.
export const CROSS_PLATFORM_CTA_FROM_INSTAGRAM = "Also on YouTube, X and Threads: @bharatat100 (X: @Bharat_at_100)";
export const CROSS_PLATFORM_CTA_FROM_YOUTUBE = "Also on Instagram and Threads: @bharatat100 · X: @Bharat_at_100";

// Appends the disclaimer to a caption if it isn't already present
// (case-insensitive substring check) - safe to call even on captions
// that already include it by hand, so it can be applied unconditionally
// at the pipeline level without producing duplicates. Also applies the
// house style rules (hyphens, no serial comma) so every caption that
// passes through here is normalized regardless of source.
export function ensureDisclaimer(caption) {
  const styled = applyStyleRules(caption);
  if (styled.toLowerCase().includes("not affiliated")) return styled;
  return `${styled}\n\n${DISCLAIMER}`;
}
