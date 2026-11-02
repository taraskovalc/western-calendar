// Browser tests for the website. Run everything with:  npm test
// The site is served from this folder on localhost, so app.js talks to
// localhost:3000 (not the real API) and nothing is counted in the statistics.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `http://localhost:${PORT}/web/index.html`,
    reuseExistingServer: !process.env.CI,
    stderr: 'ignore',  // python logs every request here
  },
  projects: [
    { name: 'parser', testMatch: 'parser.spec.js' },
    { name: 'light', testMatch: 'walkthrough.spec.js', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'dark', testMatch: 'walkthrough.spec.js', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    { name: 'phone', testMatch: 'walkthrough.spec.js', use: { ...devices['Pixel 7'], colorScheme: 'dark' } },
  ],
});
