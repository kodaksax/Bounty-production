import { expect, test } from '@playwright/test';
import { collectConsoleErrors, gotoAndCapture } from './utils/ui-inspector';

test.describe('app boot', () => {
  test('root route renders without crashing', async ({ page }, testInfo) => {
    const getConsoleErrors = collectConsoleErrors(page);

    await gotoAndCapture(page, testInfo, '/', 'root-screen');

    // Unauthenticated boot lands on the sign-in form (see app/index.tsx
    // useAppBootstrap state machine) — assert the app shell mounted rather
    // than hitting Metro's static error overlay (id="_expo-static-error").
    await expect(page.locator('#root')).toBeVisible();
    await expect(page.locator('#_expo-static-error')).toHaveCount(0);

    const errors = getConsoleErrors().filter((e) => !e.includes('Warning:'));
    expect(errors, `unexpected console errors: ${errors.join('\n')}`).toEqual([]);
  });
});
