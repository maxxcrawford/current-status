const { PublishError } = require('./publisher-common');

// Each publishing run creates a fresh session and makes just two authenticated calls.
async function createBlueskyHttpClient({ identifier, password, service, fetchImpl = globalThis.fetch }) {
  async function request(base, method, body, contentType, accessJwt) {
    const response = await fetchImpl(new URL(`/xrpc/${method}`, base), {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(accessJwt ? { authorization: `Bearer ${accessJwt}` } : {}),
      },
      body,
    });

    if (!response.ok) {
      throw new PublishError(`Bluesky ${method} failed with status ${response.status}.`, 'bluesky_api_failed', 502);
    }

    try {
      return await response.json();
    } catch {
      throw new PublishError(`Bluesky ${method} returned invalid JSON.`, 'bluesky_api_failed', 502);
    }
  }

  const session = await request(service, 'com.atproto.server.createSession',
    JSON.stringify({ identifier, password }), 'application/json');
  if (!session?.accessJwt || !session?.did) {
    throw new PublishError('Bluesky login returned an incomplete session.', 'bluesky_api_failed', 502);
  }

  // Hosted accounts can authenticate through bsky.social but write to their own PDS.
  const pds = session.didDoc?.service?.find(entry =>
    (entry.id === '#atproto_pds' || entry.id === `${session.did}#atproto_pds`) &&
    entry.type === 'AtprotoPersonalDataServer'
  );
  const endpoint = pds?.serviceEndpoint || service;

  return {
    async uploadBlob(file, { encoding }) {
      const data = await request(endpoint, 'com.atproto.repo.uploadBlob', file, encoding, session.accessJwt);
      if (!data?.blob) {
        throw new PublishError('Bluesky upload returned no blob.', 'bluesky_api_failed', 502);
      }
      return { data };
    },
    async post(record) {
      const data = await request(endpoint, 'com.atproto.repo.createRecord', JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record: { ...record, $type: 'app.bsky.feed.post' },
      }), 'application/json', session.accessJwt);
      if (!data?.uri || !data?.cid) {
        throw new PublishError('Bluesky post returned no URI or CID.', 'bluesky_api_failed', 502);
      }
      return data;
    },
  };
}

module.exports = { createBlueskyHttpClient };
