const Crypto = require('crypto');
const { connectLambda } = require('@netlify/blobs');
const { errorToResponse, publishLatest, seedExistingPosts } = require('../../lib/mastodon-publisher');

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

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed', message: 'Use POST.' }, { allow: 'POST' });
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

  let body;

  try {
    body = parseBody(event);
  } catch (error) {
    return json(400, { error: 'invalid_json', message: error.message });
  }

  if (event.blobs) {
    connectLambda(event);
  }

  try {
    const options = {
      commitRef: body.commitRef || process.env.COMMIT_REF,
      source: body.source || 'manual-function',
      sourceBaseUrl: body.sourceBaseUrl || process.env.DEPLOY_URL || process.env.URL,
    };
    const result = body.mode === 'seed' ? await seedExistingPosts(options) : await publishLatest(options);

    return json(result.action === 'published' ? 201 : 200, result);
  } catch (error) {
    const response = errorToResponse(error);
    return json(response.statusCode, response.body);
  }
};
