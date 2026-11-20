const Fs = require('fs');
const Path = require('path');
const { spawn } = require('child_process');
const { parseArgs } = require('node:util');

const rootDir = Path.resolve(__dirname, '../..');
const watchedFiles = [
  'index.html',
  'data.json',
  'assets/scripts/gen-index.js',
  'assets/scripts/app.js',
  'assets/style.css',
  'assets/tailwind.css',
];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const { values: previewOptions } = parseArgs({
  options: {
    port: { type: 'string', default: '3000' },
    strictPort: { type: 'boolean' },
  },
});

let buildInProgress = false;
let buildQueued = false;
let debounceTimer = null;
let server;

function runBuild() {
  return new Promise((resolve) => {
    const child = spawn(npmCommand, ['run', 'build'], {
      cwd: rootDir,
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      console.error(`[build:watch] Could not start build: ${error.message}`);
      resolve(false);
    });

    child.on('exit', (code) => {
      resolve(code === 0);
    });
  });
}

async function startPreview() {
  const { createServer } = await import('vite');
  const preview = await createServer({
    configFile: Path.join(rootDir, 'vite.config.mjs'),
    plugins: [{
      name: 'reload-after-build',
      configResolved(config) {
        // Reload once the generated files and inlined styles are ready.
        config.server.watch = null;
      },
    }],
    server: {
      port: Number(previewOptions.port),
      strictPort: previewOptions.strictPort,
      open: true,
    },
  });
  try {
    await preview.listen();
    preview.printUrls();
    server = preview;
  } catch (error) {
    await preview.close();
    throw error;
  }
}

async function buildAndReload(reason) {
  if (buildInProgress) {
    buildQueued = true;
    return;
  }

  buildInProgress = true;
  console.log(`[build:watch] ${reason}`);

  try {
    if (!await runBuild()) {
      console.error('[build:watch] Build failed. Fix the error and save again.');
    } else if (server) {
      server.environments.client.hot.send({ type: 'full-reload', path: '*' });
    } else {
      await startPreview();
    }
  } catch (error) {
    console.error(`[build:watch] Preview failed: ${error.message}`);
  } finally {
    buildInProgress = false;
  }

  if (buildQueued) {
    buildQueued = false;
    buildAndReload('Queued change detected; rebuilding again.');
  }
}

function scheduleBuild(relativePath) {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    buildAndReload(`${relativePath} changed; rebuilding.`);
  }, 150);
}

for (const directory of new Set(watchedFiles.map(file => Path.dirname(file)))) {
  Fs.watch(Path.join(rootDir, directory), (_event, file) => {
    if (!file) return;
    const relativePath = Path.join(directory, file);
    if (watchedFiles.includes(relativePath)) scheduleBuild(relativePath);
  });
}

process.once('SIGINT', async () => {
  await server?.close();
  process.exit(0);
});

console.log(`[build:watch] Watching ${watchedFiles.join(', ')}`);
buildAndReload('Initial build.');
