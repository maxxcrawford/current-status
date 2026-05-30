require('dotenv').config();

const { errorToResponse, publishLatestDirect } = require('../../lib/mastodon-publisher');

(async function main() {
  try {
    const result = await publishLatestDirect({
      localFiles: true,
      source: 'local-mastodon-script',
      sourceBaseUrl: process.env.SOURCE_BASE_URL || process.env.URL || 'https://current-status.com',
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const response = errorToResponse(error);
    console.error(JSON.stringify(response.body, null, 2));
    process.exitCode = 1;
  }
})();
