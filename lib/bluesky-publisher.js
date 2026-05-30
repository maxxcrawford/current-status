const {
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
  postKey,
  readData,
  resolveImageUrl,
  resolveStore,
  seedExistingPostsForStore,
  validatePost,
} = require('./publisher-common');

const { imageSize } = require('image-size');

const STORE_NAME = 'bluesky-posts';
const DEFAULT_BLUESKY_SERVICE = 'https://bsky.social';

async function getLatestPublishRecord(options = {}) {
  const store = await resolveStore(options.store, STORE_NAME);
  return getLatestRecord(store);
}

async function createBlueskyClient(blueskyClient) {
  if (blueskyClient) {
    return blueskyClient;
  }

  const identifier = getEnv('BLUESKY_IDENTIFIER');
  const password = getEnv('BLUESKY_APP_PASSWORD');
  const service = getEnv('BLUESKY_SERVICE') || DEFAULT_BLUESKY_SERVICE;

  if (!identifier || !password) {
    throw new PublishError(
      'BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD are required.',
      'missing_bluesky_environment',
      500
    );
  }

  const { AtpAgent } = await import('@atproto/api');
  const agent = new AtpAgent({ service });

  await agent.login({ identifier, password });

  return agent;
}

function imageEncoding(post, blob) {
  if (blob && blob.type) {
    return blob.type;
  }

  const image = String(post.image || '').split('?')[0].toLowerCase();

  if (image.endsWith('.jpg') || image.endsWith('.jpeg')) {
    return 'image/jpeg';
  }

  if (image.endsWith('.png')) {
    return 'image/png';
  }

  if (image.endsWith('.gif')) {
    return 'image/gif';
  }

  if (image.endsWith('.webp')) {
    return 'image/webp';
  }

  return 'application/octet-stream';
}

async function uploadImage(blueskyClient, post, options) {
  const file = await fetchImageBlob(post, options);
  const response = await blueskyClient.uploadBlob(file, {
    encoding: imageEncoding(post, file),
  });

  return {
    blob: response.data.blob,
    aspectRatio: await imageAspectRatio(file),
  };
}

async function imageAspectRatio(file) {
  const dimensions = imageSize(Buffer.from(await file.arrayBuffer()));

  if (!dimensions.width || !dimensions.height) {
    return null;
  }

  return {
    width: dimensions.width,
    height: dimensions.height,
  };
}

async function createPost(blueskyClient, post, upload, now) {
  const image = {
    image: upload.blob,
    alt: post.imageAltDesc || '',
  };

  if (upload.aspectRatio) {
    image.aspectRatio = upload.aspectRatio;
  }

  return blueskyClient.post({
    text: STATUS_TEXT,
    createdAt: now.toISOString(),
    embed: {
      $type: 'app.bsky.embed.images',
      images: [image],
    },
  });
}

function blueskyUrlFromUri(uri, identifier) {
  const match = String(uri || '').match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/);

  if (!match) {
    return null;
  }

  return `https://bsky.app/profile/${encodeURIComponent(identifier || match[1])}/post/${encodeURIComponent(match[2])}`;
}

async function recordPublishedPost(store, post, status, { claim, commitRef, source, now, identifier }) {
  const uri = status && status.uri ? status.uri : status && status.data && status.data.uri;
  const cid = status && status.cid ? status.cid : status && status.data && status.data.cid;
  const record = {
    guid: post.guid,
    status: 'published',
    blueskyUri: uri || null,
    blueskyCid: cid || null,
    blueskyUrl: blueskyUrlFromUri(uri, identifier),
    postedAt: now.toISOString(),
    commitRef: commitRef || null,
    source: source || null,
  };

  const options = {
    metadata: {
      guid: post.guid,
      status: record.status,
    },
  };

  if (claim && claim.etag) {
    options.onlyIfMatch = claim.etag;
  }

  const result = await store.setJSON(postKey(post.guid), record, options);

  if (result && result.modified === false) {
    throw new PublishError(
      `Publish record for ${post.guid} changed while the Bluesky post was being created.`,
      'publish_record_conflict',
      409,
      { guid: post.guid }
    );
  }

  await store.setJSON(LATEST_PUBLISH_KEY, record, {
    metadata: {
      guid: post.guid,
      status: record.status,
    },
  });

  return record;
}

