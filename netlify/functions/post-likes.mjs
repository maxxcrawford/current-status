import { getStore } from '@netlify/blobs';
import data from '../../data.json' with { type: 'json' };

const postIds = new Set(data.posts.map(post => post.guid.replace(/^#/, '')));
const reactionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const config = {
  path: '/api/post-likes',
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};

function json(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

export function createPostLikesHandler(openStore) {
  return request => postLikes(request, openStore);
}

export default createPostLikesHandler(() => getStore({ name: 'post-likes', consistency: 'strong' }));

async function postLikes(request, openStore) {
  const url = new URL(request.url);
  const ids = [...new Set(url.searchParams.getAll('id'))];

  if (request.method === 'POST') {
    if (request.headers.get('origin') !== url.origin) return json({ error: 'forbidden' }, 403);

    const [id] = ids;
    const reaction = request.headers.get('x-reaction-id');
    if (ids.length !== 1 || !postIds.has(id) || !reactionIdPattern.test(reaction)) {
      return json({ error: 'invalid_reaction' }, 400);
    }

    const store = openStore();
    // Keep the count and reaction IDs in the same conditional write so retries cannot add a second like.
    for (let attempt = 0; attempt < 8; attempt++) {
      const entry = await store.getWithMetadata(id, { type: 'json' });
      const reactions = entry?.data ?? [];
      if (reactions.includes(reaction)) return json({ count: reactions.length });
      if (entry && !entry.etag) break;

      const count = reactions.push(reaction);
      const condition = entry ? { onlyIfMatch: entry.etag } : { onlyIfNew: true };
      const { modified } = await store.setJSON(id, reactions, { ...condition, metadata: { count } });
      if (modified) return json({ count });
    }
    return json({ error: 'try_again' }, 503);
  }

  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET, POST' });
  if (!ids.length || ids.length > 30 || ids.some(id => !postIds.has(id))) {
    return json({ error: 'invalid_posts' }, 400);
  }

  const store = openStore();
  const counts = await Promise.all(ids.map(async id => {
    const entry = await store.getMetadata(id);
    return [id, entry?.metadata.count ?? 0];
  }));
  return json(Object.fromEntries(counts));
}
