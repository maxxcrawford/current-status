const assert = require('assert/strict');

const {
  MultipleUnpostedPostsError,
  STATUS_TEXT,
  postKey,
  publishLatest,
  seedExistingPosts,
} = require('../../lib/mastodon-publisher');

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

function post(guid) {
  const id = guid.replace(/^#/, '');

  return {
    guid,
    image: `https://current-status.com/assets/img/content/${id}.jpg`,
    imageAltDesc: `Alt text for ${guid}`,
  };
}

function createMastodonClient(calls) {
  return {
    v2: {
      media: {
        create: async (params) => {
          calls.media.push(params);
          return { id: 'media-1' };
        },
      },
    },
    v1: {
      statuses: {
        create: async (params) => {
          calls.statuses.push(params);
          return { id: 'status-1', url: 'https://mastodon.example/@maxx/1' };
        },
      },
    },
  };
}

function createFetch(calls) {
  return async (url) => {
    calls.fetches.push(url);

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () => new Blob(['image'], { type: 'image/jpeg' }),
    };
  };
}

async function testAlreadyRecordedNoops() {
  const store = new MemoryStore();
  const topPost = post('#20260523T0902');
  const calls = { fetches: [], media: [], statuses: [] };

  await store.setJSON(postKey(topPost.guid), {
    guid: topPost.guid,
    status: 'published',
    mastodonUrl: 'https://mastodon.example/@maxx/old',
  });

  const result = await publishLatest({
    data: { posts: [topPost] },
    store,
    mastodonClient: createMastodonClient(calls),
    fetchImpl: createFetch(calls),
  });

  assert.equal(result.action, 'noop');
  assert.equal(result.reason, 'already_recorded');
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.media.length, 0);
  assert.equal(calls.statuses.length, 0);
}

async function testPublishesSingleUnpostedTopPost() {
  const store = new MemoryStore();
  const topPost = post('#20260523T0902');
  const previousPost = post('#20260505T1842');
  const calls = { fetches: [], media: [], statuses: [] };

  await store.setJSON(postKey(previousPost.guid), {
    guid: previousPost.guid,
    status: 'seeded',
  });

  const result = await publishLatest({
    data: { posts: [topPost, previousPost] },
    store,
    mastodonClient: createMastodonClient(calls),
    fetchImpl: createFetch(calls),
    sourceBaseUrl: 'https://deploy.example',
    commitRef: 'abc123',
    source: 'test',
    now: new Date('2026-05-27T12:00:00Z'),
  });

  const record = await store.get(postKey(topPost.guid));

  assert.equal(result.action, 'published');
  assert.equal(result.mastodonUrl, 'https://mastodon.example/@maxx/1');
  assert.equal(record.status, 'published');
  assert.equal(record.commitRef, 'abc123');
  assert.equal(calls.fetches[0], 'https://deploy.example/assets/img/content/20260523T0902.jpg');
  assert.equal(calls.media[0].description, topPost.imageAltDesc);
  assert.deepEqual(calls.statuses[0], {
    status: STATUS_TEXT,
    visibility: 'public',
    mediaIds: ['media-1'],
  });
}

async function testMultipleUnpostedFailsBeforePublish() {
  const store = new MemoryStore();
  const calls = { fetches: [], media: [], statuses: [] };

  await assert.rejects(
    publishLatest({
      data: { posts: [post('#20260523T0902'), post('#20260505T1842')] },
      store,
      mastodonClient: createMastodonClient(calls),
      fetchImpl: createFetch(calls),
    }),
    MultipleUnpostedPostsError
  );

  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.media.length, 0);
  assert.equal(calls.statuses.length, 0);
}

async function testSeedExistingPosts() {
  const store = new MemoryStore();
  const posts = [post('#20260523T0902'), post('#20260505T1842')];

  const firstRun = await seedExistingPosts({
    data: { posts },
    store,
    now: new Date('2026-05-27T12:00:00Z'),
  });
  const secondRun = await seedExistingPosts({
    data: { posts },
    store,
    now: new Date('2026-05-27T12:00:00Z'),
  });

  assert.deepEqual(firstRun, {
    action: 'seeded',
    seeded: 2,
    skipped: 0,
    total: 2,
    availableTotal: 2,
  });
  assert.deepEqual(secondRun, {
    action: 'seeded',
    seeded: 0,
    skipped: 2,
    total: 2,
    availableTotal: 2,
  });
}

async function testSeedTopPostOnly() {
  const store = new MemoryStore();
  const posts = [post('#20260523T0902'), post('#20260505T1842')];

  const result = await seedExistingPosts({
    data: { posts },
    store,
    onlyTop: true,
    now: new Date('2026-05-27T12:00:00Z'),
  });

  assert.deepEqual(result, {
    action: 'seeded',
    seeded: 1,
    skipped: 0,
    total: 1,
    availableTotal: 2,
  });
  assert.ok(await store.get(postKey(posts[0].guid)));
  assert.equal(await store.get(postKey(posts[1].guid)), null);
}

(async function main() {
  await testAlreadyRecordedNoops();
  await testPublishesSingleUnpostedTopPost();
  await testMultipleUnpostedFailsBeforePublish();
  await testSeedExistingPosts();
  await testSeedTopPostOnly();
  console.log('masto publisher tests passed.');
})();
