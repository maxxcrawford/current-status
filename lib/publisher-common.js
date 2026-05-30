const Fs = require('fs');
const Path = require('path');

const LATEST_PUBLISH_KEY = 'latest.json';
const STATUS_TEXT = 'current status:';
const CURRENT_STATUS_ORIGIN = 'https://current-status.com';
const DEFAULT_DATA_PATH = Path.resolve(process.cwd(), 'data.json');

class PublishError extends Error {
  constructor(message, code, statusCode = 500, details = {}) {
    super(message);
    this.name = 'PublishError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

class MultipleUnpostedPostsError extends PublishError {
  constructor(guids) {
    super(
      `More than one unposted post is at the top of data.json: ${guids.join(', ')}`,
      'multiple_unposted_posts',
      409,
      { guids }
    );
    this.name = 'MultipleUnpostedPostsError';
  }
}

function readData({ data, dataPath = DEFAULT_DATA_PATH } = {}) {
  const parsed = data || JSON.parse(Fs.readFileSync(dataPath, 'utf8'));

  if (!parsed || !Array.isArray(parsed.posts)) {
    throw new PublishError('data.json must contain a posts array.', 'invalid_data', 500);
  }

  return parsed;
}

function normalizeGuid(guid) {
  const normalized = String(guid || '').replace(/^#/, '').trim();

  if (!normalized) {
    throw new PublishError('Post is missing a guid.', 'invalid_post', 500);
  }

  return normalized;
}

function postKey(guid) {
  return `posts/${encodeURIComponent(normalizeGuid(guid))}.json`;
}

function validatePost(post) {
  if (!post || typeof post !== 'object') {
    throw new PublishError('Top data.json post is missing.', 'invalid_post', 500);
  }

  normalizeGuid(post.guid);

  if (!post.image) {
    throw new PublishError(`Post ${post.guid} is missing an image.`, 'invalid_post', 500, {
      guid: post.guid,
    });
  }
}

function getEnv(name) {
  return process.env[name] && process.env[name].trim();
}

async function createBlobStore(storeName) {
  const { getStore } = require('@netlify/blobs');
  const siteID = getEnv('NETLIFY_SITE_ID') || getEnv('SITE_ID');
  const token =
    getEnv('NETLIFY_AUTH_TOKEN') || getEnv('NETLIFY_API_TOKEN') || getEnv('NETLIFY_BLOBS_TOKEN');

  try {
    if (siteID && token) {
      return getStore(storeName, { siteID, token });
    }

    return getStore(storeName);
  } catch (error) {
    throw new PublishError(
      'Netlify Blobs is not configured. Run inside Netlify, or set NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN for Blob-backed scripts.',
      'missing_blobs_environment',
      500,
      { cause: error.message, storeName }
    );
  }
}

async function resolveStore(store, storeName) {
  return store || createBlobStore(storeName);
}

async function getPostRecord(store, guid) {
  return store.get(postKey(guid), { type: 'json' });
}

async function getLatestRecord(store) {
  return store.get(LATEST_PUBLISH_KEY, { type: 'json' });
}

async function claimPost(store, post, { commitRef, source, now }) {
  const record = {
    guid: post.guid,
    status: 'publishing',
    claimedAt: now.toISOString(),
    commitRef: commitRef || null,
    source: source || null,
  };

  const result = await store.setJSON(postKey(post.guid), record, {
    onlyIfNew: true,
    metadata: {
      guid: post.guid,
      status: record.status,
    },
  });

  if (result && result.modified === false) {
    return null;
  }

  return {
    record,
    etag: result && result.etag,
  };
}

async function deleteClaim(store, guid) {
  try {
    await store.delete(postKey(guid));
  } catch (error) {
    console.warn(`Could not delete failed publish claim for ${guid}: ${error.message}`);
  }
}

function resolveImageUrl(image, sourceBaseUrl) {
  const baseUrl = sourceBaseUrl || CURRENT_STATUS_ORIGIN;
  const imageUrl = new URL(image, CURRENT_STATUS_ORIGIN);

  if (sourceBaseUrl && imageUrl.origin === CURRENT_STATUS_ORIGIN) {
    const sourceUrl = new URL(baseUrl);
    return new URL(`${imageUrl.pathname}${imageUrl.search}`, sourceUrl).toString();
  }

  return imageUrl.toString();
}

function contentTypeFromPath(filePath) {
  const extension = Path.extname(filePath).toLowerCase();

  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg';
  }

  if (extension === '.png') {
    return 'image/png';
  }

  if (extension === '.gif') {
    return 'image/gif';
  }

  if (extension === '.webp') {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

function localImagePath(post) {
  const candidates = [];

  if (post.displayImage) {
    candidates.push(post.displayImage);
  }

  if (post.image) {
    const imageUrl = new URL(post.image, CURRENT_STATUS_ORIGIN);

    if (imageUrl.origin === CURRENT_STATUS_ORIGIN) {
      candidates.push(`.${imageUrl.pathname}`);
    }
  }

  for (const candidate of candidates) {
    const filePath = Path.resolve(process.cwd(), candidate);

    if (Fs.existsSync(filePath)) {
      return filePath;
    }
  }

  return null;
}

async function fetchImageBlob(post, options = {}) {
  const { fetchImpl = globalThis.fetch, localFiles, sourceBaseUrl } = options;

  if (localFiles) {
    const filePath = localImagePath(post);

    if (filePath) {
      return new Blob([Fs.readFileSync(filePath)], { type: contentTypeFromPath(filePath) });
    }
  }

  if (!fetchImpl) {
    throw new PublishError('No fetch implementation is available.', 'missing_fetch', 500);
  }

  const imageUrl = resolveImageUrl(post.image, sourceBaseUrl);
  const response = await fetchImpl(imageUrl);

  if (!response.ok) {
    throw new PublishError(
      `Could not fetch image for ${post.guid}: ${response.status} ${response.statusText || ''}`.trim(),
      'image_fetch_failed',
      502,
      { guid: post.guid, imageUrl, status: response.status }
    );
  }

  return response.blob();
}

async function ensureSingleUnpostedTopPost(store, posts, options = {}) {
  const topPost = posts[0];
  validatePost(topPost);

  const topRecord = await getPostRecord(store, topPost.guid);

  if (topRecord) {
    return {
      topPost,
      topRecord,
      canPublish: false,
    };
  }

  if (options.onlyTop) {
    return {
      topPost,
      topRecord: null,
      canPublish: true,
    };
  }

  const secondPost = posts[1];

  if (secondPost) {
    validatePost(secondPost);

    const secondRecord = await getPostRecord(store, secondPost.guid);

    if (!secondRecord) {
      throw new MultipleUnpostedPostsError([topPost.guid, secondPost.guid]);
    }
  }

  return {
    topPost,
    topRecord: null,
    canPublish: true,
  };
}

async function seedExistingPostsForStore(storeName, options = {}) {
  const now = options.now || new Date();
  const data = readData(options);
  const posts = options.onlyTop ? data.posts.slice(0, 1) : data.posts;
  const store = await resolveStore(options.store, storeName);
  let seeded = 0;
  let skipped = 0;

  for (const post of posts) {
    validatePost(post);

    const record = {
      guid: post.guid,
      status: 'seeded',
      seededAt: now.toISOString(),
      commitRef: options.commitRef || null,
      source: options.source || 'seed',
    };

    const result = await store.setJSON(postKey(post.guid), record, {
      onlyIfNew: true,
      metadata: {
        guid: post.guid,
        status: record.status,
      },
    });

    if (result && result.modified === false) {
      skipped += 1;
    } else {
      seeded += 1;
    }
  }

  return {
    action: 'seeded',
    seeded,
    skipped,
    total: posts.length,
    availableTotal: data.posts.length,
  };
}

function errorToResponse(error) {
  if (error instanceof PublishError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    statusCode: 500,
    body: {
      error: 'publish_failed',
      message: error.message,
    },
  };
}

module.exports = {
  CURRENT_STATUS_ORIGIN,
  LATEST_PUBLISH_KEY,
  MultipleUnpostedPostsError,
  PublishError,
  STATUS_TEXT,
  claimPost,
  deleteClaim,
  ensureSingleUnpostedTopPost,
  errorToResponse,
  fetchImageBlob,
  getEnv,
  getLatestRecord,
  getPostRecord,
  localImagePath,
  normalizeGuid,
  postKey,
  readData,
  resolveImageUrl,
  resolveStore,
  seedExistingPostsForStore,
  validatePost,
};
