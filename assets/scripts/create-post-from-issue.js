const Fs = require('fs');
const Path = require('path');
const { imageSize } = require('image-size');

const rootDir = Path.resolve(__dirname, '../..');
const DEFAULT_DATA_PATH = Path.join(rootDir, 'data.json');
const DEFAULT_ASSET_DIR = Path.join(rootDir, 'assets/img/content');
const DEFAULT_TIME_ZONE = 'America/Chicago';
const DEFAULT_ALLOWED_AUTHORS = ['maxxcrawford'];
const CURRENT_STATUS_ORIGIN = 'https://current-status.com';
const STATUS_POST_LABEL = 'status-post';
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

class StatusPostIssueError extends Error {
  constructor(message, code, details = {}) {
    super(message);
    this.name = 'StatusPostIssueError';
    this.code = code;
    this.details = details;
  }
}

function normalizeHeader(header) {
  return String(header || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function cleanFieldValue(value) {
  const normalized = String(value || '').trim();

  if (!normalized || normalized === '_No response_') {
    return '';
  }

  return normalized;
}

function parseIssueFormBody(body) {
  const fields = {};
  let currentField = null;

  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = line.match(/^###\s+(.+?)\s*$/);

    if (heading) {
      currentField = normalizeHeader(heading[1]);
      fields[currentField] = fields[currentField] || '';
      continue;
    }

    if (currentField) {
      fields[currentField] += `${fields[currentField] ? '\n' : ''}${line}`;
    }
  }

  for (const [key, value] of Object.entries(fields)) {
    fields[key] = cleanFieldValue(value);
  }

  return fields;
}

function getField(fields, label) {
  return fields[normalizeHeader(label)] || '';
}

function labelsForIssue(issue) {
  return (issue.labels || [])
    .map((label) => (typeof label === 'string' ? label : label.name))
    .filter(Boolean);
}

function isStatusPostIssue(issue, fields) {
  if (labelsForIssue(issue).includes(STATUS_POST_LABEL)) {
    return true;
  }

  return ['Image source', 'Alt text', 'Background color'].some((label) => getField(fields, label));
}

function parseAllowedAuthors(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value) {
    return DEFAULT_ALLOWED_AUTHORS;
  }

  return String(value)
    .split(',')
    .map((author) => author.trim())
    .filter(Boolean);
}

function assertAllowedAuthor(issue, allowedAuthors) {
  const author = issue.user && issue.user.login;

  if (!allowedAuthors.includes(author)) {
    return {
      action: 'ignored',
      reason: 'unauthorized_author',
      author: author || '',
    };
  }

  return null;
}

function requiredField(fields, label) {
  const value = getField(fields, label);

  if (!value) {
    throw new StatusPostIssueError(`Missing required issue field: ${label}.`, 'missing_field', {
      field: label,
    });
  }

  return value;
}

function normalizeColor(value) {
  const match = String(value || '')
    .trim()
    .match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);

  if (!match) {
    throw new StatusPostIssueError(
      'Background color must be a hex color like #B02010.',
      'invalid_color',
      { color: value }
    );
  }

  const hex = match[1];
  const expanded =
    hex.length === 3
      ? hex
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : hex;

  return `#${expanded.toUpperCase()}`;
}

function extractImageUrl(value) {
  const source = String(value || '');
  const markdownImage = source.match(/!\[[^\]]*]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/i);
  const markdownLink = source.match(/\[[^\]]+]\((https?:\/\/[^)\s]+)(?:\s+["'][^"']*["'])?\)/i);
  const rawUrl = source.match(/https?:\/\/[^\s<>)"']+/i);
  const imageUrl = markdownImage?.[1] || markdownLink?.[1] || rawUrl?.[0];

  if (!imageUrl) {
    throw new StatusPostIssueError(
      'Image source must contain a GitHub attachment URL or direct image/GIF URL.',
      'missing_image_url'
    );
  }

  const parsedUrl = new URL(imageUrl);

  if (parsedUrl.protocol !== 'https:') {
    throw new StatusPostIssueError('Image source must use HTTPS.', 'invalid_image_url', {
      imageUrl,
    });
  }

  return parsedUrl.toString();
}

function extensionFromContentType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();

  if (type === 'image/jpeg' || type === 'image/jpg') {
    return 'jpg';
  }

  if (type === 'image/png') {
    return 'png';
  }

  if (type === 'image/gif') {
    return 'gif';
  }

  if (type === 'image/webp') {
    return 'webp';
  }

  return '';
}

function extensionFromImageType(type) {
  if (type === 'jpg' || type === 'jpeg') {
    return 'jpg';
  }

  if (type === 'png' || type === 'gif' || type === 'webp') {
    return type;
  }

  return '';
}