async function publishLatest(options = {}) {
  const now = options.now || new Date();
  const data = readData(options);
  const posts = data.posts;

  if (posts.length === 0) {
    throw new PublishError('data.json does not contain any posts.', 'invalid_data', 500);
  }

  const store = await resolveStore(options.store, STORE_NAME);
  const { topPost, topRecord, canPublish } = await ensureSingleUnpostedTopPost(store, posts, {
    onlyTop: options.onlyTop,
  });

  if (!canPublish) {
    return {
      action: 'noop',
      reason: topRecord.status === 'publishing' ? 'already_claimed' : 'already_recorded',
      guid: topPost.guid,
      record: topRecord,
    };
  }

  const claim = await claimPost(store, topPost, {
    commitRef: options.commitRef,
    source: options.source,
    now,
  });

  if (!claim) {
    const record = await getPostRecord(store, topPost.guid);

    return {
      action: 'noop',
      reason: record && record.status === 'publishing' ? 'already_claimed' : 'already_recorded',
      guid: topPost.guid,
      record,
    };
  }

  let postCreated = false;

  try {
    const blueskyClient = await createBlueskyClient(options.blueskyClient);
    const imageBlob = await uploadImage(blueskyClient, topPost, {
      fetchImpl: options.fetchImpl,
      localFiles: options.localFiles,
      sourceBaseUrl: options.sourceBaseUrl,
    });
    const status = await createPost(blueskyClient, topPost, imageBlob, now);
    postCreated = true;
    const record = await recordPublishedPost(store, topPost, status, {
      claim,
      commitRef: options.commitRef,
      identifier: options.identifier || getEnv('BLUESKY_IDENTIFIER'),
      source: options.source,
      now,
    });

    return {
      action: 'published',
      guid: topPost.guid,
      blueskyUri: record.blueskyUri,
      blueskyCid: record.blueskyCid,
      blueskyUrl: record.blueskyUrl,
      record,
    };
  } catch (error) {
    if (!postCreated) {
      await deleteClaim(store, topPost.guid);
    }

    throw error;
  }
}

async function publishLatestDirect(options = {}) {
  const now = options.now || new Date();
  const data = readData(options);
  const topPost = data.posts[0];

  validatePost(topPost);

  const blueskyClient = await createBlueskyClient(options.blueskyClient);
  const imageBlob = await uploadImage(blueskyClient, topPost, {
    fetchImpl: options.fetchImpl,
    localFiles: options.localFiles,
    sourceBaseUrl: options.sourceBaseUrl,
  });
  const status = await createPost(blueskyClient, topPost, imageBlob, now);
  const uri = status && status.uri ? status.uri : status && status.data && status.data.uri;
  const cid = status && status.cid ? status.cid : status && status.data && status.data.cid;
  const identifier = options.identifier || getEnv('BLUESKY_IDENTIFIER');

  return {
    action: 'published',
    guid: topPost.guid,
    blueskyUri: uri || null,
    blueskyCid: cid || null,
    blueskyUrl: blueskyUrlFromUri(uri, identifier),
  };
}

async function seedExistingPosts(options = {}) {
  return seedExistingPostsForStore(STORE_NAME, options);
}

module.exports = {
  CURRENT_STATUS_ORIGIN,
  DEFAULT_BLUESKY_SERVICE,
  LATEST_PUBLISH_KEY,
  MultipleUnpostedPostsError,
  PublishError,
  STORE_NAME,
  STATUS_TEXT,
  blueskyUrlFromUri,
  errorToResponse,
  getLatestPublishRecord,
  postKey,
  publishLatest,
  publishLatestDirect,
  readData,
  resolveImageUrl,
  seedExistingPosts,
};
