const assert = require('assert/strict');
const Fs = require('fs');
const { optimizeImage } = require('../../lib/optimize-image');
const { imageSize } = require('../../lib/image-size');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const webp = Fs.readFileSync('assets/img/content/20260623T2129.webp');

// Reproduce the production failure: encoder exits successfully but returns PNG for AVIF.
const fallback = optimizeImage(png, 'png', {
  execFileSync: (_binary, args) => args.at(-1) === 'avif:-' ? png : webp,
});
assert.equal(fallback.optimized, true);
assert.equal(fallback.extension, 'webp');
assert.equal(imageSize(fallback.buffer).type, 'webp');

// Never mark a mislabeled image, corrupt output, or an oversized image as optimized.
for (const output of [png, Buffer.from('not an image'), Buffer.alloc(0)]) {
  const result = optimizeImage(png, 'png', { execFileSync: () => output });
  assert.equal(result.optimized, false);
  assert.equal(result.extension, 'png');
  assert.equal(result.buffer, png);
  assert.ok(result.error);
}
const oversized = optimizeImage(png, 'png', { maxWidth: 1, execFileSync: () => webp });
assert.equal(oversized.optimized, false);

const missingEncoder = optimizeImage(png, 'png', {
  execFileSync: () => { throw new Error('Encoder unavailable'); },
});
assert.equal(missingEncoder.optimized, false);
assert.equal(missingEncoder.buffer, png);

const gif = Fs.readFileSync('assets/img/content/20210112T0304.gif');
const animated = optimizeImage(gif, 'gif', {
  execFileSync: () => { throw new Error('GIFs must not be re-encoded'); },
});
assert.equal(animated.buffer, gif);
assert.equal(animated.optimized, false);

// Also exercise the installed encoder with the image that revealed the regression.
const source = Fs.readFileSync('assets/img/content/20261026T0921.avif');
const encoded = optimizeImage(source, 'avif', { maxWidth: 450 });
assert.equal(encoded.optimized, true, encoded.error);
assert.equal(imageSize(encoded.buffer).type, encoded.extension);
assert.equal(imageSize(encoded.buffer).width, 450);

console.log('image optimization tests passed.');
