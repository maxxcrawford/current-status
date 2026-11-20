const assert = require('assert/strict');
const { imageSize } = require('../../lib/image-size');
const { generateJpeg, stageThreadsImage, deleteThreadsImage } = require('../../lib/threads-image');
const { createHandler } = require('../../netlify/functions/threads-image');

async function main() {
  const post = {
    guid: '#20261116T1350',
    image: 'https://current-status.com/assets/img/content/20261116T1350.webp',
    displayImage: 'assets/img/content/20261116T1350.webp',
  };
  let jpeg;
  for (const filePath of [post.displayImage, 'assets/img/content/20261026T0921.avif', 'assets/img/content/20210112T0304.gif']) {
    jpeg = generateJpeg(post, { filePath });
    const dimensions = imageSize(jpeg);
    assert.equal(dimensions.type, 'jpg');
    assert.ok(dimensions.width <= 900);
    assert.ok(jpeg.length > 0);
  }
  assert.throws(() => generateJpeg(post, { execFileSync: () => Buffer.from('bad output') }), /Could not generate/);

  const entries = new Map();
  const handler = createHandler({
    secret: 'test-secret',
    store: {
      set: async (key, value) => entries.set(key, value),
      get: async key => entries.get(key) || null,
      delete: async key => entries.delete(key),
    },
  });
  const event = {
    httpMethod: 'POST', queryStringParameters: { post: '20261116T1350' },
    isBase64Encoded: true, body: jpeg.toString('base64'), headers: {},
  };
  assert.equal((await handler(event)).statusCode, 401);
  assert.equal((await handler({ ...event, httpMethod: 'DELETE' })).statusCode, 401);
  event.headers.authorization = 'Bearer test-secret';
  assert.equal((await handler({ ...event, queryStringParameters: { post: '../bad' } })).statusCode, 400);
  assert.equal((await handler({ ...event, body: Buffer.from('not jpeg').toString('base64') })).statusCode, 400);
  assert.equal(entries.size, 0);

  // Exercise staging, Meta's public GET, and cleanup through the real handlers.
  const fetchImpl = async (url, options) => {
    const result = await handler({
      httpMethod: options.method,
      queryStringParameters: Object.fromEntries(new URL(url).searchParams),
      headers: options.headers,
      isBase64Encoded: true,
      body: options.body?.toString('base64'),
    });
    return { ok: result.statusCode < 300, status: result.statusCode };
  };
  const url = await stageThreadsImage(post, { secret: 'test-secret', fetchImpl });
  const get = await handler({ ...event, httpMethod: 'GET', headers: {} });
  assert.equal(get.statusCode, 200);
  assert.equal(get.headers['content-type'], 'image/jpeg');
  assert.equal(get.headers['cache-control'], 'no-store');
  assert.equal(imageSize(Buffer.from(get.body, 'base64')).type, 'jpg');
  await deleteThreadsImage(url, { secret: 'test-secret', fetchImpl });
  assert.equal(entries.size, 0);
  assert.equal((await handler({ ...event, httpMethod: 'GET', headers: {} })).statusCode, 404);
  assert.equal(await stageThreadsImage({ ...post, image: 'https://current-status.com/test.png' }), null);
  console.log('Temporary Threads image tests passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
