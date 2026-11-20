import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import { config, createPostLikesHandler } from './netlify/functions/post-likes.mjs';

function localPostLikes() {
  const directory = join(import.meta.dirname, 'node_modules', '.cache', 'current-status', 'post-likes');

  function read(key) {
    try {
      const data = JSON.parse(readFileSync(join(directory, key), 'utf8'));
      return { data, etag: String(data.length), metadata: { count: data.length } };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const store = {
    getWithMetadata: read,
    getMetadata: read,
    setJSON(key, data, { onlyIfMatch, onlyIfNew }) {
      const current = read(key);
      if (onlyIfNew ? current !== null : current?.etag !== onlyIfMatch) return { modified: false };
      const temporary = join(directory, `${key}.${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, JSON.stringify(data));
        renameSync(temporary, join(directory, key));
      } finally {
        rmSync(temporary, { force: true });
      }
      return { modified: true };
    },
  };
  const handle = createPostLikesHandler(() => store);

  function configureServer(server) {
    mkdirSync(directory, { recursive: true });
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname !== config.path) return next();

      try {
        const response = await handle(new Request(url, { method: req.method, headers: req.headers }));
        const body = await response.text();
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(body);
      } catch (error) {
        server.config.logger.error(`[post-likes] ${error.message}`);
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'local_store_unavailable' }));
      }
    });
  }

  return { name: 'local-post-likes', configureServer };
}

export default defineConfig({
  root: join(import.meta.dirname, 'dist'),
  server: { host: 'localhost', port: 3000 },
  plugins: [localPostLikes()],
});
