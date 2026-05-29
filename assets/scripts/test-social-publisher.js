const assert = require('assert/strict');
const Fs = require('fs');

const {
  STATUS_TEXT,
  postKey,
  publishLatest: publishBlueskyLatest,
  publishLatestDirect: publishBlueskyLatestDirect,
} = require('../../lib/bluesky-publisher');
const { publishLatestDirect: publishMastodonLatestDirect } = require('../../lib/mastodon-publisher');
const { publishAllLatest } = require('../../lib/social-publisher');

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

function post(guid, ratio = '4-5') {
  const id = guid.replace(/^#/, '');

  return {
    guid,
    image: `https://current-status.com/assets/img/content/${id}.jpg`,
    imageAltDesc: `Alt text for ${guid}`,
    ratio,
  };
}

function createFetch(calls) {
  return async (url) => {
    calls.fetches.push(url);

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      blob: async () =>
        new Blob([Fs.readFileSync('assets/img/content/20260529T0737.jpg')], { type: 'image/jpeg' }),
    };
  };
}

function createBlueskyClient(calls, options = {}) {
  return {
    uploadBlob: async (file, uploadOptions) => {
      calls.uploads.push({ file, options: uploadOptions });

      if (options.uploadError) {
        throw options.uploadError;
      }

      return {
        data: {
          blob: {
            $type: 'blob',
            ref: { $link: 'blob-cid-1' },
            mimeType: 'image/jpeg',
            size: 5,
          },
        },
      };
    },
    post: async (record) => {
      calls.posts.push(record);

      if (options.postError) {
        throw options.postError;
      }

      return {
        uri: 'at://did:plc:abc123/app.bsky.feed.post/3ktestpost',
        cid: 'post-cid-1',
      };
    },
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

async function testBlueskyPublishesTopPost() {
  const store = new MemoryStore();
  const calls = { fetches: [], uploads: [], posts: [] };
  const topPost = post('#20260529T0737');

  const result = await publishBlueskyLatest({
    data: { posts: [topPost] },
    store,
    onlyTop: true,
    blueskyClient: createBlueskyClient(calls),
    fetchImpl: createFetch(calls),
    sourceBaseUrl: 'https://deploy.example',
    identifier: 'maxx.example.com',
    commitRef: 'abc123',
    source: 'test',
    now: new Date('2026-05-29T12:00:00Z'),
  });

  const record = await store.get(postKey(topPost.guid));

  assert.equal(result.action, 'published');
  assert.equal(result.blueskyUri, 'at://did:plc:abc123/app.bsky.feed.post/3ktestpost');
  assert.equal(result.blueskyUrl, 'https://bsky.app/profile/maxx.example.com/post/3ktestpost');
  assert.equal(record.status, 'published');
  assert.equal(record.commitRef, 'abc123');
  assert.equal(calls.fetches[0], 'https://deploy.example/assets/img/content/20260529T0737.jpg');
  assert.equal(calls.uploads[0].options.encoding, 'image/jpeg');
  assert.deepEqual(calls.posts[0], {
    text: STATUS_TEXT,
    createdAt: '2026-05-29T12:00:00.000Z',
    embed: {
      $type: 'app.bsky.embed.images',
      images: [
        {
          image: {
            $type: 'blob',
            ref: { $link: 'blob-cid-1' },
            mimeType: 'image/jpeg',
            size: 5,
          },
          alt: topPost.imageAltDesc,
          aspectRatio: { width: 800, height: 688 },
        },
      ],
    },
  });
}

async function testBlueskyAlreadyRecordedNoops() {
  const store = new MemoryStore();
  const topPost = post('#20260529T0737');
  const calls = { fetches: [], uploads: [], posts: [] };

  await store.setJSON(postKey(topPost.guid), {
    guid: topPost.guid,
    status: 'published',
    blueskyUrl: 'https://bsky.app/profile/maxx.example.com/post/old',
  });

  const result = await publishBlueskyLatest({
    data: { posts: [topPost] },
    store,
    onlyTop: true,
    blueskyClient: createBlueskyClient(calls),
    fetchImpl: createFetch(calls),
  });

  assert.equal(result.action, 'noop');
  assert.equal(result.reason, 'already_recorded');
  assert.equal(calls.fetches.length, 0);
  assert.equal(calls.uploads.length, 0);
  assert.equal(calls.posts.length, 0);
}

async function testServiceStoresAreIndependent() {
  const mastodonStore = new MemoryStore();
  const blueskyStore = new MemoryStore();
  const topPost = post('#20260529T0737');
  const mastodonCalls = { fetches: [], media: [], statuses: [] };
  const blueskyCalls = { fetches: [], uploads: [], posts: [] };

  await mastodonStore.setJSON(postKey(topPost.guid), {
    guid: topPost.guid,
    status: 'published',
    mastodonUrl: 'https://mastodon.example/@maxx/old',
  });

  const result = await publishAllLatest({
    data: { posts: [topPost] },
    stores: {
      mastodon: mastodonStore,
      bluesky: blueskyStore,
    },
    onlyTop: true,
    mastodonClient: createMastodonClient(mastodonCalls),
    blueskyClient: createBlueskyClient(blueskyCalls),
    fetchImpl: createFetch(blueskyCalls),
    identifier: 'maxx.example.com',
    now: new Date('2026-05-29T12:00:00Z'),
  });

  assert.equal(result.action, 'published');
  assert.equal(result.services.mastodon.action, 'noop');
  assert.equal(result.services.bluesky.action, 'published');
  assert.equal(mastodonCalls.media.length, 0);
  assert.equal(mastodonCalls.statuses.length, 0);
  assert.equal(blueskyCalls.posts.length, 1);
  assert.equal((await blueskyStore.get(postKey(topPost.guid))).status, 'published');
}

async function testPublishAllAllowsPartialFailure() {
  const mastodonStore = new MemoryStore();
  const blueskyStore = new MemoryStore();
  const topPost = post('#20260529T0737');
  const mastodonCalls = { fetches: [], media: [], statuses: [] };
  const blueskyCalls = { fetches: [], uploads: [], posts: [] };

  const result = await publishAllLatest({
    data: { posts: [topPost] },
    stores: {
      mastodon: mastodonStore,
      bluesky: blueskyStore,
    },
    onlyTop: true,
    mastodonClient: createMastodonClient(mastodonCalls),
    blueskyClient: createBlueskyClient(blueskyCalls, { uploadError: new Error('upload failed') }),
    fetchImpl: createFetch(mastodonCalls),
    identifier: 'maxx.example.com',
    now: new Date('2026-05-29T12:00:00Z'),
  });

  assert.equal(result.action, 'partial_failed');
  assert.equal(result.published, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.services.mastodon.action, 'published');
  assert.equal(result.services.bluesky.action, 'failed');
  assert.equal(result.services.bluesky.message, 'upload failed');
  assert.equal((await mastodonStore.get(postKey(topPost.guid))).status, 'published');
  assert.equal(await blueskyStore.get(postKey(topPost.guid)), null);
}

async function testDirectLocalPublishersDoNotNeedStores() {
  const topPost = post('#20260529T0737');
  const mastodonCalls = { fetches: [], media: [], statuses: [] };
  const blueskyCalls = { fetches: [], uploads: [], posts: [] };

  const mastodonResult = await publishMastodonLatestDirect({
    data: { posts: [topPost] },
    mastodonClient: createMastodonClient(mastodonCalls),
    fetchImpl: createFetch(mastodonCalls),
  });
  const blueskyResult = await publishBlueskyLatestDirect({
    data: { posts: [topPost] },
    blueskyClient: createBlueskyClient(blueskyCalls),
    fetchImpl: createFetch(blueskyCalls),
    identifier: 'maxx.example.com',
  });

  assert.equal(mastodonResult.action, 'published');
  assert.equal(blueskyResult.action, 'published');
  assert.equal(mastodonCalls.statuses.length, 1);
  assert.equal(blueskyCalls.posts.length, 1);
}

(async function main() {
  await testBlueskyPublishesTopPost();
  await testBlueskyAlreadyRecordedNoops();
  await testServiceStoresAreIndependent();
  await testPublishAllAllowsPartialFailure();
  await testDirectLocalPublishersDoNotNeedStores();
  console.log('social publisher tests passed.');
})();
