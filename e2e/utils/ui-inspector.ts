import type { Page, TestInfo } from '@playwright/test';

/**
 * Reusable viewport presets for responsive-layout checks. Values mirror
 * common device breakpoints rather than any CSS breakpoint the app defines
 * (this is a react-native-web app — layout is driven by RN flexbox/media
 * queries in code, not a CSS framework).
 */
export const VIEWPORTS = {
  mobile: { width: 390, height: 844 }, // iPhone 14-class
  tablet: { width: 768, height: 1024 }, // iPad portrait
  desktop: { width: 1440, height: 900 },
} as const;

export type ViewportName = keyof typeof VIEWPORTS;

/** Navigates to `path`, waits for network idle, and attaches a full-page screenshot to the test report. */
export async function gotoAndCapture(page: Page, testInfo: TestInfo, path: string, label: string) {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(label, { body: screenshot, contentType: 'image/png' });
  return screenshot;
}

/** Resizes the viewport, waits for layout to settle, and attaches a screenshot per named breakpoint. */
export async function captureAcrossViewports(
  page: Page,
  testInfo: TestInfo,
  path: string,
  viewports: ViewportName[] = ['mobile', 'tablet', 'desktop']
) {
  await page.goto(path);
  for (const name of viewports) {
    await page.setViewportSize(VIEWPORTS[name]);
    await page.waitForLoadState('networkidle');
    const screenshot = await page.screenshot({ fullPage: true });
    await testInfo.attach(`${name}-${VIEWPORTS[name].width}x${VIEWPORTS[name].height}`, {
      body: screenshot,
      contentType: 'image/png',
    });
  }
}

/**
 * Starts collecting `console.error` calls and uncaught page errors. Call the
 * returned function at the end of a test to get the list observed so far —
 * useful for asserting a screen renders cleanly with no red console noise.
 */
export function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));
  return () => errors;
}
