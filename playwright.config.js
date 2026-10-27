const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  use: {
    baseURL: 'http://127.0.0.1:3101',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 3101 --strictPort',
    url: 'http://127.0.0.1:3101',
  },
});
