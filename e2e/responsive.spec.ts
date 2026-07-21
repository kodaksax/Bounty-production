import { test } from '@playwright/test';
import { captureAcrossViewports } from './utils/ui-inspector';

// Demonstrates the responsive-layout workflow: same route, three viewport
// presets, one attached screenshot per breakpoint. Use this pattern when
// reviewing a frontend change visually across form factors.
test('sign-in screen across mobile/tablet/desktop viewports', async ({ page }, testInfo) => {
  await captureAcrossViewports(page, testInfo, '/');
});
