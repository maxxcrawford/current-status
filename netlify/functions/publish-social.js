const Crypto = require('crypto');
const { connectLambda } = require('@netlify/blobs');
const { getLatestPublishRecords, publishAllLatest, seedAllExistingPosts } = require('../../lib/social-publisher');

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === lowerName);
  return entry && entry[1];
}

function getRequestSecret(event) {
  const authorization = getHeader(event.headers, 'authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (match) {
    return match[1];
  }

  return getHeader(event.headers, 'x-publish-secret') || '';
}

function secretsMatch(actual, expected) {
  const actualBuffer = Buffer.from(String(actual || ''));
  const expectedBuffer = Buffer.from(String(expected || ''));

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return Crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseBody(event) {
  if (!event.body) {
    return {};
  }

  const rawBody = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8').toString('utf8');
  return JSON.parse(rawBody);
}

function statusCodeForResult(result) {
  if (result.action === 'failed') {
    return 500;
  }

  if (result.action === 'partial_failed') {
    return 207;
  }

  return result.action === 'published' ? 201 : 200;
}

exports.handler = async function handler(event) {
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return json(405, { error: 'method_not_allowed', message: 'Use GET or POST.' }, { allow: 'GET, POST' });
  }

  if (!process.env.PUBLISH_SECRET) {
    return json(500, {
      error: 'missing_publish_secret',
      message: 'PUBLISH_SECRET is required.',
    });
  }

  if (!secretsMatch(getRequestSecret(event), process.env.PUBLISH_SECRET)) {
    return json(401, { error: 'unauthorized', message: 'Invalid publish secret.' });
  }

  if (event.blobs) {
    connectLambda(event);
  }

  if (event.httpMethod === 'GET') {
    try {
      const services = await getLatestPublishRecords();

      return json(200, {
        action: 'latest',
        services,
      });
    } catch (error) {
      return json(500, {
        error: 'latest_lookup_failed',
        message: error.message,
      });
    }
  }

  let body;

  try {
    body = parseBody(event);
  } catch (error) {
    return json(400, { error: 'invalid_json', message: error.message });
  }

  const options = {
    commitRef: body.commitRef || process.env.COMMIT_REF,
    onlyTop: body.only === 'top' || body.onlyTop === true,
    source: body.source || 'manual-function',
    sourceBaseUrl: body.sourceBaseUrl || process.env.DEPLOY_URL || process.env.URL,
  };
  const result = body.mode === 'seed' ? await seedAllExistingPosts(options) : await publishAllLatest(options);

  return json(statusCodeForResult(result), result);
};
