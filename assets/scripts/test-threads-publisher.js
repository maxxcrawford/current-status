const assert = require('assert/strict');

const {
  STATUS_TEXT,
  createThreadsClient,
  postKey,
  publishLatest,
  publishLatestDirect,
  waitForContainer,
} = require('../../lib/threads-publisher');

class MemoryStore {
  constructor() {
    this.entries = new Map();
    this.etag = 0;
  }

  async get(key) {
    const entry = this.entries.get(key);
    return entry ? entry.value : null;
  }

  async setJSON(key, value, options = {}) {
    const existing = this.entries.get(key);

    if (options.onlyIfNew && existing) {
      return { modified: false };
    }

    if (options.onlyIfMatch && (!existing || existing.etag !== options.onlyIfMatch)) {
      return { modified: false };
    }

    const etag = `etag-${++this.etag}`;
    this.entries.set(key, { value, etag, metadata: options.metadata || null });
    return { modified: true, etag };
  }

  async delete(key) {
    this.entries.delete(key);
  }
}

function post(guid = '#20260529T0737') {
  const id = guid.replace(/^#/, '');

  return {
    guid,
    image: `https://current-status.com/assets/img/content/${id}.jpg`,
    imageAltDesc: `Alt text for ${guid}`,
  };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

function createMockClient(calls, options = {}) {
  return {
    async createImageContainer(params) {
      calls.containers.push(params);

      if (options.containerError) {
        throw options.containerError;
      }

      return { id: 'container-1' };
    },
    async getContainer(containerId) {
      calls.statuses.push(containerId);
      return { id: containerId, status: options.containerStatus || 'FINISHED' };
    },
    async publishContainer(containerId) {
      calls.publications.push(containerId);

      if (options.publishError) {
        throw options.publishError;
      }

      return { id: 'thread-1' };
    },
    async getThread(threadId) {
      calls.lookups.push(threadId);

      if (options.lookupError) {
        throw options.lookupError;
      }

      return { id: threadId, permalink: 'https://www.threads.com/@maxx/post/test' };
    },
  };
}

async function testHttpClientPublishesImage() {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });

    if (url.pathname === '/me/threads') {
      return jsonResponse(200, { id: 'container-1' });
    }

    if (url.pathname === '/me/threads_publish') {
      return jsonResponse(200, { id: 'thread-1' });
    }

    if (url.pathname === '/container-1') {
      return jsonResponse(200, { id: 'container-1', status: 'FINISHED' });
    }

    return jsonResponse(200, {
      id: 'thread-1',
      permalink: 'https://www.threads.com/@maxx/post/test',
    });
  };
  const topPost = post();
  const result = await publishLatestDirect({
    data: { posts: [topPost] },
    accessToken: 'test-token',
    apiBase: 'https://threads.example',
    fetchImpl,
    sourceBaseUrl: 'https://deploy.example',
  });

  assert.equal(result.action, 'published');
  assert.equal(result.threadsPostId, 'thread-1');
  assert.equal(result.threadsUrl, 'https://www.threads.com/@maxx/post/test');
  assert.equal(requests.length, 4);
  assert.equal(requests[0].url.pathname, '/me/threads');
  assert.equal(requests[0].url.searchParams.get('media_type'), 'IMAGE');
  assert.equal(requests[0].url.searchParams.get('text'), STATUS_TEXT);
  assert.equal(
    requests[0].url.searchParams.get('image_url'),
    'https://deploy.example/assets/img/content/20260529T0737.jpg'
  );
  assert.equal(requests[0].url.searchParams.get('alt_text'), topPost.imageAltDesc);
  assert.equal(requests[0].options.headers.authorization, 'Bearer test-token');
  assert.equal(requests[1].url.pathname, '/container-1');
  assert.equal(requests[1].url.searchParams.get('fields'), 'id,status,error_message');
  assert.equal(requests[2].url.searchParams.get('creation_id'), 'container-1');
  assert.equal(requests[3].url.searchParams.get('fields'), 'id,permalink');
}

async function testApiErrorsDoNotExposeToken() {
  const client = createThreadsClient({
    accessToken: 'super-secret-token',
    fetchImpl: async () =>
      jsonResponse(400, {
        error: {
          message: 'Invalid image URL',
          code: 100,
        },
      }),
  });

  await assert.rejects(
    client.createImageContainer({ text: STATUS_TEXT, imageUrl: 'https://example.com/image.jpg', altText: '' }),
    (error) => {
      assert.equal(error.code, 'threads_api_failed');
      assert.equal(error.details.status, 400);
      assert.equal(error.message, 'Invalid image URL');
      assert.equal(JSON.stringify(error).includes('super-secret-token'), false);
      return true;
    }
  );
}

