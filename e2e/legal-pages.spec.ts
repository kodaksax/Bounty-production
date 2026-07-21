import { expect, test } from '@playwright/test';
import { gotoAndCapture } from './utils/ui-inspector';

// These routes render static content with no auth/network dependency, which
// makes them reliable smoke-test targets for verifying navigation + content
// render correctly under react-native-web.
const LEGAL_PAGES: Array<{ path: string; heading: string }> = [
  { path: '/legal/privacy', heading: 'Privacy Policy' },
  { path: '/legal/terms', heading: 'Terms of Service' },
  { path: '/legal/community-guidelines', heading: /community guidelines/i },
];

for (const { path, heading } of LEGAL_PAGES) {
  test(`${path} loads and shows its heading`, async ({ page }, testInfo) => {
    await gotoAndCapture(page, testInfo, path, `${path.replace(/\//g, '-')}-screen`);
    await expect(page.getByText(heading).first()).toBeVisible();
  });
}
