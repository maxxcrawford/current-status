const Fs = require('fs');
const Path = require('path');
const { spawn } = require('child_process');
const browserSync = require('browser-sync').create();

const rootDir = Path.resolve(__dirname, '../..');
const watchedFiles = ['index.html', 'data.json', 'assets/style.css'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

let buildInProgress = false;
let buildQueued = false;
let debounceTimer = null;
let serverStarted = false;

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

function startServer() {
  if (serverStarted) {
    return;
  }

  serverStarted = true;
  browserSync.init({
    server: Path.join(rootDir, 'dist'),
    notify: false,
    open: true,
  });
}

async function buildAndReload(reason) {
  if (buildInProgress) {
    buildQueued = true;
    return;
  }

  buildInProgress = true;
  console.log(`[build:watch] ${reason}`);

  const buildSucceeded = await runBuild();
  buildInProgress = false;

  if (buildSucceeded) {
    if (serverStarted) {
      browserSync.reload();
    } else {
      startServer();
    }
  } else {
    console.error('[build:watch] Build failed; fix the error and save again.');
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

function watchFile(relativePath) {
  const absolutePath = Path.join(rootDir, relativePath);

  Fs.watch(absolutePath, { persistent: true }, () => {
    scheduleBuild(relativePath);
  });
}

process.on('SIGINT', () => {
  browserSync.exit();
  process.exit(0);
});

console.log(`[build:watch] Watching ${watchedFiles.join(', ')}`);
watchedFiles.forEach(watchFile);
buildAndReload('Initial build.');
