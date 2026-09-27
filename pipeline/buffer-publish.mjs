import "dotenv/config";

const API_KEY = process.env.BUFFER_API_KEY;

const CHANNEL_IDS = {
  instagram: process.env.BUFFER_CHANNEL_INSTAGRAM,
  threads: process.env.BUFFER_CHANNEL_THREADS,
  twitter: process.env.BUFFER_CHANNEL_TWITTER,
};

const CREATE_POST_MUTATION = `
  mutation CreatePost($input: CreatePostInput!) {
    createPost(input: $input) {
      ... on PostActionSuccess {
        post { id text dueAt }
      }
      ... on MutationError {
        message
      }
    }
  }
`;

async function graphql(query, variables) {
  const res = await fetch("https://api.buffer.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

// Buffer does NOT support a custom thumbnail image on video assets — a
// direct API test (2026-09-07) confirmed `thumbnailUrl` is rejected with
// "social networks do not accept custom video thumbnail images." The
// only supported cover-frame control is `metadata.thumbnailOffset`, a
// millisecond offset INTO the actual video, and only for Instagram/
// TikTok/Pinterest (not X/Threads at all).
//
// Fallback ONLY — frame 25 (0.83s at 30fps), the old fixed hook-frame
// constant. Prefer media.thumbnailFrame (the card's own thumbnailFrame,
// set by extract-thumbnail.mjs) whenever it's available: that's the
// SAME frame chosen for YouTube's custom thumbnail (often the bigger
// stat/year scene, not the hook), and these two silently drifted apart
// before this fix (found 2026-09-10) — this fallback only fires for
// older cards generated before card.thumbnailFrame existed.
const DEFAULT_THUMBNAIL_FRAME = 25;
const FPS = 30;

/**
 * Queues a post to one Buffer channel.
 * @param {"instagram"|"threads"|"twitter"} platform
 * @param {string} text - caption, hashtags already included
 * @param {{ imageUrl?: string, videoUrl?: string, imageUrls?: string[], thumbnailFrame?: number }} media
 *   - imageUrl/videoUrl for a single-asset post, imageUrls for a carousel.
 *   - thumbnailFrame: the exact video frame number to use as Instagram's
 *     cover (see extract-thumbnail.mjs) — falls back to
 *     DEFAULT_THUMBNAIL_FRAME if not provided.
 * @param {{ saveToDraft?: boolean, dueAt?: string, postType?: "post"|"reel"|"carousel" }} options
 */
export async function queuePost(platform, text, media = {}, options = {}) {
  const channelId = CHANNEL_IDS[platform];
  if (!channelId) throw new Error(`No channel id configured for platform "${platform}"`);

  const assets = [];
  if (media.imageUrls?.length) {
    for (const url of media.imageUrls) assets.push({ image: { url } });
  } else if (media.imageUrl) {
    assets.push({ image: { url: media.imageUrl } });
  }
  if (media.videoUrl) {
    const frame = media.thumbnailFrame ?? DEFAULT_THUMBNAIL_FRAME;
    const thumbnailOffsetMs = Math.round((frame / FPS) * 1000);
    assets.push({
      video: {
        url: media.videoUrl,
        // Scoped to Instagram — the one platform Buffer's own error
        // message named as supported (also TikTok/Pinterest, neither
        // connected here). A quick test on X didn't error for including
        // it, but that's not the same as confirmed-correct behavior
        // there — only send it where the docs actually say it applies.
        ...(platform === "instagram" ? { metadata: { thumbnailOffset: thumbnailOffsetMs } } : {}),
      },
    });
  }

  const input = {
    text,
    channelId,
    assets,
    needsApproval: false,
    schedulingType: "automatic",
    mode: "addToQueue",
  };

  if (options.saveToDraft) {
    input.saveToDraft = true;
  } else if (options.dueAt) {
    input.mode = "customScheduled";
    input.dueAt = options.dueAt;
  }

  // Instagram requires an explicit post type per Buffer's schema
  // (post/reel/carousel/story/...). Threads and X/Twitter don't need this.
  if (platform === "instagram") {
    const postType =
      // Instagram's post-type field only accepts post/story/reel — a
      // carousel is just a "post" with multiple image assets attached,
      // not its own type value.
      options.postType ?? (media.videoUrl ? "reel" : "post");
    input.metadata = {
      instagram: {
        type: postType,
        shouldShareToFeed: true,
      },
    };
  }

  const data = await graphql(CREATE_POST_MUTATION, { input });
  const result = data.createPost;

  if (result.message) {
    throw new Error(`Buffer error: ${result.message}`);
  }
  return result.post;
}

const POST_EXISTS_QUERY = `
  query Post($id: PostId!) {
    post(input: { id: $id }) { id }
  }
`;

// Confirmed 2026-09-27: createPost's mutation can return
// PostActionSuccess with a real-looking id for a post that never
// actually gets created on Buffer's side (found across 11 posts,
// Instagram/Threads/X, Sep 22-26) — the mutation response alone is not
// a reliable success signal. Always confirm with a follow-up read.
//
// CRITICAL: a rate limit is NOT "not found." A same-session incident
// (2026-09-27) proved a rapid, unpaced sweep of many ids can itself
// trip Buffer's RATE_LIMIT_EXCEEDED mid-sweep, and every subsequent
// call in that sweep threw — if that throw is swallowed into "false"
// here, it reads as a wave of ghosts that were never actually ghosts.
// Re-throw rate-limit errors so the caller can stop and report instead
// of silently mis-recording them as missing posts.
export async function verifyPostExists(id) {
  try {
    const data = await graphql(POST_EXISTS_QUERY, { id });
    return !!data?.post?.id;
  } catch (err) {
    if (String(err.message).includes("RATE_LIMIT_EXCEEDED")) throw err;
    // A genuine GraphQL error for this id (e.g. "not found") means the
    // post really isn't there.
    return false;
  }
}

/**
 * Same as queuePost, but confirms the returned id actually resolves on
 * Buffer before trusting it, retrying the mutation once on a ghost.
 * Throws if the post is still a ghost after the retry.
 */
export async function queuePostVerified(platform, text, media = {}, options = {}) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    const post = await queuePost(platform, text, media, options);
    await new Promise((r) => setTimeout(r, 800));
    if (await verifyPostExists(post.id)) return post;
    console.error(`  ${platform}: queuePost returned a ghost id (${post.id})${attempt === 1 ? ", retrying once..." : ""}`);
  }
  throw new Error(`Buffer error: post was queued but never actually created (ghost id) on ${platform}, after retry`);
}
