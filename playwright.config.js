const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/browser',
  use: {
    baseURL: 'http://localhost:3101',
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run preview -- --port 3101 --strictPort',
    url: 'http://localhost:3101',
  },
});
