import { expect, test } from '@playwright/test';

/**
 * Captures the welcome screen in both A/B arms for design review:
 * `control` (the existing screen) and `poster_first` (the redesign).
 *
 * The arm is normally handed down by the PostHog 'welcome-page-redesign'
 * flag, but lib/experiments/first-screen-variant.ts checks its AsyncStorage
 * cache first — and AsyncStorage is plain localStorage on web — so seeding
 * the key before boot pins the arm without needing PostHog in the loop.
 *
 * Font scale: react-native-web's PixelRatio.getFontScale() falls through to
 * window.devicePixelRatio, so a 1.3 deviceScaleFactor drives the same
 * font-scale code path ProofCard reads on device. Note that RN Web does not
 * additionally grow glyph sizes the way iOS/Android Dynamic Type does, so
 * these shots show the scaled container geometry, not enlarged text.
 */

const VARIANT_STORAGE_KEY = '@bounty_first_screen_variant_v3';
const WELCOME_ROUTE = '/onboarding/welcome';

// iPhone 13 mini — the smallest device the layout has to hold on.
const IPHONE_13_MINI = { width: 375, height: 812 };

const SHOT_DIR = process.env.FIRST_SCREEN_SHOT_DIR || 'first-screen-shots';

async function captureArm(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  arm: 'control' | 'poster_first',
  label: string
) {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [VARIANT_STORAGE_KEY, arm] as const
  );

  await page.goto(WELCOME_ROUTE);
  await page.waitForLoadState('networkidle');

  // Guard against screenshotting Metro's error overlay instead of the screen.
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('#_expo-static-error')).toHaveCount(0);

  const screenshot = await page.screenshot({ path: `${SHOT_DIR}/${label}.png` });
  await testInfo.attach(label, { body: screenshot, contentType: 'image/png' });
}

test.describe('first screen — default font scale', () => {
  test.use({ viewport: IPHONE_13_MINI });

  test('control arm (before)', async ({ page }, testInfo) => {
    await captureArm(page, testInfo, 'control', 'before-control-1x');
  });

  test('poster_first arm (after)', async ({ page }, testInfo) => {
    await captureArm(page, testInfo, 'poster_first', 'after-poster-first-1x');

    // The inversion this whole change exists for, asserted rather than
    // left to the eye: poster copy is present and is the primary CTA.
    await expect(page.getByText('Name your price')).toBeVisible();
    await expect(page.getByText("I'd rather earn")).toBeVisible();
    await expect(page.getByText("You've walked past it four hundred times.")).toBeVisible();

    // Removed trust rows must not survive on this screen.
    await expect(page.getByText('You set the price')).toHaveCount(0);
    await expect(page.getByText(/money stays protected/)).toHaveCount(0);

    // Log In is unchanged and still present.
    await expect(page.getByText('Log In')).toBeVisible();
  });
});

test.describe('first screen — 1.3x font scale', () => {
  test.use({ viewport: IPHONE_13_MINI, deviceScaleFactor: 1.3 });

  test('control arm (before)', async ({ page }, testInfo) => {
    await captureArm(page, testInfo, 'control', 'before-control-1.3x');
  });

  test('poster_first arm (after)', async ({ page }, testInfo) => {
    await captureArm(page, testInfo, 'poster_first', 'after-poster-first-1.3x');

    // All three buttons must still be reachable without scrolling at 1.3x.
    for (const label of ['Name your price', "I'd rather earn", 'Log In']) {
      const button = page.getByText(label);
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, `${label} has no layout box`).not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(IPHONE_13_MINI.height);
    }
  });
});
