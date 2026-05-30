const blueskyPublisher = require('./bluesky-publisher');
const mastodonPublisher = require('./mastodon-publisher');
const { errorToResponse } = require('./publisher-common');

const SERVICES = {
  mastodon: mastodonPublisher,
  bluesky: blueskyPublisher,
};
const DEFAULT_SERVICES = ['mastodon', 'bluesky'];

function serviceOptions(name, options) {
  const stores = options.stores || {};
  const nextOptions = {
    ...options,
    store: stores[name] || options.store,
  };

  delete nextOptions.stores;

  return nextOptions;
}

function summarizeResults(results, serviceNames) {
  const counts = {
    published: 0,
    noop: 0,
    failed: 0,
  };

  for (const name of serviceNames) {
    const result = results[name];

    if (!result) {
      continue;
    }

    if (result.action === 'published') {
      counts.published += 1;
    } else if (result.action === 'failed') {
      counts.failed += 1;
    } else {
      counts.noop += 1;
    }
  }

  let action = 'noop';

  if (counts.failed === serviceNames.length) {
    action = 'failed';
  } else if (counts.failed > 0) {
    action = 'partial_failed';
  } else if (counts.published > 0) {
    action = 'published';
  }

  return {
    action,
    ...counts,
    total: serviceNames.length,
  };
}

async function publishAllLatest(options = {}) {
  const serviceNames = options.services || DEFAULT_SERVICES;
  const services = {};

  for (const name of serviceNames) {
    const publisher = SERVICES[name];

    if (!publisher) {
      services[name] = {
        action: 'failed',
        error: 'unknown_service',
        message: `Unknown publish service: ${name}`,
      };
      continue;
    }

    try {
      services[name] = await publisher.publishLatest(serviceOptions(name, options));
    } catch (error) {
      const response = errorToResponse(error);
      services[name] = {
        action: 'failed',
        statusCode: response.statusCode,
        ...response.body,
      };
    }
  }

  return {
    ...summarizeResults(services, serviceNames),
    services,
  };
}

async function seedAllExistingPosts(options = {}) {
  const serviceNames = options.services || DEFAULT_SERVICES;
  const services = {};

  for (const name of serviceNames) {
    const publisher = SERVICES[name];

    if (!publisher) {
      services[name] = {
        action: 'failed',
        error: 'unknown_service',
        message: `Unknown publish service: ${name}`,
      };
      continue;
    }

    try {
      services[name] = await publisher.seedExistingPosts(serviceOptions(name, options));
    } catch (error) {
      const response = errorToResponse(error);
      services[name] = {
        action: 'failed',
        statusCode: response.statusCode,
        ...response.body,
      };
    }
  }

  return {
    ...summarizeResults(services, serviceNames),
    services,
  };
}

async function getLatestPublishRecords(options = {}) {
  const serviceNames = options.services || DEFAULT_SERVICES;
  const stores = options.stores || {};
  const services = {};

  for (const name of serviceNames) {
    const publisher = SERVICES[name];

    if (!publisher) {
      services[name] = null;
      continue;
    }

    services[name] = await publisher.getLatestPublishRecord({
      store: stores[name] || options.store,
    });
  }

  return services;
}

module.exports = {
  DEFAULT_SERVICES,
  SERVICES,
  getLatestPublishRecords,
  publishAllLatest,
  seedAllExistingPosts,
};
