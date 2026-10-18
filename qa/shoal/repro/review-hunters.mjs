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
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const isVisible = (re) => page.getByText(re).first().isVisible().catch(() => false);

try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 30000 });

  await page.goto(BASE + '/postings/' + bountyId, { waitUntil: 'networkidle' });
  await page.getByText(/Review hunters/).last().click({ timeout: 30000 });
  await page.waitForTimeout(4000);

  const onFeed = await isVisible(/For You/i);
  const onMyBounties = await isVisible(/MY BOUNTIES/);
  console.log(JSON.stringify({ url: page.url(), onFeed, onMyBounties }));
  process.exitCode = onMyBounties && !onFeed ? 0 : 1;
} finally {
  await browser.close();
}
