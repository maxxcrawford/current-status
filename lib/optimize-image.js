const { execFileSync } = require('child_process');

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
    `${target}:-`,
  ];

  let lastError = 'No ImageMagick binary found.';

  for (const binary of candidates) {
    try {
      const output = execFileSync(binary, args, { input: buffer, maxBuffer: 256 * 1024 * 1024 });

      if (!output || output.length === 0) {
        throw new Error(`${binary} produced no output.`);
      }

      return { buffer: output, extension: target, optimized: true };
    } catch (error) {
      lastError = error.message;
    }
  }

  // ponytail: a missing or failing encoder must not block the post. Store the
  // original and let the next optimize-images.sh run pick it up.
  return { buffer, extension, optimized: false, error: lastError };
}

module.exports = { optimizeImage, MAX_WIDTH, QUALITY, TARGET_EXTENSION };
