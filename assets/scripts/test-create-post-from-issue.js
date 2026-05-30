const assert = require('assert/strict');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const {
  createPostFromIssue,
  extractImageUrl,
  fullTimeForDate,
  normalizeColor,
  postIdForDate,
  ratioTokenFromDimensions,
  ratioTokenFromOverride,
} = require('./create-post-from-issue');

const jpegFixture = Path.resolve(__dirname, '../img/content/20260529T0737.jpg');
const gifFixture = Path.resolve(__dirname, '../img/content/20210112T0304.gif');

function tempDir() {
  return Fs.mkdtempSync(Path.join(Os.tmpdir(), 'current-status-post-test-'));
}

function writeData(dir, posts = []) {
  const dataPath = Path.join(dir, 'data.json');
  Fs.writeFileSync(dataPath, `${JSON.stringify({ posts }, null, 2)}\n`);
  return dataPath;
}

function issueBody({ imageSource, altText, backgroundColor, ratioOverride = '' }) {
  return `### Image source

${imageSource}

### Alt text

${altText}

### Background color

${backgroundColor}

### Ratio override

${ratioOverride || '_No response_'}`;
}

function event(body, options = {}) {
  return {
    issue: {
      number: 123,
      body,
      labels: options.labels || [{ name: 'status-post' }],
      user: {
        login: options.author || 'maxxcrawford',
      },
    },
  };
}

function fetchFile(filePath, contentType) {
  return async () => {
    const buffer = Fs.readFileSync(filePath);

    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: {
        get: (name) => (name.toLowerCase() === 'content-type' ? contentType : ''),
      },
      arrayBuffer: async () =>
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
    };
  };
}

async function testCreatesPostFromAttachment() {
  const dir = tempDir();
  const assetDir = Path.join(dir, 'assets/img/content');
  const dataPath = writeData(dir, [
    {
      guid: '#20260529T0737',
      image: 'https://current-status.com/assets/img/content/20260529T0737.jpg',
      displayImage: 'assets/img/content/20260529T0737.jpg',
      imageAltDesc: 'Existing post',
      ratio: '4-5',
      color: '#B02010',
    },
  ]);
  const now = new Date('2026-05-30T19:35:00Z');

  const result = await createPostFromIssue({
    event: event(
      issueBody({
        imageSource: '![Toy package](https://github.com/user-attachments/assets/example-image)',
        altText: 'Vintage toy package on a red and green background',
        backgroundColor: 'b02010',
      })
    ),
    dataPath,
    assetDir,
    now,
    fetchImpl: fetchFile(jpegFixture, 'image/jpeg'),
  });

  const data = JSON.parse(Fs.readFileSync(dataPath, 'utf8'));

  assert.equal(result.action, 'created');
  assert.equal(result.postId, '20260530T1435');
  assert.equal(result.assetPath.endsWith('assets/img/content/20260530T1435.jpg'), true);
  assert.equal(Fs.existsSync(Path.join(assetDir, '20260530T1435.jpg')), true);
  assert.equal(data.posts[0].guid, '#20260530T1435');
  assert.equal(data.posts[0].fullTime, '2:35 PM • May 30, 2026');
  assert.equal(data.posts[0].image, 'https://current-status.com/assets/img/content/20260530T1435.jpg');
  assert.equal(data.posts[0].displayImage, 'assets/img/content/20260530T1435.jpg');
  assert.equal(data.posts[0].imageAltDesc, 'Vintage toy package on a red and green background');
  assert.equal(data.posts[0].ratio, '43-50');
  assert.equal(data.posts[0].color, '#B02010');
}

