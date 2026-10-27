const { execFileSync } = require('child_process');
const { imageSize } = require('./image-size');

const MAX_WIDTH = 900;
const QUALITY = 75;

// jpg/webp -> webp (smallest for photos), png -> avif (smallest for screenshots,
// and keeps alpha), gif -> untouched so animation survives.
const TARGET_EXTENSION = {
  jpg: 'webp',
  jpeg: 'webp',
  webp: 'webp',
  png: 'avif',
  avif: 'avif',
};

function optimizeImage(buffer, extension, options = {}) {
  const target = TARGET_EXTENSION[String(extension).toLowerCase()];

  if (!target) {
    return { buffer, extension, optimized: false };
  }

  // ImageMagick 7 ships `magick`, 6 ships `convert`; GitHub runners have varied.
  const candidates = options.magickPath || process.env.MAGICK_PATH
    ? [options.magickPath || process.env.MAGICK_PATH]
    : ['magick', 'convert'];
  const args = [
    '-',
    '-strip',
    '-resize',
    `${options.maxWidth || MAX_WIDTH}>`,
    '-quality',
    String(options.quality || QUALITY),
  ];

  let lastError = 'No ImageMagick binary found.';

  // Some ImageMagick builds silently return PNG for an unsupported AVIF encoder.
  // Verify the bytes, and fall back to WebP when AVIF cannot actually be written.
  const formats = target === 'avif' ? ['avif', 'webp'] : [target];
  const encode = options.execFileSync || execFileSync;
  for (const format of formats) {
    for (const binary of candidates) {
      try {
        const output = encode(binary, [...args, `${format}:-`], { input: buffer, maxBuffer: 256 * 1024 * 1024 });

        if (!output || output.length === 0) {
          throw new Error(`${binary} produced no output.`);
        }

        const dimensions = imageSize(output);
        if (dimensions.type !== format || dimensions.width > (options.maxWidth || MAX_WIDTH)) {
          throw new Error(`${binary} did not produce a valid ${format.toUpperCase()} within the width limit.`);
        }
        return { buffer: output, extension: format, optimized: true };
      } catch (error) {
        lastError = error.message;
      }
    }
  }

  // A missing or failing encoder must not block the post. Keep the original
  // format rather than giving unconverted bytes the requested output extension.
  return { buffer, extension, optimized: false, error: lastError };
}

module.exports = { optimizeImage, MAX_WIDTH, QUALITY, TARGET_EXTENSION };
