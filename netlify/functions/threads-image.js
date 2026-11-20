const Crypto = require('crypto');
const { connectLambda } = require('@netlify/blobs');
const { resolveStore } = require('../../lib/publisher-common');
const { STORE_NAME, MAX_BYTES, imageKey, validateJpeg } = require('../../lib/threads-image');

function createHandler(options = {}) {
  return async (event) => {
    const headers = { 'cache-control': 'no-store' };
    const reply = (statusCode, body) => ({ statusCode, headers, body });
    const method = event.httpMethod;
    if (!['GET', 'POST', 'DELETE'].includes(method)) return reply(405, 'Use GET, POST, or DELETE.');

    // Meta must be able to read the image; creating/deleting it requires the publish secret.
    if (method !== 'GET') {
      const secret = options.secret || process.env.PUBLISH_SECRET;
      if (!secret) return reply(500, 'PUBLISH_SECRET is required.');
      const authorization = Object.entries(event.headers || {})
        .find(([name]) => name.toLowerCase() === 'authorization')?.[1] || '';
      const actual = Buffer.from(authorization);
      const expected = Buffer.from(`Bearer ${secret}`);
      if (actual.length !== expected.length || !Crypto.timingSafeEqual(actual, expected)) {
        return reply(401, 'Unauthorized.');
      }
    }

    let key;
    let buffer;
    try {
      key = imageKey(event.queryStringParameters?.post);
      if (method === 'POST') {
        if (!event.isBase64Encoded || !event.body || event.body.length > Math.ceil(MAX_BYTES / 3) * 4) {
          return reply(400, 'A JPEG binary body up to 3 MiB is required.');
        }
        buffer = validateJpeg(Buffer.from(event.body, 'base64'));
      }
    } catch (error) {
      return reply(400, 'Invalid Threads image or post ID.');
    }

    try {
      if (event.blobs) connectLambda(event);
      const store = await resolveStore(options.store, STORE_NAME);
      if (method === 'POST') {
        await store.set(key, buffer);
        return reply(201, 'Staged.');
      }
      if (method === 'DELETE') {
        await store.delete(key);
        return reply(204, '');
      }
      const image = await store.get(key, { type: 'arrayBuffer', consistency: 'strong' });
      if (!image) return reply(404, 'Image not found.');
      return {
        statusCode: 200,
        headers: { ...headers, 'content-type': 'image/jpeg', 'x-content-type-options': 'nosniff' },
        isBase64Encoded: true,
        body: Buffer.from(image).toString('base64'),
      };
    } catch (error) {
      console.error('Temporary Threads image storage failed.');
      return reply(500, 'Temporary image storage failed.');
    }
  };
}

exports.createHandler = createHandler;
exports.handler = createHandler();
