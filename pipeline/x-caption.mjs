// Builds platform-safe short captions from a full caption's core thought
// plus a small hashtag set. X caps posts at 280 chars and Threads at 500 —
// both routinely exceeded by the full Instagram-length caption, so each
// gets its own trimmed version built the same way, just to a different budget.

const LIMITS = {
  x: 280,
  threads: 500,
};

function buildShortCaption(headline, hashtags, limit, maxTags) {
  const tagString = hashtags.slice(0, maxTags).join(" ");
  const budget = limit - (tagString ? tagString.length + 2 : 0); // +2 for "\n\n"

  let text = headline.trim();
  if (text.length > budget) {
    text = text.slice(0, budget - 1).trimEnd() + "…";
  }

  return tagString ? `${text}\n\n${tagString}` : text;
}

// "One Number, One Day": lead X/Bluesky/Mastodon posts with the day's
// sharpest stat instead of the full headline sentence, so the post reads
// as bait for a reply/quote rather than a dense summary — fast-scroll
// text-first platforms reward a number up front more than a sentence.
// Only sector-video scripts have scenes[].kind === "stat" with a clean
// number + label; other pillars fall back to the plain headline.
export function buildStatLeadHeadline(headline, scenes = []) {
  const statScene = scenes.find((s) => s.kind === "stat" && s.stat);
  if (!statScene) return headline;
  const label = statScene.statLabel ? ` — ${statScene.statLabel}` : "";
  return `${statScene.stat}${label}`;
}

export function buildXCaption(headline, hashtags = [], scenes = []) {
  const leadHeadline = buildStatLeadHeadline(headline, scenes);
  return buildShortCaption(leadHeadline, hashtags, LIMITS.x, 2);
}

export function buildThreadsCaption(fullCaption, headline, hashtags = []) {
  if (fullCaption.length <= LIMITS.threads) return fullCaption;
  return buildShortCaption(headline, hashtags, LIMITS.threads, 4);
}
