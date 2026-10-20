const assert = require('assert/strict');
const Fs = require('fs');
const Os = require('os');
const Path = require('path');

const {
  commonRatiosFromPosts,
  createPostFromIssue,
  extractImageUrl,
  fullTimeForDate,
  issueTitleForDate,
  normalizeColor,
  postIdForDate,
  ratioTokenFromDimensions,
  ratioTokenFromOverride,
} = require('./create-post-from-issue');

const jpegFixture = Path.resolve(__dirname, '../img/content/20260529T0737.jpg');
const gifFixture = Path.resolve(__dirname, '../img/content/20210112T0304.gif');
const { imageSize } = require('../../lib/image-size');

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
  assert.equal(result.issueTitle, 'Post : May 30 2026, 2:35 PM');
  assert.equal(result.assetPath.endsWith('assets/img/content/20260530T1435.webp'), true);
  assert.equal(Fs.existsSync(Path.join(assetDir, '20260530T1435.webp')), true);
  assert.equal(result.sourceExtension, 'jpg');
  assert.equal(result.optimized, 'true');
  assert.equal(data.posts[0].guid, '#20260530T1435');
  assert.equal(data.posts[0].fullTime, '2:35 PM • May 30, 2026');
  assert.equal(data.posts[0].image, 'https://current-status.com/assets/img/content/20260530T1435.webp');
  assert.equal(data.posts[0].displayImage, 'assets/img/content/20260530T1435.webp');
  assert.equal(
    data.posts[0].socialImage,
    'https://github.com/user-attachments/assets/example-image'
  );
  assert.equal(imageSize(Fs.readFileSync(Path.join(assetDir, '20260530T1435.webp'))).width <= 900, true);
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
  assert.equal('socialImage' in data.posts[0], false);
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
          backgroundColor: '#000000',
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
  assert.equal(issueTitleForDate(new Date('2026-05-30T05:15:00Z')), 'Post : May 30 2026, 12:15 AM');
  for (const color of ['FFFFFF', '#FFFFFF', 'ffffff', '#ffffff', ' FfFfFf ']) {
    assert.equal(normalizeColor(color), '#FFFFFF');
  }
  assert.equal(normalizeColor('b02010'), '#B02010');
  assert.equal(normalizeColor('#b02010'), '#B02010');
  for (const color of ['', '#abc', 'abc', 'FFFFF', '#FFFFFFF', 'GGGGGG', '##FFFFFF', 'FF FF FF']) {
    assert.throws(() => normalizeColor(color), /Background color must be a hex color with exactly six digits/);
  }
  assert.equal(extractImageUrl('[download](https://example.com/image.png)'), 'https://example.com/image.png');
  assert.equal(ratioTokenFromDimensions(1920, 1080), '9-16');
  assert.equal(ratioTokenFromOverride('16:9'), '9-16');
}

async function testUsesExistingRatiosForDetection() {
  const dir = tempDir();
  const dataPath = writeData(dir, [
    { ratio: '100-249' },
    { ratio: '100-249' },
    { ratio: '2-5' },
  ]);
  const result = await createPostFromIssue({
    event: event(issueBody({
      imageSource: 'https://example.com/status.gif',
      altText: 'Animated image',
      backgroundColor: '000000',
    })),
    dataPath,
    assetDir: Path.join(dir, 'assets/img/content'),
    now: new Date('2026-05-30T19:35:00Z'),
    fetchImpl: fetchFile(gifFixture, 'image/gif'),
  });
  // The image is exactly 5:2, but only the repeated 249:100 is eligible.
  assert.equal(result.ratio, '100-249');
  assert.equal(JSON.parse(Fs.readFileSync(dataPath, 'utf8')).posts[0].ratio, '100-249');
}

function testRatioNormalization() {
  const commonRatios = commonRatiosFromPosts([
    ...['1-1', '2-3', '3-2', '5-4', '5-9', '9-5', '5-8', '1-2', '13-32']
      .flatMap(ratio => [{ ratio }, { ratio }]),
    { ratio: '8-5' },
    { ratio: '' },
    { ratio: 'invalid' },
    { ratio: '0-1' },
  ]);
  assert.equal(commonRatios.length, 9);
  assert.deepEqual(commonRatiosFromPosts([{ ratio: '2-3' }, { ratio: '4-6' }]), [[3, 2]]);
  assert.deepEqual(commonRatiosFromPosts([{ ratio: '1-1' }, { ratio: '' }]), []);
  const cases = [
    [1001, 1000, '1-1'],
    [1201, 800, '2-3'],
    [800, 1201, '3-2'],
    [801, 1000, '5-4'],
    [1599, 900, '5-9'],
    [900, 1599, '9-5'],
    [1599, 1000, '5-8'],
    [1999, 1000, '1-2'],
    [2332, 1000, '250-583'],
    [2459, 1000, '13-32'],
    [1000, 1601, '1601-1000'],
    [1050, 1000, '1-1'],
    [1000, 1050, '1-1'],
    [1051, 1000, '1000-1051'],
    [1000, 1051, '1051-1000'],
    [1100, 1000, '10-11'],
  ];
  for (const [width, height, expected] of cases) {
    assert.equal(ratioTokenFromDimensions(width, height, { commonRatios }), expected, `${width} x ${height}`);
  }
  assert.equal(ratioTokenFromDimensions(1201, 800), '800-1201');
  assert.equal(ratioTokenFromOverride('1201:800'), '800-1201');
  assert.equal(ratioTokenFromOverride('1001-1000'), '1000-1001');
  assert.equal(ratioTokenFromOverride(''), '');
  for (const [width, height] of [[0, 100], [100, -1], [1.5, 100], [NaN, 100]]) {
    assert.throws(() => ratioTokenFromDimensions(width, height), /Ratio dimensions must be/);
  }
}

(async function main() {
  testHelpers();
  testRatioNormalization();
  await testUsesExistingRatiosForDetection();
  await testCreatesPostFromAttachment();
  await testDownloadsGifUrlAndUsesRatioOverride();
  await testUnauthorizedAuthorIsIgnored();
  await testInvalidColorFails();
  await testPostCollisionFailsBeforeWritingAsset();
  console.log('status post issue tests passed.');
})();