async function testDownloadsGifUrlAndUsesRatioOverride() {
  const dir = tempDir();
  const assetDir = Path.join(dir, 'assets/img/content');
  const dataPath = writeData(dir);

  const result = await createPostFromIssue({
    event: event(
      issueBody({
        imageSource: 'https://example.com/status.gif',
        altText: 'Animated GIF of a scene from a movie',
        backgroundColor: '#0d293b',
        ratioOverride: '4-5',
      })
    ),
    dataPath,
    assetDir,
    now: new Date('2026-05-30T19:35:00Z'),
    fetchImpl: fetchFile(gifFixture, 'image/gif'),
  });
  const data = JSON.parse(Fs.readFileSync(dataPath, 'utf8'));

  assert.equal(result.action, 'created');
  assert.equal(result.ratio, '5-4');
  assert.equal(data.posts[0].displayImage, 'assets/img/content/20260530T1435.gif');
  assert.equal(data.posts[0].ratio, '5-4');
  assert.equal(Fs.existsSync(Path.join(assetDir, '20260530T1435.gif')), true);
}

async function testUnauthorizedAuthorIsIgnored() {
  const dir = tempDir();
  const assetDir = Path.join(dir, 'assets/img/content');
  const dataPath = writeData(dir);

  const result = await createPostFromIssue({
    event: event(
      issueBody({
        imageSource: 'https://example.com/status.gif',
        altText: 'Alt text',
        backgroundColor: '#000000',
      }),
      { author: 'someone-else' }
    ),
    dataPath,
    assetDir,
    now: new Date('2026-05-30T19:35:00Z'),
    fetchImpl: fetchFile(gifFixture, 'image/gif'),
  });
  const data = JSON.parse(Fs.readFileSync(dataPath, 'utf8'));

  assert.deepEqual(result, {
    action: 'ignored',
    reason: 'unauthorized_author',
    author: 'someone-else',
  });
  assert.deepEqual(data.posts, []);
  assert.equal(Fs.existsSync(assetDir), false);
}

async function testInvalidColorFails() {
  const dir = tempDir();
  const dataPath = writeData(dir);

  await assert.rejects(
    createPostFromIssue({
      event: event(
        issueBody({
          imageSource: 'https://example.com/status.gif',
          altText: 'Alt text',
          backgroundColor: 'blue',
        })
      ),
      dataPath,
      assetDir: Path.join(dir, 'assets/img/content'),
      now: new Date('2026-05-30T19:35:00Z'),
      fetchImpl: fetchFile(gifFixture, 'image/gif'),
    }),
    /Background color must be a hex color/
  );
}

async function testPostCollisionFailsBeforeWritingAsset() {
  const dir = tempDir();
  const assetDir = Path.join(dir, 'assets/img/content');
  const dataPath = writeData(dir, [{ guid: '#20260530T1435' }]);

  await assert.rejects(
    createPostFromIssue({
      event: event(
        issueBody({
          imageSource: 'https://example.com/status.gif',
          altText: 'Alt text',
          backgroundColor: '#000',
        })
      ),
      dataPath,
      assetDir,
      now: new Date('2026-05-30T19:35:00Z'),
      fetchImpl: fetchFile(gifFixture, 'image/gif'),
    }),
    /already exists in data\.json/
  );

  assert.equal(Fs.existsSync(assetDir), false);
}

function testHelpers() {
  assert.equal(postIdForDate(new Date('2026-05-30T05:15:00Z')), '20260530T0015');
  assert.equal(fullTimeForDate(new Date('2026-05-30T05:15:00Z')), '12:15 AM • May 30, 2026');
  assert.equal(normalizeColor('#abc'), '#AABBCC');
  assert.equal(extractImageUrl('[download](https://example.com/image.png)'), 'https://example.com/image.png');
  assert.equal(ratioTokenFromDimensions(1920, 1080), '9-16');
  assert.equal(ratioTokenFromOverride('16:9'), '9-16');
}

(async function main() {
  testHelpers();
  await testCreatesPostFromAttachment();
  await testDownloadsGifUrlAndUsesRatioOverride();
  await testUnauthorizedAuthorIsIgnored();
  await testInvalidColorFails();
  await testPostCollisionFailsBeforeWritingAsset();
  console.log('status post issue tests passed.');
})();
