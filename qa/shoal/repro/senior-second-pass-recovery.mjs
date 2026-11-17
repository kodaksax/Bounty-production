#!/usr/bin/env node
/**
 * Journey 6 on the STAGING export (second-pass senior audit, 2026-11-16):
 * the silent-helper job -> "Tell us … hasn't replied" -> the report screen
 * (reason preselected), and Get help -> "Have Bounty help me" -> the support
 * form, ready-written. Stops before submitting anything.
 * With --garage it also chooses someone and captures the screen shown while
 * the hire is being confirmed (staging test funds).
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/senior-second-pass-recovery.mjs --slot 11 --tap <id> [--garage <id>] [--out dir]
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { derivePassword, poolAccount } from '../bin/lib/accounts.mjs';

const BASE = process.env.BOUNTY_SHOAL_URL || 'http://localhost:8090';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) process.exit(2);
const args = process.argv.slice(2);
const opt = n => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = path.resolve(opt('out') || 'qa/shoal/artifacts/senior-second-pass-recovery');
mkdirSync(out, { recursive: true });
const acct = poolAccount('poster', Number(opt('slot') || 11));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
let n = 0;
const shot = async (name, wait = 1500) => {
  n += 1;
  await page.waitForTimeout(wait);
  const file = String(n).padStart(2, '0') + '-' + name + '.png';
  await page.screenshot({ path: path.join(out, file) });
  console.log('  ' + file + '  ' + new URL(page.url()).pathname + new URL(page.url()).search);
};
const signIn = async () => {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(acct.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(process.env.BOUNTY_SHOAL_POOL_SECRET, acct.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
};
try {
  await signIn();
  const tap = opt('tap');
  await page.goto(BASE + '/postings/' + tap, { waitUntil: 'networkidle' });
  await page.getByText(/^Haven't heard from /).first().waitFor({ timeout: 20000 });
  await shot('silent');
  await page.getByLabel(/^Tell us .* hasn't replied$/).last().click();
  await shot('report-screen', 3000);
  await page.goto(BASE + '/postings/' + tap, { waitUntil: 'networkidle' });
  await page.getByLabel(/^Get help with this job$/).last().click();
  await shot('help-sheet');
  await page.getByText(/^Have Bounty help me with this job$/).last().click();
  await shot('assist-form', 2500);

  if (opt('garage')) {
    await page.goto(BASE + '/postings/' + opt('garage'), { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    await page.getByLabel(/^Choose shoal_hunter_/).first().click();
    await page.getByText(/^Confirm & hire$/).last().click({ timeout: 20000 });
    await shot('choosing', 300);
    await page.getByText(/^You've chosen /).first().waitFor({ timeout: 45000 });
    await shot('chosen', 500);
  }
} finally {
  await browser.close();
}
