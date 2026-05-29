const { execFileSync } = require('child_process');

const DATA_PATH = 'data.json';

function runGit(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .split(/\r?\n/)
    .filter(Boolean);
}

function revExists(rev) {
  try {
    execFileSync('git', ['rev-parse', '--verify', `${rev}^{commit}`], {
      stdio: 'ignore',
    });
    return true;
  } catch (error) {
    return false;
  }
}

function pathsIncludeDataJson(paths) {
  return paths.includes(DATA_PATH);
}

function dataJsonChanged() {
  const head = process.env.COMMIT_REF;
  const base = process.env.CACHED_COMMIT_REF;

  if (base && head && base !== head && revExists(base) && revExists(head)) {
    return pathsIncludeDataJson(runGit(['diff', '--name-only', base, head, '--', DATA_PATH]));
  }

  if (head && revExists(head)) {
    return pathsIncludeDataJson(
      runGit(['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', head, '--', DATA_PATH])
    );
  }

  return false;
}

async function callPublishFunction() {
  const deployUrl = process.env.DEPLOY_URL || process.env.URL;

  if (!deployUrl) {
    throw new Error('DEPLOY_URL or URL is required to call the publish function.');
  }

  if (!process.env.PUBLISH_SECRET) {
    throw new Error('PUBLISH_SECRET is required for the publish function.');
  }

  const endpoint = new URL('/.netlify/functions/publish-social', deployUrl);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.PUBLISH_SECRET}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      commitRef: process.env.COMMIT_REF || null,
      only: 'top',
      source: 'netlify-build-plugin',
      sourceBaseUrl: deployUrl,
    }),
  });
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Publish function failed with ${response.status}: ${responseBody}`);
  }

  const result = JSON.parse(responseBody);

  console.log(`Social publish result: ${responseBody}`);

  if (result.services && result.services.mastodon && result.services.mastodon.mastodonUrl) {
    console.log(`Mastodon URL: ${result.services.mastodon.mastodonUrl}`);
  }

  if (result.services && result.services.bluesky && result.services.bluesky.blueskyUrl) {
    console.log(`Bluesky URL: ${result.services.bluesky.blueskyUrl}`);
  }

  if (result.failed > 0) {
    console.warn(`Social publish completed with ${result.failed} failed service(s).`);
  }
}

module.exports = {
  onSuccess: async () => {
    if (process.env.CONTEXT !== 'production') {
      console.log(`Skipping social publish for deploy context: ${process.env.CONTEXT || 'unknown'}.`);
      return;
    }

    if (!dataJsonChanged()) {
      console.log('Skipping social publish because data.json did not change.');
      return;
    }

    await callPublishFunction();
  },
};