function extensionFromUrl(imageUrl) {
  const extension = Path.extname(new URL(imageUrl).pathname).replace(/^\./, '').toLowerCase();

  if (extension === 'jpeg') {
    return 'jpg';
  }

  if (['jpg', 'png', 'gif', 'webp'].includes(extension)) {
    return extension;
  }

  return '';
}

function responseHeader(headers, name) {
  if (!headers) {
    return '';
  }

  if (typeof headers.get === 'function') {
    return headers.get(name) || '';
  }

  return headers[name] || headers[name.toLowerCase()] || '';
}

function downloadRequestOptions(imageUrl, options = {}) {
  const requestOptions = {
    redirect: 'follow',
    headers: {},
  };
  const token = options.githubToken || process.env.GITHUB_TOKEN;
  const hostname = new URL(imageUrl).hostname.toLowerCase();

  if (token && (hostname === 'github.com' || hostname.endsWith('.githubusercontent.com'))) {
    requestOptions.headers.authorization = `Bearer ${token}`;
  }

  return requestOptions;
}

async function downloadImage(imageUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;

  if (!fetchImpl) {
    throw new StatusPostIssueError('No fetch implementation is available.', 'missing_fetch');
  }

  const response = await fetchImpl(imageUrl, downloadRequestOptions(imageUrl, options));

  if (!response.ok) {
    throw new StatusPostIssueError(
      `Could not download image: ${response.status} ${response.statusText || ''}`.trim(),
      'image_download_failed',
      { imageUrl, status: response.status }
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const maxImageBytes = options.maxImageBytes || MAX_IMAGE_BYTES;

  if (buffer.length > maxImageBytes) {
    throw new StatusPostIssueError(
      `Image is too large. Maximum supported size is ${maxImageBytes} bytes.`,
      'image_too_large',
      { imageUrl, bytes: buffer.length, maxImageBytes }
    );
  }

  let dimensions;

  try {
    dimensions = imageSize(buffer);
  } catch (error) {
    throw new StatusPostIssueError('Image source is not a supported image file.', 'unsupported_image', {
      imageUrl,
      cause: error.message,
    });
  }

  const extension =
    extensionFromContentType(responseHeader(response.headers, 'content-type')) ||
    extensionFromImageType(dimensions.type) ||
    extensionFromUrl(imageUrl);

  if (!extension) {
    throw new StatusPostIssueError('Image source must be a JPG, PNG, GIF, or WebP file.', 'unsupported_image', {
      imageUrl,
      type: dimensions.type,
    });
  }

  return {
    buffer,
    dimensions,
    extension,
  };
}

function greatestCommonDivisor(first, second) {
  let a = Math.abs(first);
  let b = Math.abs(second);

  while (b) {
    const next = b;
    b = a % b;
    a = next;
  }

  return a || 1;
}

function ratioTokenFromDimensions(width, height) {
  const normalizedWidth = Number(width);
  const normalizedHeight = Number(height);

  if (!Number.isInteger(normalizedWidth) || !Number.isInteger(normalizedHeight)) {
    throw new StatusPostIssueError('Ratio dimensions must be whole numbers.', 'invalid_ratio');
  }

  if (normalizedWidth <= 0 || normalizedHeight <= 0) {
    throw new StatusPostIssueError('Ratio dimensions must be positive.', 'invalid_ratio');
  }

  const divisor = greatestCommonDivisor(normalizedWidth, normalizedHeight);
  const reducedWidth = normalizedWidth / divisor;
  const reducedHeight = normalizedHeight / divisor;

  // Existing data stores ratio tokens inverted: ratio-a-b renders as b / a.
  return `${reducedHeight}-${reducedWidth}`;
}

function ratioTokenFromOverride(value) {
  const override = cleanFieldValue(value);

  if (!override) {
    return '';
  }

  const match = override.match(/^(\d+)\s*[-:/xX]\s*(\d+)$/);

  if (!match) {
    throw new StatusPostIssueError(
      'Ratio override must use natural width-height format, like 4-5 or 16:9.',
      'invalid_ratio',
      { ratio: value }
    );
  }

  return ratioTokenFromDimensions(Number(match[1]), Number(match[2]));
}

function datePartsForTimeZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour === '24' ? '00' : parts.hour,
    minute: parts.minute,
  };
}

function postIdForDate(date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = datePartsForTimeZone(date, timeZone);

  return `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}`;
}

function fullTimeForDate(date, timeZone = DEFAULT_TIME_ZONE) {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

  return `${time} • ${day}`;
}

