function assertDimensions(width, height, type) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid ${type.toUpperCase()} image dimensions.`);
  }

  return { width, height, type };
}

function pngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return null;
  }

  return assertDimensions(buffer.readUInt32BE(16), buffer.readUInt32BE(20), 'png');
}

function gifSize(buffer) {
  if (buffer.length < 10 || !/^GIF8[79]a$/.test(buffer.toString('ascii', 0, 6))) {
    return null;
  }

  return assertDimensions(buffer.readUInt16LE(6), buffer.readUInt16LE(8), 'gif');
}

function jpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  const startOfFrameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3,
    0xc5, 0xc6, 0xc7,
    0xc9, 0xca, 0xcb,
    0xcd, 0xce, 0xcf,
  ]);
  let offset = 2;

  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] === 0xff) {
      offset += 1;
    }

    if (offset >= buffer.length) {
      break;
    }

    const marker = buffer[offset];
    offset += 1;

    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }

    if (marker === 0xd9 || marker === 0xda || offset + 2 > buffer.length) {
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) {
      throw new Error('Invalid JPEG segment length.');
    }

    if (startOfFrameMarkers.has(marker)) {
      if (segmentLength < 7) {
        throw new Error('Invalid JPEG start-of-frame segment.');
      }

      return assertDimensions(
        buffer.readUInt16BE(offset + 5),
        buffer.readUInt16BE(offset + 3),
        'jpg'
      );
    }

    offset += segmentLength;
  }

  throw new Error('Could not find JPEG dimensions.');
}

function readUInt24LE(buffer, offset) {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function webpSize(buffer) {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength;

    if (chunkEnd > buffer.length) {
      throw new Error('Invalid WebP chunk length.');
    }

    if (chunkType === 'VP8X' && chunkLength >= 10) {
      return assertDimensions(
        readUInt24LE(buffer, dataOffset + 4) + 1,
        readUInt24LE(buffer, dataOffset + 7) + 1,
        'webp'
      );
    }

    if (chunkType === 'VP8 ' && chunkLength >= 10) {
      if (buffer[dataOffset + 3] !== 0x9d || buffer[dataOffset + 4] !== 0x01 || buffer[dataOffset + 5] !== 0x2a) {
        throw new Error('Invalid lossy WebP frame header.');
      }

      return assertDimensions(
        buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
        'webp'
      );
    }

    if (chunkType === 'VP8L' && chunkLength >= 5) {
      if (buffer[dataOffset] !== 0x2f) {
        throw new Error('Invalid lossless WebP frame header.');
      }

      const bits = buffer.readUInt32LE(dataOffset + 1);
      return assertDimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1, 'webp');
    }

    offset = chunkEnd + (chunkLength % 2);
  }

  throw new Error('Could not find WebP dimensions.');
}

function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new TypeError('Expected an image buffer.');
  }

  const dimensions = pngSize(buffer) || gifSize(buffer) || jpegSize(buffer) || webpSize(buffer);
  if (!dimensions) {
    throw new Error('Unsupported image format. Expected PNG, JPEG, GIF, or WebP.');
  }

  return dimensions;
}

module.exports = { imageSize };
