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

const STORE_NAME = 'mastodon-posts';

async function getLatestPublishRecord(options = {}) {
  const store = await resolveStore(options.store, STORE_NAME);
  return getLatestRecord(store);
}

async function createMastodonClient(mastodonClient) {
  if (mastodonClient) {
    return mastodonClient;
  }

  const url = getEnv('MASTODON_URL');
  const accessToken = getEnv('MASTODON_TOKEN');

  if (!url || !accessToken) {
    throw new PublishError(
      'MASTODON_URL and MASTODON_TOKEN are required.',
      'missing_mastodon_environment',
      500
    );
  }

  const { createRestAPIClient } = await import('masto');

  return createRestAPIClient({
    url,
    accessToken,
  });
}

async function uploadMedia(mastodonClient, post, options) {
  const file = await fetchImageBlob(post, options);

  return mastodonClient.v2.media.create({
    file,
    description: post.imageAltDesc || '',
  });
}

async function createStatus(mastodonClient, attachment) {
  return mastodonClient.v1.statuses.create({
    status: STATUS_TEXT,
    visibility: 'public',
    mediaIds: [attachment.id],
  });
}

async function recordPublishedPost(store, post, status, { claim, commitRef, source, now }) {
  const record = {
    guid: post.guid,
    status: 'published',
    mastodonStatusId: status.id || null,
    mastodonUrl: status.url || null,
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
      `Publish record for ${post.guid} changed while the Mastodon post was being created.`,
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

  let statusCreated = false;

  try {
    const mastodonClient = await createMastodonClient(options.mastodonClient);
    const attachment = await uploadMedia(mastodonClient, topPost, {
      fetchImpl: options.fetchImpl,
      localFiles: options.localFiles,
      sourceBaseUrl: options.sourceBaseUrl,
    });
    const status = await createStatus(mastodonClient, attachment);
    statusCreated = true;
    const record = await recordPublishedPost(store, topPost, status, {
      claim,
      commitRef: options.commitRef,
      source: options.source,
      now,
    });

    return {
      action: 'published',
      guid: topPost.guid,
      mastodonStatusId: record.mastodonStatusId,
      mastodonUrl: record.mastodonUrl,
      record,
    };
  } catch (error) {
    if (!statusCreated) {
      await deleteClaim(store, topPost.guid);
    }

    throw error;
  }
}

async function publishLatestDirect(options = {}) {
  const data = readData(options);
  const topPost = data.posts[0];

  validatePost(topPost);

  const mastodonClient = await createMastodonClient(options.mastodonClient);
  const attachment = await uploadMedia(mastodonClient, topPost, {
    fetchImpl: options.fetchImpl,
    localFiles: options.localFiles,
    sourceBaseUrl: options.sourceBaseUrl,
  });
  const status = await createStatus(mastodonClient, attachment);

  return {
    action: 'published',
    guid: topPost.guid,
    mastodonStatusId: status.id || null,
    mastodonUrl: status.url || null,
  };
}

async function seedExistingPosts(options = {}) {
  return seedExistingPostsForStore(STORE_NAME, options);
}

module.exports = {
  CURRENT_STATUS_ORIGIN,
  LATEST_PUBLISH_KEY,
  MultipleUnpostedPostsError,
  PublishError,
  STORE_NAME,
  STATUS_TEXT,
  errorToResponse,
  getLatestPublishRecord,
  postKey,
  publishLatest,
  publishLatestDirect,
  readData,
  resolveImageUrl,
  seedExistingPosts,
};
