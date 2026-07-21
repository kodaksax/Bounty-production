import { defineConfig, devices } from '@playwright/test';

/**
 * Port is dedicated to Playwright's own `expo start --web` instance so it
 * never fights over :8081 with a native `expo start --dev-client` session
 * a developer may already have running in another terminal.
 */
const PORT = process.env.PLAYWRIGHT_WEB_PORT || '8090';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { open: 'never' }],
    ['list'],
  ],
  timeout: 30 * 1000,
  expect: {
    timeout: 10 * 1000,
  },

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15 * 1000,
    navigationTimeout: 30 * 1000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],

  // Boots `expo start --web` automatically so `npx playwright test` works
  // standalone. First run bundles the whole Metro graph (~1-2 min); the long
  // timeout below accounts for that. Set `reuseExistingServer` behavior via
  // CI env so local runs reuse a server you already started by hand.
  webServer: {
    command: `npx expo start --web --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
