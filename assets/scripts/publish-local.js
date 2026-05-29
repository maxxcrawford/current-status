require('dotenv').config();

const { errorToResponse } = require('../../lib/publisher-common');
const { publishLatestDirect: publishBlueskyLatestDirect } = require('../../lib/bluesky-publisher');
const { publishLatestDirect: publishMastodonLatestDirect } = require('../../lib/mastodon-publisher');

(async function main() {
  const options = {
    localFiles: true,
    sourceBaseUrl: process.env.SOURCE_BASE_URL || process.env.URL || 'https://current-status.com',
  };
  const services = {};

  try {
    services.mastodon = await publishMastodonLatestDirect({
      ...options,
      source: 'local-mastodon-script',
    });
  } catch (error) {
    const response = errorToResponse(error);
    services.mastodon = {
      action: 'failed',
      statusCode: response.statusCode,
      ...response.body,
    };
  }

  try {
    services.bluesky = await publishBlueskyLatestDirect({
      ...options,
      source: 'local-bluesky-script',
    });
  } catch (error) {
    const response = errorToResponse(error);
    services.bluesky = {
      action: 'failed',
      statusCode: response.statusCode,
      ...response.body,
    };
  }

  const result = {
    action: Object.values(services).some((service) => service.action === 'failed') ? 'partial_failed' : 'published',
    published: Object.values(services).filter((service) => service.action === 'published').length,
    failed: Object.values(services).filter((service) => service.action === 'failed').length,
    services,
  };

  console.log(JSON.stringify(result, null, 2));

  if (result.failed > 0) {
    process.exitCode = 1;
  }
})();
