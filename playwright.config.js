// End-to-end tests: the real app, served by server.js and running the real
// converters, driven with real mouse and keyboard input in WebKit (Safari's
// engine), Firefox and Chromium.
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  globalSetup: require.resolve('./tests/global-setup.js'),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  // Each test starts its own server.js (see tests/fixtures.js), which sets
  // the baseURL for it.
  use: { trace: 'retain-on-failure', acceptDownloads: true },
  projects: [
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
