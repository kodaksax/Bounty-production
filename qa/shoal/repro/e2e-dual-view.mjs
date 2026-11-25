#!/usr/bin/env node
/**
 * READ-ONLY phone-size capture of the same job from either side of the transaction
 * (senior-inclusive E2E audit, 2026-11-24). Locally served STAGING export only.
 *
 * Signs in as one pool account, visits each route given, and records for every screen:
 * a screenshot, the visible text, text under 14px, and touch targets under 44px. It
 * never taps anything that changes state -- it only navigates by URL.
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/e2e-dual-view.mjs \
 *     --role poster --slot 8 --out <dir> --label s08-poster \
 *     --routes "home=/tabs/bounty-app,job=/postings/<id>"
 *   [--width 390 --height 844]   (use 195x422 to approximate 200% text zoom)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { derivePassword, poolAccount } from '../bin/lib/accounts.mjs';
import { assertSafeTarget, expectedRefForAppEnv, loadConfig, printEvidence, resolveEnv } from '../bin/lib/env.mjs';

const BASE = process.env.BOUNTY_SHOAL_URL || 'http://localhost:8090';
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('refusing: only the locally served staging export');
  process.exit(2);
}
const config = loadConfig();
printEvidence(
  await assertSafeTarget(config, { ...resolveEnv(config, 'staging'), url: BASE }, {
    requiredSupabaseRef: expectedRefForAppEnv('staging'),
    requireStripeTestKey: true,
  }),
);
const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const secret = process.env.BOUNTY_SHOAL_POOL_SECRET;
if (!secret) throw new Error('BOUNTY_SHOAL_POOL_SECRET is required');
const role = opt('role', 'poster');
const account = poolAccount(role, Number(opt('slot', '8')));
const label = opt('label', role + '-' + account.slot);
const out = path.resolve(opt('out', 'qa/shoal/artifacts/e2e-dual-view'));
mkdirSync(out, { recursive: true });
const VIEWPORT = { width: Number(opt('width', '390')), height: Number(opt('height', '844')) };
const routes = opt('routes', 'home=/tabs/bounty-app')
  .split(',')
  .map((r) => r.split('='))
  .map(([name, p]) => ({ name, p }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)));

const scan = () =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const onScreen = (r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < vw && r.bottom > 0 && r.top < vh;
    const seen = new Set();
    const text = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount !== 0) continue;
      const t = (el.textContent || '').trim();
      if (!t || seen.has(t)) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0' || !onScreen(el.getBoundingClientRect())) continue;
      seen.add(t);
      text.push({ t, px: parseFloat(cs.fontSize), color: cs.color });
    }
    const small = [];
    for (const el of document.querySelectorAll('[role="button"], button, a[href]')) {
      const r = el.getBoundingClientRect();
      if (!onScreen(r)) continue;
      if (r.height < 44 || r.width < 44) {
        small.push({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    return { text, small, scrollHeight: document.scrollingElement?.scrollHeight ?? 0 };
  });

const log = [];
try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.waitForTimeout(4000);
  for (const [i, r] of routes.entries()) {
    if (r.p !== '/tabs/bounty-app' || i > 0) await page.goto(BASE + r.p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3500);
    for (const re of [/^Not now$/, /^Later$/]) {
      const b = page.getByText(re).first();
      if (await b.isVisible().catch(() => false)) {
        await b.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    }
    const file = label + '-' + String(i + 1).padStart(2, '0') + '-' + r.name + '.png';
    await page.screenshot({ path: path.join(out, file), fullPage: true });
    const s = await scan();
    log.push({
      label, route: r.p, name: r.name, file, url: new URL(page.url()).pathname,
      text: s.text.map((l) => l.t),
      smallText: s.text.filter((l) => l.px < 14).map((l) => l.t + ' (' + l.px + 'px)'),
      smallTargets: s.small,
    });
    console.log('  ' + file + '  -> ' + new URL(page.url()).pathname + '  text ' + s.text.length + ', <14px ' +
      log.at(-1).smallText.length + ', <44px targets ' + s.small.length);
  }
} finally {
  writeFileSync(path.join(out, label + '.json'), JSON.stringify({ viewport: VIEWPORT, account: account.email, pageErrors, log }, null, 2));
  await browser.close();
}
