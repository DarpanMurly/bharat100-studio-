// Shared by mastodon-publish.mjs and bluesky-publish.mjs — both platforms
// need a REAL caption built from actual body paragraphs, not a bare hook
// headline. Originally built 2026-09-10 for Mastodon only (as
// buildMastodonCaption, inline in mastodon-publish.mjs) after a real user
// report: Mastodon posts were reading as incomplete sentence fragments,
// traced to reusing card.captionX (X's caption: hook headline + 2 hashtags,
// NO body content) — for pieces about a specific person, that headline
// often doesn't even name the person, since it's written as a teaser/hook,
// not a standalone statement. card.captionThreads doesn't fix this either:
// it only returns the FULL caption verbatim when that full caption already
// fits Threads' 500-char cap, and falls back to the exact same short
// headline-only text otherwise.
//
// EXTRACTED to this shared module 2026-09-13 after the exact same
// incoherence was independently reported on BLUESKY — bluesky-publish.mjs
// was still using card.captionX and had never been updated to match the
// Mastodon fix, since the fix at the time only touched the one file where
// the bug was originally reported. Confirmed live: a Kalpana Saroj video's
// captionX read "₹900Cr — approximate net worth built from a Mumbai chawl
// and a daily-wage tailoring job" with no mention of her name anywhere —
// posted standalone on Bluesky, unrecognizable as being about a person at
// all. Any platform needing a "real, complete-thought" caption under some
// character budget should use this, not invent its own truncation.
//
// Builds from the FULL caption's actual paragraphs (headline + as much
// body prose as fits), dropping the same trailing boilerplate
// build-archive-data.mjs's bodyParagraphs() already excludes (cross-
// platform CTA, disclaimer, sources, hashtag block), then appends the
// card's own hashtags at the end if room remains.
// A small set of common abbreviations that end in a period without ending
// a sentence — checked against the word immediately before a "." so a
// naive split doesn't break "U.S. Bancorp" into "U." + "S. Bancorp..."
// (a real bug hit while building the sentence-level fallback below).
// Not exhaustive; good enough for this project's actual content, which
// doesn't currently use others (Mr., Dr., etc.) in a way that would matter.
const ABBREVIATIONS = new Set(["u.s", "u.k", "e.g", "i.e", "etc", "vs", "no", "mr", "mrs", "dr", "st"]);

function splitIntoSentences(text) {
  const rawParts = text.split(/(?<=[.!?])\s+/);
  const sentences = [];
  let buffer = "";
  for (const part of rawParts) {
    buffer = buffer ? `${buffer} ${part}` : part;
    const lastWord = buffer.slice(0, -1).split(/\s+/).pop()?.toLowerCase() ?? "";
    if (ABBREVIATIONS.has(lastWord)) continue; // keep accumulating, this isn't a real sentence end
    sentences.push(buffer.trim());
    buffer = "";
  }
  if (buffer) sentences.push(buffer.trim());
  return sentences.filter(Boolean);
}

export function buildLongCaption(card, maxChars) {
  const allParagraphs = (card.caption ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);

  // Not every pillar sets card.hashtags as its own array (e.g.
  // motivational-short embeds hashtags only as the caption's own
  // trailing "#Tag1 #Tag2 ..." paragraph) — fall back to extracting
  // that paragraph from the caption itself so hashtags are never
  // silently dropped just because the array field is absent.
  const hashtagParagraph = allParagraphs.find((p) => p.startsWith("#"));
  const hashtagsFromArray = (card.hashtags ?? []).slice(0, 3).join(" ");
  const hashtags = hashtagsFromArray || (hashtagParagraph ? hashtagParagraph.split(" ").slice(0, 3).join(" ") : "");
  const hashtagBlock = hashtags ? `\n\n${hashtags}` : "";

  const paragraphs = allParagraphs.filter((p) => {
    if (p.startsWith("Also on")) return false;
    if (p.startsWith("Independent citizen project")) return false;
    if (p.startsWith("Sources:")) return false;
    if (p.startsWith("#")) return false;
    return true;
  });

  if (paragraphs.length === 0) return card.title ?? "";

  let text = paragraphs[0];
  let usedWholeParagraphs = 1;
  for (let i = 1; i < paragraphs.length; i++) {
    const candidate = `${text}\n\n${paragraphs[i]}`;
    if (candidate.length + hashtagBlock.length > maxChars) break;
    text = candidate;
    usedWholeParagraphs++;
  }

  // On a tight budget (Bluesky's 300 vs. Mastodon's 500), paragraph 1
  // alone is often all that fits — and paragraph 1 is frequently a
  // teaser/hook that never actually names the piece's subject (real
  // example: "She became the first woman CEO in U.S. Bancorp's 160-year
  // history" — Gunjan Kedia's name only appears starting in paragraph 2).
  // Rather than drop the whole next paragraph just because it doesn't fit
  // in full, pull in its individual SENTENCES one at a time — a name
  // usually appears within the first sentence, which is often short
  // enough to fit even when the full paragraph isn't.
  if (usedWholeParagraphs === 1 && paragraphs.length > 1) {
    const nextSentences = splitIntoSentences(paragraphs[1]);
    let addedAny = false;
    for (const sentence of nextSentences) {
      const candidate = `${text} ${sentence}`;
      if (candidate.length + hashtagBlock.length > maxChars) break;
      text = candidate;
      addedAny = true;
    }
    // The very first sentence of paragraph 2 didn't fit whole (a real case:
    // a 254-char single-sentence bio line with no earlier period) — rather
    // than silently keep only the hook paragraph (which may not name the
    // subject at all), truncate that sentence to fit instead of dropping
    // it, so a partial mention still beats zero mention.
    if (!addedAny && nextSentences[0]) {
      const remaining = maxChars - hashtagBlock.length - text.length - 2; // 2 = " " + ellipsis room
      if (remaining > 20) {
        text = `${text} ${nextSentences[0].slice(0, remaining - 1).trimEnd()}…`;
      }
    }
  }

  if (text.length + hashtagBlock.length <= maxChars) {
    text += hashtagBlock;
  } else if (text.length > maxChars) {
    text = text.slice(0, maxChars - 1).trimEnd() + "…";
  }

  return text;
}
