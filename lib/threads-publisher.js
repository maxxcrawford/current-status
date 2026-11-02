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

const STORE_NAME = 'threads-posts';
const DEFAULT_THREADS_API_BASE = 'https://graph.threads.net';
const DEFAULT_CONTAINER_POLL_ATTEMPTS = 30;
const DEFAULT_CONTAINER_POLL_INTERVAL_MS = 500;

async function getLatestPublishRecord(options = {}) {
  const store = await resolveStore(options.store, STORE_NAME);
  return getLatestRecord(store);
}

function threadsApiError(message, details = {}) {
  return new PublishError(message, 'threads_api_failed', 502, details);
}

async function readResponse(response, operation) {
  const text = await response.text();
  let body = {};

  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw threadsApiError(`Threads ${operation} returned invalid JSON.`, {
        operation,
        status: response.status,
      });
    }
  }

  if (!response.ok) {
    const apiError = body && body.error;
    throw threadsApiError(
      (apiError && (apiError.message || apiError.error_user_msg)) ||
        `Threads ${operation} failed with status ${response.status}.`,
      {
        operation,
        status: response.status,
        apiError: apiError || body,
      }
    );
  }

  return body;
}

function createThreadsClient(options = {}) {
  if (options.threadsClient) {
    return options.threadsClient;
  }

  const accessToken = options.accessToken || getEnv('THREADS_ACCESS_TOKEN');
  const apiBase = options.apiBase || getEnv('THREADS_API_BASE') || DEFAULT_THREADS_API_BASE;
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!accessToken) {
    throw new PublishError(
      'THREADS_ACCESS_TOKEN is required.',
      'missing_threads_environment',
      500
    );
  }

  if (!fetchImpl) {
    throw new PublishError('No fetch implementation is available.', 'missing_fetch', 500);
  }

  async function request(path, { method = 'GET', params = {}, operation }) {
    const url = new URL(path, `${apiBase.replace(/\/$/, '')}/`);

    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(name, String(value));
      }
    }

    const response = await fetchImpl(url, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
      },
    });

    return readResponse(response, operation);
  }

  return {
    async createImageContainer({ text, imageUrl, altText }) {
      return request('me/threads', {
        method: 'POST',
        operation: 'container creation',
        params: {
          media_type: 'IMAGE',
          text,
          image_url: imageUrl,
          alt_text: altText,
        },
      });
    },

    async publishContainer(containerId) {
      return request('me/threads_publish', {
        method: 'POST',
        operation: 'container publication',
        params: {
          creation_id: containerId,
        },
      });
    },

    async getContainer(containerId) {
      return request(encodeURIComponent(containerId), {
        operation: 'container status lookup',
        params: {
          fields: 'id,status,error_message',
        },
      });
    },

    async getThread(threadId) {
      return request(encodeURIComponent(threadId), {
        operation: 'post lookup',
        params: {
          fields: 'id,permalink',
        },
      });
    },
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForContainer(threadsClient, containerId, options = {}) {
  const attempts = options.containerPollAttempts || DEFAULT_CONTAINER_POLL_ATTEMPTS;
  const interval = options.containerPollIntervalMs ?? DEFAULT_CONTAINER_POLL_INTERVAL_MS;
  const delayImpl = options.delayImpl || delay;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const container = await threadsClient.getContainer(containerId);
    const status = container && container.status;

    if (status === 'FINISHED') {
      return container;
    }

    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new PublishError(
        container.error_message || `Threads container ${containerId} entered ${status} status.`,
        'threads_container_failed',
        502,
        { containerId, status }
      );
    }

    if (attempt < attempts) {
      await delayImpl(interval);
    }
  }

  throw new PublishError(
    `Threads container ${containerId} was not ready before the polling deadline.`,
    'threads_container_timeout',
    504,
    { containerId, attempts }
  );
}

async function createAndPublish(threadsClient, post, options = {}) {
  const container = await threadsClient.createImageContainer({
    text: STATUS_TEXT,
    imageUrl: resolveImageUrl(post.image, options.sourceBaseUrl),
    altText: post.imageAltDesc || '',
  });

  if (!container || !container.id) {
    throw threadsApiError('Threads container creation did not return an id.', {
      operation: 'container creation',
    });
  }

  await waitForContainer(threadsClient, container.id, options);

  const published = await threadsClient.publishContainer(container.id);

  if (!published || !published.id) {
    throw threadsApiError('Threads container publication did not return a post id.', {
      operation: 'container publication',
      containerId: container.id,
    });
  }

  let thread = null;

  try {
    thread = await threadsClient.getThread(published.id);
  } catch (error) {
    console.warn(`Could not look up published Threads post ${published.id}: ${error.message}`);
  }

  return {
    containerId: container.id,
    postId: published.id,
    url: thread && thread.permalink ? thread.permalink : null,
  };
}

async function recordPublishedPost(store, post, status, { claim, commitRef, source, now }) {
  const record = {
    guid: post.guid,
    status: 'published',
    threadsContainerId: status.containerId,
    threadsPostId: status.postId,
    threadsUrl: status.url,
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
      `Publish record for ${post.guid} changed while the Threads post was being created.`,
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
    const threadsClient = createThreadsClient(options);
    const status = await createAndPublish(threadsClient, topPost, options);
    postCreated = true;
    const record = await recordPublishedPost(store, topPost, status, {
      claim,
      commitRef: options.commitRef,
      source: options.source,
      now,
    });

    return {
      action: 'published',
      guid: topPost.guid,
      threadsContainerId: record.threadsContainerId,
      threadsPostId: record.threadsPostId,
      threadsUrl: record.threadsUrl,
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
  const data = readData(options);
  const topPost = data.posts[0];

  validatePost(topPost);

  const threadsClient = createThreadsClient(options);
  const status = await createAndPublish(threadsClient, topPost, options);

  return {
    action: 'published',
    guid: topPost.guid,
    threadsContainerId: status.containerId,
    threadsPostId: status.postId,
    threadsUrl: status.url,
  };
}

async function seedExistingPosts(options = {}) {
  return seedExistingPostsForStore(STORE_NAME, options);
}

module.exports = {
  CURRENT_STATUS_ORIGIN,
  DEFAULT_CONTAINER_POLL_ATTEMPTS,
  DEFAULT_CONTAINER_POLL_INTERVAL_MS,
  DEFAULT_THREADS_API_BASE,
  LATEST_PUBLISH_KEY,
  MultipleUnpostedPostsError,
  PublishError,
  STATUS_TEXT,
  STORE_NAME,
  createThreadsClient,
  errorToResponse,
  getLatestPublishRecord,
  postKey,
  publishLatest,
  publishLatestDirect,
  readData,
  resolveImageUrl,
  seedExistingPosts,
  waitForContainer,
};
