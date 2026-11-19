#!/usr/bin/env node
/**
 * Journey 5 on the STAGING export (second-pass senior audit, 2026-11-16):
 * the fixture's "Pick up my dry cleaning" job (work submitted with a photo)
 * -> Check the work -> Approve and pay -> drag the slide -> rate -> the job's
 * final state. Moves STAGING TEST funds only (the pool poster's test wallet
 * escrow to a pool hunter). Re-run senior-second-pass-fixture.mjs to restore.
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/senior-second-pass-complete.mjs --slot 10 --cleaning <id> [--out dir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { derivePassword, poolAccount } from '../bin/lib/accounts.mjs';
import {
  assertSafeTarget,
  expectedRefForAppEnv,
  loadConfig,
  printEvidence,
  resolveEnv,
} from '../bin/lib/env.mjs';

const BASE = process.env.BOUNTY_SHOAL_URL || 'http://localhost:8090';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) process.exit(2);
const config = loadConfig();
const target = { ...resolveEnv(config, 'staging'), url: BASE };
printEvidence(
  await assertSafeTarget(config, target, {
    requiredSupabaseRef: expectedRefForAppEnv('staging'),
    requireStripeTestKey: true,
  }),
);
const args = process.argv.slice(2);
const opt = n => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = opt('cleaning');
const out = path.resolve(opt('out') || 'qa/shoal/artifacts/senior-second-pass-complete');
mkdirSync(out, { recursive: true });
const acct = poolAccount('poster', Number(opt('slot') || 10));
const VIEW = { width: 390, height: 844 };
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: 2 });
const log = [];
let n = 0;
const shot = async (name, note) => {
  n += 1;
  const file = String(n).padStart(2, '0') + '-' + name + '.png';
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(out, file) });
  log.push({ step: n, name, note, file });
  console.log('  ' + file);
};
try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(acct.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(process.env.BOUNTY_SHOAL_POOL_SECRET, acct.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.goto(BASE + '/postings/' + id, { waitUntil: 'networkidle' });
  await shot('job', 'Work submitted');
  await page.getByLabel(/^Check the work$/).last().click();
  await page.getByText(/^Approve and pay \$/).last().waitFor({ timeout: 20000 });
  await shot('sheet', 'Check the work');
  await page.getByText(/^Approve and pay \$/).last().click();
  await shot('confirm', 'Pay …? cannot be undone');
  // Drag the slide handle to the end of its track.
  const handle = page.getByLabel(/^Slide to approve and pay$/).last();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let x = 0; x <= 360; x += 20) await page.mouse.move(box.x + box.width / 2 + x, box.y + box.height / 2, { steps: 2 });
  await page.mouse.up();
  await page.getByText(/^Work approved\./).first().waitFor({ timeout: 45000 });
  await shot('approved-rating', 'After the slide: approved banner + rating');
  await page.getByLabel(/^5 stars$/).last().click();
  await page.getByLabel(/^Submit review$/).last().click();
  await page.waitForTimeout(3000);
  await shot('after-review', 'After Submit review');
  const ok = page.getByText(/^OK$/).last();
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await page.goto(BASE + '/postings/' + id, { waitUntil: 'networkidle' });
  await shot('final', 'The finished job');
} finally {
  writeFileSync(path.join(out, 'walkthrough.json'), JSON.stringify({ account: acct.email, steps: log }, null, 2));
  await browser.close();
}
