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

/**
 * Queues a post to one Buffer channel.
 * @param {"instagram"|"threads"|"twitter"} platform
 * @param {string} text - caption, hashtags already included
 * @param {{ imageUrl?: string, videoUrl?: string, imageUrls?: string[] }} media
 *   - imageUrl/videoUrl for a single-asset post, imageUrls for a carousel
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
  if (media.videoUrl) assets.push({ video: { url: media.videoUrl } });

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
