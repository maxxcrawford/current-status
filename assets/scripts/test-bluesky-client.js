const assert = require('assert/strict');
const { createBlueskyHttpClient } = require('../../lib/bluesky-client');

const credentials = {
  identifier: 'maxx.example.com',
  password: 'test-app-password',
  service: 'https://bsky.social',
};
const session = {
  did: 'did:plc:test',
  accessJwt: 'test-access-token',
  didDoc: { service: [{
    id: '#atproto_pds',
    type: 'AtprotoPersonalDataServer',
    serviceEndpoint: 'https://account.example.com',
  }] },
};
const blob = { $type: 'blob', ref: { $link: 'image-cid' }, mimeType: 'image/jpeg', size: 3 };
const result = { uri: 'at://did:plc:test/app.bsky.feed.post/post-id', cid: 'post-cid' };

function mockFetch(responses, calls = []) {
  return async (url, options) => {
    calls.push({ url: String(url), ...options });
    assert.ok(responses.length, 'Unexpected API request');
    return responses.shift();
  };
}
const json = data => new Response(JSON.stringify(data));

(async () => {
  const calls = [];
  const client = await createBlueskyHttpClient({ ...credentials,
    fetchImpl: mockFetch([json(session), json({ blob }), json(result)], calls),
  });
  const file = new Blob(['jpg'], { type: 'image/jpeg' });
  assert.deepEqual(await client.uploadBlob(file, { encoding: file.type }), { data: { blob } });
  const record = { text: 'current status:', createdAt: '2026-10-27T00:00:00Z',
    embed: { $type: 'app.bsky.embed.images', images: [{ image: blob, alt: 'Alt text', aspectRatio: { width: 4, height: 3 } }] } };
  assert.deepEqual(await client.post(record), result);
  assert.equal(calls[0].url, 'https://bsky.social/xrpc/com.atproto.server.createSession');
  assert.deepEqual(JSON.parse(calls[0].body), { identifier: credentials.identifier, password: credentials.password });
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[1].url, 'https://account.example.com/xrpc/com.atproto.repo.uploadBlob');
  assert.equal(calls[1].body, file);
  assert.equal(calls[1].headers['content-type'], 'image/jpeg');
  assert.equal(calls[2].url, 'https://account.example.com/xrpc/com.atproto.repo.createRecord');
  assert.deepEqual(JSON.parse(calls[2].body), {
    repo: session.did, collection: 'app.bsky.feed.post', record: { ...record, $type: 'app.bsky.feed.post' },
  });
  for (const call of calls.slice(1)) assert.equal(call.headers.authorization, `Bearer ${session.accessJwt}`);

  for (const response of [new Response('Unauthorized', { status: 401 }), new Response('invalid JSON'), json({})]) {
    await assert.rejects(createBlueskyHttpClient({ ...credentials, fetchImpl: mockFetch([response]) }),
      error => error.code === 'bluesky_api_failed' && !error.message.includes(credentials.password));
  }

  const fallbackCalls = [];
  const fallback = await createBlueskyHttpClient({ ...credentials,
    fetchImpl: mockFetch([json({ did: session.did, accessJwt: session.accessJwt }),
      new Response('Upload failed', { status: 500 }), json({})], fallbackCalls),
  });
  await assert.rejects(fallback.uploadBlob(file, { encoding: file.type }), /status 500/);
  assert.equal(fallbackCalls[1].url, 'https://bsky.social/xrpc/com.atproto.repo.uploadBlob');
  await assert.rejects(fallback.post(record), /no URI or CID/);
  console.log('Bluesky HTTP client tests passed.');
})();
