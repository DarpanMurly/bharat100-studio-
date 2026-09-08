// Enforces two standing house-style rules across all written captions:
// hyphens instead of em dashes, and no serial (Oxford) comma before
// and/or in lists. Call this on any freeform text before it lands in
// a caption, on top of ensureDisclaimer(), not instead of it.

export function applyStyleRules(text) {
  let out = text;
  // Em dash (and en dash used as a break) -> hyphen with matching spacing.
  out = out.replace(/\s*[—–]\s*/g, " - ");
  // Serial comma before and/or in a list: "a, b, and c" -> "a, b and c".
  out = out.replace(/,(\s+(?:and|or)\s+)/g, "$1");
  return out;
}
