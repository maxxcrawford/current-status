const Fs = require('fs');
const { execFileSync } = require('child_process');
const { imageSize } = require('./image-size');
const { CURRENT_STATUS_ORIGIN, PublishError, localImagePath } = require('./publisher-common');

const STORE_NAME = 'threads-images';
const MAX_BYTES = 3 * 1024 * 1024;

function imageKey(guid) {
  const id = String(guid || '').replace(/^#/, '');
  if (!/^\d{8}T\d{4}$/.test(id)) {
    throw new PublishError('Invalid Threads image post ID.', 'invalid_threads_image', 400);
  }
  return `${id}.jpg`;
}

function needsJpeg(post) {
  return !/\.(jpe?g|png)$/i.test(new URL(post.image, CURRENT_STATUS_ORIGIN).pathname);
}

function temporaryImageUrl(post, sourceBaseUrl = CURRENT_STATUS_ORIGIN) {
  imageKey(post.guid);
  const url = new URL('/.netlify/functions/threads-image', sourceBaseUrl);
  url.searchParams.set('post', post.guid.replace(/^#/, ''));
  return url.toString();
}

function validateJpeg(buffer) {
  const dimensions = imageSize(buffer);
  if (dimensions.type !== 'jpg' || buffer.length > MAX_BYTES || dimensions.width > 900) {
    throw new PublishError('Threads image must be a JPEG up to 900px wide and 3 MiB.', 'invalid_threads_image', 400);
  }
  return buffer;
}

function generateJpeg(post, options = {}) {
  const filePath = options.filePath || localImagePath(post);
  if (!filePath) {
    throw new Error('The local status image is required to generate a Threads JPEG.');
  }
  const input = Fs.readFileSync(filePath);
  const encode = options.execFileSync || execFileSync;
  const binaries = process.env.MAGICK_PATH ? [process.env.MAGICK_PATH] : ['magick', 'convert'];
  let lastError;
  for (const binary of binaries) {
    try {
      // Read one frame so GIF inputs produce a single static JPEG.
      return validateJpeg(encode(binary, [
        '-[0]', '-auto-orient', '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
        '-colorspace', 'sRGB', '-strip', '-resize', '900>', '-quality', '85', 'jpg:-',
      ], { input, maxBuffer: 32 * 1024 * 1024 }));
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Could not generate the Threads JPEG: ${lastError.message}`);
}

async function imageRequest(url, method, options = {}) {
  const secret = options.secret || process.env.PUBLISH_SECRET;
  if (!secret) throw new Error('PUBLISH_SECRET is required to stage or delete a temporary Threads image.');
  const response = await (options.fetchImpl || globalThis.fetch)(url, {
    method,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'image/jpeg' },
    ...(options.buffer ? { body: options.buffer } : {}),
  });
  if (!response.ok) throw new Error(`Temporary Threads image ${method} failed with HTTP ${response.status}.`);
}

async function stageThreadsImage(post, options = {}) {
  if (!needsJpeg(post)) return null;
  const url = temporaryImageUrl(post, options.sourceBaseUrl);
  const buffer = generateJpeg(post, options);
  await imageRequest(url, 'POST', { ...options, buffer });
  return url;
}

async function deleteThreadsImage(url, options = {}) {
  await imageRequest(url, 'DELETE', options);
}

module.exports = {
  STORE_NAME, MAX_BYTES, imageKey, needsJpeg, temporaryImageUrl,
  validateJpeg, generateJpeg, stageThreadsImage, deleteThreadsImage,
};