function readEvent(options = {}) {
  if (options.event) {
    return options.event;
  }

  const eventPath = options.eventPath || process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    throw new StatusPostIssueError('GITHUB_EVENT_PATH is required.', 'missing_event_path');
  }

  return JSON.parse(Fs.readFileSync(eventPath, 'utf8'));
}

function readData(dataPath) {
  const data = JSON.parse(Fs.readFileSync(dataPath, 'utf8'));

  if (!data || !Array.isArray(data.posts)) {
    throw new StatusPostIssueError('data.json must contain a posts array.', 'invalid_data');
  }

  return data;
}

function relativePath(filePath, fromDir = rootDir) {
  return Path.relative(fromDir, filePath).split(Path.sep).join('/');
}

function assertNoPostCollision(data, guid, assetPath) {
  if (data.posts.some((post) => post.guid === guid)) {
    throw new StatusPostIssueError(`Post ${guid} already exists in data.json.`, 'post_collision', {
      guid,
    });
  }

  if (Fs.existsSync(assetPath)) {
    throw new StatusPostIssueError(`Asset already exists: ${relativePath(assetPath)}.`, 'asset_collision', {
      assetPath: relativePath(assetPath),
    });
  }
}

function buildPost({ postId, fullTime, filename, altText, ratio, color }) {
  const displayImage = `assets/img/content/${filename}`;

  return {
    guid: `#${postId}`,
    fullTime,
    image: `${CURRENT_STATUS_ORIGIN}/${displayImage}`,
    displayImage,
    imageAltDesc: altText,
    ratio,
    color,
  };
}

async function createPostFromIssue(options = {}) {
  const event = readEvent(options);
  const issue = event.issue || event;
  const allowedAuthors = parseAllowedAuthors(options.allowedAuthors || process.env.POST_ALLOWED_AUTHORS);
  const unauthorizedResult = assertAllowedAuthor(issue, allowedAuthors);

  if (unauthorizedResult) {
    return unauthorizedResult;
  }

  const fields = parseIssueFormBody(issue.body);

  if (!isStatusPostIssue(issue, fields)) {
    return {
      action: 'ignored',
      reason: 'not_status_post_issue',
      author: issue.user && issue.user.login ? issue.user.login : '',
    };
  }

  const imageSource = requiredField(fields, 'Image source');
  const altText = requiredField(fields, 'Alt text');
  const color = normalizeColor(requiredField(fields, 'Background color'));
  const imageUrl = extractImageUrl(imageSource);
  const downloadedImage = await downloadImage(imageUrl, options);
  const ratio =
    ratioTokenFromOverride(getField(fields, 'Ratio override')) ||
    ratioTokenFromDimensions(downloadedImage.dimensions.width, downloadedImage.dimensions.height);

  const dataPath = options.dataPath || DEFAULT_DATA_PATH;
  const assetDir = options.assetDir || DEFAULT_ASSET_DIR;
  const timeZone = options.timeZone || process.env.POST_TIMEZONE || DEFAULT_TIME_ZONE;
  const now = options.now || new Date();
  const postId = postIdForDate(now, timeZone);
  const filename = `${postId}.${downloadedImage.extension}`;
  const assetPath = Path.join(assetDir, filename);
  const data = readData(dataPath);
  const post = buildPost({
    postId,
    fullTime: fullTimeForDate(now, timeZone),
    filename,
    altText,
    ratio,
    color,
  });

  assertNoPostCollision(data, post.guid, assetPath);

  Fs.mkdirSync(assetDir, { recursive: true });
  Fs.writeFileSync(assetPath, downloadedImage.buffer);
  data.posts.unshift(post);
  Fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);

  return {
    action: 'created',
    postId,
    guid: post.guid,
    filename,
    assetPath: relativePath(assetPath),
    dataPath: relativePath(dataPath),
    branchName: `status-post/${postId}`,
    issueNumber: issue.number ? String(issue.number) : '',
    ratio,
  };
}

function appendGithubOutputs(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) {
    return;
  }

  const lines = Object.entries(result).map(([key, value]) => `${key}=${String(value).replace(/\n/g, ' ')}`);
  Fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
}

if (require.main === module) {
  createPostFromIssue()
    .then((result) => {
      appendGithubOutputs(result);
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error.message);

      if (error.details && Object.keys(error.details).length > 0) {
        console.error(JSON.stringify(error.details, null, 2));
      }

      process.exitCode = 1;
    });
}

module.exports = {
  StatusPostIssueError,
  createPostFromIssue,
  datePartsForTimeZone,
  downloadImage,
  extractImageUrl,
  fullTimeForDate,
  normalizeColor,
  parseIssueFormBody,
  postIdForDate,
  ratioTokenFromDimensions,
  ratioTokenFromOverride,
};