async function testBlobPublishAndNoop() {
  const store = new MemoryStore();
  const calls = { containers: [], statuses: [], publications: [], lookups: [] };
  const topPost = post();
  const options = {
    data: { posts: [topPost] },
    store,
    onlyTop: true,
    threadsClient: createMockClient(calls),
    sourceBaseUrl: 'https://deploy.example',
    commitRef: 'abc123',
    source: 'test',
    now: new Date('2026-05-29T12:00:00Z'),
  };

  const published = await publishLatest(options);
  const noop = await publishLatest(options);
  const record = await store.get(postKey(topPost.guid));

  assert.equal(published.action, 'published');
  assert.equal(published.threadsContainerId, 'container-1');
  assert.equal(published.threadsPostId, 'thread-1');
  assert.equal(record.status, 'published');
  assert.equal(record.commitRef, 'abc123');
  assert.equal(noop.action, 'noop');
  assert.equal(noop.reason, 'already_recorded');
  assert.equal(calls.containers.length, 1);
  assert.deepEqual(calls.containers[0], {
    text: STATUS_TEXT,
    imageUrl: 'https://deploy.example/assets/img/content/20260529T0737.jpg',
    altText: topPost.imageAltDesc,
  });
}

async function testFailedPublishReleasesClaim() {
  const store = new MemoryStore();
  const calls = { containers: [], statuses: [], publications: [], lookups: [] };
  const topPost = post();

  await assert.rejects(
    publishLatest({
      data: { posts: [topPost] },
      store,
      onlyTop: true,
      threadsClient: createMockClient(calls, { publishError: new Error('publish failed') }),
    }),
    /publish failed/
  );

  assert.equal(await store.get(postKey(topPost.guid)), null);
}

async function testContainerPollingWaitsUntilFinished() {
  const statuses = ['IN_PROGRESS', 'IN_PROGRESS', 'FINISHED'];
  const delays = [];
  const result = await waitForContainer(
    {
      getContainer: async (containerId) => ({
        id: containerId,
        status: statuses.shift(),
      }),
    },
    'container-1',
    {
      containerPollAttempts: 3,
      containerPollIntervalMs: 25,
      delayImpl: async (milliseconds) => delays.push(milliseconds),
    }
  );

  assert.equal(result.status, 'FINISHED');
  assert.deepEqual(delays, [25, 25]);
}

async function testContainerErrorStopsBeforePublish() {
  const calls = { containers: [], statuses: [], publications: [], lookups: [] };
  const topPost = post();

  await assert.rejects(
    publishLatestDirect({
      data: { posts: [topPost] },
      threadsClient: createMockClient(calls, { containerStatus: 'ERROR' }),
    }),
    (error) => error.code === 'threads_container_failed'
  );

  assert.equal(calls.publications.length, 0);
}

async function testLookupFailureStillRecordsPublishedPost() {
  const store = new MemoryStore();
  const calls = { containers: [], statuses: [], publications: [], lookups: [] };
  const topPost = post();
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);

  try {
    const result = await publishLatest({
      data: { posts: [topPost] },
      store,
      onlyTop: true,
      threadsClient: createMockClient(calls, { lookupError: new Error('lookup unavailable') }),
    });
    const record = await store.get(postKey(topPost.guid));

    assert.equal(result.action, 'published');
    assert.equal(result.threadsPostId, 'thread-1');
    assert.equal(result.threadsUrl, null);
    assert.equal(record.status, 'published');
    assert.match(warnings[0], /lookup unavailable/);
  } finally {
    console.warn = originalWarn;
  }
}

async function testRecordConflictPreservesClaim() {
  const store = new MemoryStore();
  const originalSetJSON = store.setJSON.bind(store);
  const calls = { containers: [], statuses: [], publications: [], lookups: [] };
  const topPost = post();

  store.setJSON = async (key, value, options) => {
    if (key === postKey(topPost.guid) && value.status === 'published') {
      return { modified: false };
    }

    return originalSetJSON(key, value, options);
  };

  await assert.rejects(
    publishLatest({
      data: { posts: [topPost] },
      store,
      onlyTop: true,
      threadsClient: createMockClient(calls),
    }),
    (error) => error.code === 'publish_record_conflict'
  );

  assert.equal((await store.get(postKey(topPost.guid))).status, 'publishing');
  assert.equal(calls.publications.length, 1);
}

async function testMissingToken() {
  const previousToken = process.env.THREADS_ACCESS_TOKEN;
  delete process.env.THREADS_ACCESS_TOKEN;

  try {
    assert.throws(
      () => createThreadsClient({ fetchImpl: async () => jsonResponse(200, {}) }),
      (error) => error.code === 'missing_threads_environment'
    );
  } finally {
    if (previousToken === undefined) {
      delete process.env.THREADS_ACCESS_TOKEN;
    } else {
      process.env.THREADS_ACCESS_TOKEN = previousToken;
    }
  }
}

(async function main() {
  await testHttpClientPublishesImage();
  await testApiErrorsDoNotExposeToken();
  await testBlobPublishAndNoop();
  await testFailedPublishReleasesClaim();
  await testContainerPollingWaitsUntilFinished();
  await testContainerErrorStopsBeforePublish();
  await testLookupFailureStillRecordsPublishedPost();
  await testRecordConflictPreservesClaim();
  await testMissingToken();
  console.log('Threads publisher tests passed.');
})();
