require('dotenv').config();

const { errorToResponse, seedExistingPosts } = require('../../lib/mastodon-publisher');

(async function main() {
  try {
    const result = await seedExistingPosts({
      commitRef: process.env.COMMIT_REF || null,
      source: 'local-seed-script',
    });

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    const response = errorToResponse(error);
    console.error(JSON.stringify(response.body, null, 2));
    process.exitCode = 1;
  }
})();
