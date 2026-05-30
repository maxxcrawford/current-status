require('dotenv').config();

const { errorToResponse, publishLatest } = require('../../lib/bluesky-publisher');

(async function main() {
  try {
    const result = await publishLatest({
      commitRef: process.env.COMMIT_REF || null,
      onlyTop: true,
      source: process.env.PUBLISH_SOURCE || 'netlify-bluesky-script',
      sourceBaseUrl: process.env.SOURCE_BASE_URL || process.env.URL || 'https://current-status.com',
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const response = errorToResponse(error);
    console.error(JSON.stringify(response.body, null, 2));
    process.exitCode = 1;
  }
})();
