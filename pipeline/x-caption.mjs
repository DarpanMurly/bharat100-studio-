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

export function buildXCaption(headline, hashtags = []) {
  return buildShortCaption(headline, hashtags, LIMITS.x, 2);
}

export function buildThreadsCaption(fullCaption, headline, hashtags = []) {
  if (fullCaption.length <= LIMITS.threads) return fullCaption;
  return buildShortCaption(headline, hashtags, LIMITS.threads, 4);
}
