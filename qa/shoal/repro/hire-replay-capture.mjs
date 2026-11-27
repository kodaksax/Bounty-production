#!/usr/bin/env node
/**
 * Replay the hire ONCE on a "[shoal] hire-replay ..." job (e2e-audit-fixture.mjs
 * --hired-seed) on the locally served STAGING export, Stripe test mode, and record
 * what the poster sees from "Looks good" on (E2E-05).
 *
 * Refuses unless the bundle talks only to staging with a Stripe test key, and unless
 * the job on screen is titled "[shoal] hire-replay ...". Taps "See this person",
 * "Choose <name>", then "Looks good" once (the balance covers it). From that tap it
 * samples every --interval ms for --duration ms: the quick-confirm button, the job
 * page's stage and whether the hire banner is up. Then it reloads (the banner must
 * still be there), dismisses it, and reloads again (it must be gone).
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/hire-replay-capture.mjs \
 *     --slot 11 --job <bountyId> --out <dir> [--interval 250] [--duration 15000]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { derivePassword, poolAccount } from '../bin/lib/accounts.mjs';
import { expectedRefForAppEnv } from '../bin/lib/env.mjs';

const BASE = process.env.BOUNTY_SHOAL_URL || 'http://localhost:8090';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('refusing: only the locally served staging export');
  process.exit(2);
}
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const secret = process.env.BOUNTY_SHOAL_POOL_SECRET;
if (!secret) throw new Error('BOUNTY_SHOAL_POOL_SECRET is required');
const jobId = opt('job');
if (!jobId) throw new Error('--job is required');
const account = poolAccount('poster', Number(opt('slot', '11')));
const interval = Number(opt('interval', '250'));
const duration = Number(opt('duration', '15000'));
const out = path.resolve(opt('out', 'qa/shoal/artifacts/hire-replay'));
mkdirSync(out, { recursive: true });

// ── Guard: the served bundle must talk only to staging, with a Stripe test key ──
{
  const html = await (await fetch(BASE + '/')).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
  let sources = '';
  for (const src of scripts) sources += await (await fetch(new URL(src, BASE))).text();
  const refs = new Set([...sources.matchAll(/([a-z]{20})\.supabase\.co/g)].map((m) => m[1]));
  const keys = new Set([...sources.matchAll(/pk_(?:live|test)_[A-Za-z0-9]{6}/g)].map((m) => m[0]));
  const staging = expectedRefForAppEnv('staging');
  if (refs.size !== 1 || !refs.has(staging)) {
    console.error('refusing: bundle Supabase refs are ' + [...refs].join(',') + ', expected only ' + staging);
    process.exit(2);
  }
  if (keys.size === 0 || [...keys].some((k) => !k.startsWith('pk_test_'))) {
    console.error('refusing: bundle must carry only a Stripe test key');
    process.exit(2);
  }
  console.log('  guard: supabase ' + staging + ' only, stripe ' + [...keys].join(',') + '\n');
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const frames = [];
const sample = () =>
  page.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const text = (el) => (el ? el.innerText.replace(/\s+/g, ' ').trim() : null);
    return {
      quick: text(q('quick-confirm-yes')),
      header: text(q('workspace-header')),
      now: q('four-questions') ? q('four-questions').innerText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ') : null,
      banner: text(q('hire-banner')),
    };
  });
const label = (f) => [f.quick && `button "${f.quick}"`, f.banner && `banner "${f.banner.slice(0, 60)}"`, f.now && `stage "${f.now.slice(0, 80)}"`].filter(Boolean).join(' · ') || 'nothing yet';

try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.goto(BASE + '/postings/' + jobId, { waitUntil: 'networkidle' });
  await page.getByText(/wants to help/).first().waitFor({ timeout: 30000 });
  const title = await page.locator('[data-testid="workspace-header"]').innerText();
  if (!/\[shoal\] hire-replay /.test(title)) {
    console.error('refusing: the job on screen is not a "[shoal] hire-replay" job: ' + title.slice(0, 120));
    process.exit(2);
  }
  await page.getByRole('button', { name: /^See this person$/ }).first().click();
  const choose = page.getByTestId('person-choose');
  await choose.waitFor({ timeout: 15000 });
  await choose.click();
  const yes = page.getByTestId('quick-confirm-yes');
  await yes.waitFor({ timeout: 20000 });
  await page.waitForFunction(() => !/Checking payment/.test(document.querySelector('[data-testid="quick-confirm-yes"]')?.textContent ?? ''), null, { timeout: 20000 });
  await page.screenshot({ path: path.join(out, 'hire-01-quick-confirm-390x844.png') });
  const t0 = Date.now();
  await yes.click(); // the one hire (test-mode balance)
  let shotBusy = false;
  let shotBanner = false;
  while (Date.now() - t0 < duration) {
    const at = Date.now() - t0;
    const f = await sample().catch(() => ({}));
    frames.push({ at, ...f });
    if (!shotBusy && /Choosing/.test(f.quick ?? '')) {
      shotBusy = true;
      await page.screenshot({ path: path.join(out, 'hire-02-busy-390x844.png') });
    }
    if (!shotBanner && f.banner && f.now) {
      shotBanner = true;
      await page.screenshot({ path: path.join(out, 'hire-03-banner-hired-390x844.png') });
    }
    const wait = t0 + frames.length * interval - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  // Reload: the banner must still be there.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('workspace-header').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const afterReload = await sample();
  frames.push({ at: 'after reload', ...afterReload });
  await page.screenshot({ path: path.join(out, 'hire-04-after-reload-390x844.png') });
  await page.setViewportSize({ width: 195, height: 422 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, 'hire-05-after-reload-195x422.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  // Dismiss, reload: gone.
  await page.getByTestId('hire-banner-dismiss').click();
  await page.waitForTimeout(500);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByTestId('workspace-header').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const afterDismiss = await sample();
  frames.push({ at: 'after dismiss + reload', ...afterDismiss });
} finally {
  const lines = [];
  let prev = '';
  for (const f of frames) {
    const k = label(f);
    if (k !== prev || typeof f.at === 'string') lines.push(`${String(f.at).padStart(22)}  ${k}`);
    prev = k;
  }
  const working = frames.filter((f) => /working on your job|don't need to do anything/.test(f.now ?? ''));
  const summary = {
    frames: frames.length,
    busyFrames: frames.filter((f) => /Choosing/.test(f.quick ?? '')).length,
    firstBannerAt: frames.find((f) => f.banner)?.at ?? null,
    workingFrames: working.length,
    bannerAfterReload: !!frames.find((f) => f.at === 'after reload')?.banner,
    bannerAfterDismiss: !!frames.find((f) => f.at === 'after dismiss + reload')?.banner,
  };
  writeFileSync(path.join(out, 'hire-replay.json'), JSON.stringify({ jobId, summary, frames }, null, 2));
  console.log(lines.join('\n'));
  console.log('\n  ' + JSON.stringify(summary));
  await browser.close();
}
