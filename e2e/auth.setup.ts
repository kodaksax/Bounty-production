import { test as setup } from '@playwright/test';

/**
 * Optional authenticated-session bootstrap for Playwright.
 *
 * Disabled by default: this project's auth goes through a real Supabase
 * project (see lib/supabase.ts), so signing in here would exercise a live
 * backend. This file intentionally does nothing unless you opt in with your
 * own test account, so `npx playwright test` never triggers real auth calls
 * by accident.
 *
 * To enable authenticated E2E coverage:
 *   1. Create a dedicated test user in the dev Supabase project (never reuse
 *      a real user's credentials).
 *   2. Set E2E_TEST_EMAIL / E2E_TEST_PASSWORD in your shell or .env.test.
 *   3. Wire this file in as a Playwright setup project in playwright.config.ts:
 *
 *        projects: [
 *          { name: 'setup', testMatch: /auth\.setup\.ts/ },
 *          { name: 'chromium', use: devices['Desktop Chrome'], dependencies: ['setup'] },
 *        ]
 *
 *   4. Reference the saved state from a test:
 *        test.use({ storageState: 'e2e/.auth/user.json' })
 *
 * The Supabase web client persists its session to localStorage under the key
 * `supabase.auth.token.<project-ref>` (see PROJECT_STORAGE_KEY in
 * lib/supabase.ts) — `page.context().storageState()` captures that
 * automatically once a real sign-in completes, so no manual token plumbing
 * is required.
 */
setup('authenticate', async ({ page }) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    setup.skip(true, 'E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set — skipping authenticated setup.');
    return;
  }

  await page.goto('/');
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(/\/(tabs|onboarding)/, { timeout: 20_000 });

  await page.context().storageState({ path: 'e2e/.auth/user.json' });
});
