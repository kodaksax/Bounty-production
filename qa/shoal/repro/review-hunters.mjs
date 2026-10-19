#!/usr/bin/env node
/**
 * Reproduction for SBA-12 (docs/audits/shoal-behavioral-audit.md): a poster taps
 * "Review hunters" on /postings/:id — does it reach their applications or the feed?
 *
 * Read-only: signs in as a staging pool poster, navigates and reads the screen. It never
 * accepts, declines or edits anything. Targets the locally served staging export only
 * (`npm run qa:shoal:web`), never production.
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/review-hunters.mjs <bountyId> [slot]
 *
 * <bountyId> must be an open bounty owned by pool poster <slot> (default 4) with at
 * least one pending application (seed.mjs status / the staging database).
 * Exit code 0 = landed on My Bounties, 1 = landed somewhere else.
 *
 * Since #921 every main tab stays mounted side by side in a horizontal pager, and both
 * Inbox segment labels are always rendered, so "is the text in the DOM" no longer says
 * where the poster is. This checks what is inside the viewport and which Inbox segment
 * is selected. The segment buttons are role="tab", but react-native-web does not emit
 * aria-selected for them, so the selected one is the label drawn in the active colour
 * (white; the other is grey — see SegmentLabel in app/tabs/inbox-screen.tsx).
 */
import { chromium } from 'playwright';
import { derivePassword, poolAccount } from '../bin/lib/accounts.mjs';

const BASE = process.env.BOUNTY_SHOAL_URL || 'http://localhost:8090';
const [bountyId, slotArg] = process.argv.slice(2);
if (!bountyId) {
  console.error('usage: node qa/shoal/repro/review-hunters.mjs <bountyId> [slot]');
  process.exit(2);
}
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('refusing: this repro only targets the locally served staging export');
  process.exit(2);
}
const secret = process.env.BOUNTY_SHOAL_POOL_SECRET;
if (!secret) {
  console.error('BOUNTY_SHOAL_POOL_SECRET is required (the same value seed.mjs used)');
  process.exit(2);
}

const account = poolAccount('poster', Number(slotArg || 4));
const VIEWPORT = { width: 390, height: 844 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
// On screen = laid out inside the viewport, not just present on an off-screen pager page.
const onScreen = async (locator) => {
  const box = await locator.boundingBox({ timeout: 2000 }).catch(() => null);
  return !!box && box.width > 0 && box.x > -1 && box.x + box.width < VIEWPORT.width + 1;
};
const anyOnScreen = async (locator) => {
  for (const l of await locator.all()) if (await onScreen(l)) return true;
  return false;
};

try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 30000 });

  await page.goto(BASE + '/postings/' + bountyId, { waitUntil: 'networkidle' });
  await page.getByText(/Review hunters/).last().click({ timeout: 30000 });
  await page.waitForTimeout(4000);

  const url = new URL(page.url());
  const onFeed = await anyOnScreen(page.getByText(/For You/i));
  const myBounties = page.getByRole('tab', { name: /^My Bounties/ });
  const inboxOnScreen = await anyOnScreen(myBounties);
  const labelColor = (tab) =>
    tab
      .first()
      .evaluate((el) => {
        if (el.getAttribute('aria-selected')) return el.getAttribute('aria-selected') === 'true' ? 'selected' : 'not';
        const leaf = [...el.querySelectorAll('*')].find((n) => n.childElementCount === 0 && n.textContent);
        return leaf ? getComputedStyle(leaf).color : null;
      })
      .catch(() => null);
  const ACTIVE = new Set(['selected', 'rgb(255, 255, 255)']);
  const myBountiesSelected =
    ACTIVE.has(await labelColor(myBounties)) &&
    !ACTIVE.has(await labelColor(page.getByRole('tab', { name: /^My Work/ })));
  const onMyBounties = inboxOnScreen && myBountiesSelected;
  console.log(
    JSON.stringify({
      url: url.pathname + url.search,
      tabParam: url.searchParams.get('tab'),
      onFeed,
      inboxOnScreen,
      myBountiesSelected,
      onMyBounties,
    }),
  );
  process.exitCode = onMyBounties && !onFeed ? 0 : 1;
} finally {
  await browser.close();
}
