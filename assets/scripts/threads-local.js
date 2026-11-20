require('dotenv').config();

const { errorToResponse, publishLatestDirect } = require('../../lib/threads-publisher');
const { readData } = require('../../lib/publisher-common');
const { stageThreadsImage } = require('../../lib/threads-image');

(async function main() {
  try {
    const sourceBaseUrl = process.env.SOURCE_BASE_URL || process.env.URL || 'https://current-status.com';
    await stageThreadsImage(readData().posts[0], { sourceBaseUrl });
    const result = await publishLatestDirect({
      source: 'local-threads-script',
      sourceBaseUrl,
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const response = errorToResponse(error);
    console.error(JSON.stringify(response.body, null, 2));
    process.exitCode = 1;
  }
})();
