#!/usr/bin/env node
/**
 * Phone-size walkthrough of the redesigned poster job page (second-pass senior
 * audit, 2026-11-16), against the locally served STAGING export only.
 *
 * Uses the jobs built by senior-second-pass-fixture.mjs for one pool slot:
 *   garage   open, three offers         -> next step, offers, Get help, money
 *   tap      hired 4 days ago, silent   -> "Haven't heard from …?"
 *   cleaning work submitted with photo  -> Check the work -> confirm step (never slid)
 *
 * Read-only by default. With --hire it chooses the first offer on the garage job
 * through the real pay sheet ("Confirm & hire": the pool poster's TEST balance on
 * staging covers it, so no card is involved) to capture "You've chosen …". Re-run
 * the fixture afterwards to restore the slot.
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/senior-second-pass-screens.mjs \
 *     --slot 8 --garage <id> --tap <id> --cleaning <id> [--hire] [--out dir]
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
if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) {
  console.error('refusing: this walkthrough only targets the locally served staging export');
  process.exit(2);
}
const config = loadConfig();
const target = { ...resolveEnv(config, 'staging'), url: BASE };
printEvidence(
  await assertSafeTarget(config, target, {
    requiredSupabaseRef: expectedRefForAppEnv('staging'),
    requireStripeTestKey: true,
  }),
);
const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const secret = process.env.BOUNTY_SHOAL_POOL_SECRET;
if (!secret) {
  console.error('BOUNTY_SHOAL_POOL_SECRET is required');
  process.exit(2);
}
const ids = { garage: opt('garage'), tap: opt('tap'), cleaning: opt('cleaning') };
const out = path.resolve(opt('out') || 'qa/shoal/artifacts/senior-second-pass-screens');
mkdirSync(out, { recursive: true });
const account = poolAccount('poster', Number(opt('slot') || 8));
const VIEWPORT = { width: Number(opt('width') || 390), height: Number(opt('height') || 844) };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push(String(e)));
const log = [];
let n = 0;

const visibleText = () =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const seen = new Set();
    const lines = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount !== 0) continue;
      const t = (el.textContent || '').trim();
      if (!t || seen.has(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.right < 0 || r.left > vw || r.bottom < 0 || r.top > vh) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      seen.add(t);
      lines.push({ t, px: parseFloat(cs.fontSize) });
    }
    return lines;
  });

/** Every button on screen smaller than 44px in either direction (a touch-target check). */
const smallTargets = () =>
  page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const hits = [];
    for (const el of document.querySelectorAll('[role="button"], button')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
      if (r.height < 44 || r.width < 44) hits.push({ label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) });
    }
    return hits;
  });

async function shot(name, note, { fullPage = false } = {}) {
  n += 1;
  const file = String(n).padStart(2, '0') + '-' + name + '.png';
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(out, file), fullPage });
  const text = await visibleText();
  const jargon = text.map(l => l.t).filter(t => /\b(hunters?|escrow|payouts?|applicants?)\b/i.test(t) || /\bbount(y|ies)\b/.test(t));
  log.push({
    step: n,
    name,
    note,
    url: new URL(page.url()).pathname + new URL(page.url()).search,
    file,
    text: text.map(l => l.t),
    smallText: text.filter(l => l.px < 14).map(l => `${l.t} (${l.px}px)`),
    jargon,
    smallTargets: await smallTargets(),
  });
  console.log('  ' + file + '  ' + log.at(-1).url + (jargon.length ? '  jargon: ' + jargon.join(' | ') : ''));
}

const visible = async re => {
  for (const l of await page.getByText(re).all()) {
    const b = await l.boundingBox().catch(() => null);
    if (b && b.x >= 0 && b.x + b.width <= VIEWPORT.width + 1 && b.y >= 0 && b.y < VIEWPORT.height) return l;
  }
  return null;
};
const tap = async re => {
  const l = (await visible(re)) ?? page.getByText(re).last();
  await l.click({ timeout: 15000 });
};
const label = async re => {
  const l = page.getByLabel(re).last();
  await l.click({ timeout: 15000 });
};

try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.waitForTimeout(5000);
  const notNow = await visible(/^Not now$/);
  if (notNow) await notNow.click();
  await shot('home', 'Home: the poster\'s own jobs card');

  if (ids.garage) {
    await page.goto(BASE + '/postings/' + ids.garage, { waitUntil: 'networkidle' });
    await shot('garage-top', 'Job page, three offers: what a poster sees first');
    await shot('garage-full', 'Same page, full length', { fullPage: true });
    await label(/^Compare the 3 offers$/);
    await shot('garage-offers', 'After "Compare the 3 offers": the offers on this page');
    await label(/^Get help with this job$/);
    await shot('garage-help', 'Get help with this job (open job)');
    await tap(/^Where is my money\?$/);
    await shot('garage-help-money', '"Where is my money?" answered in place');
    await label(/^Close$/);

    if (args.includes('--hire')) {
      await page.goto(BASE + '/postings/' + ids.garage, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2500);
      const choose = page.getByLabel(/^Choose shoal_hunter_/).first();
      const who = (await choose.getAttribute('aria-label')).replace(/^Choose /, '');
      await choose.click();
      await shot('hire-pay-sheet', 'The pay sheet after "Choose ' + who + '"');
      const confirm = await visible(/^(Confirm & hire|Pay .* & hire)$/);
      if (confirm) {
        await confirm.click();
        await page.getByText(/^You've chosen /).first().waitFor({ timeout: 45000 });
        await shot('hire-confirmation', 'After the server confirmed the hire');
        await label(/^Back to my job$/);
        await shot('hired-job', 'The job page right after hiring', { fullPage: true });
      } else {
        log.push({ step: ++n, name: 'hire-no-confirm-button', note: 'No Confirm & hire button on the pay sheet' });
      }
    }
  }

  if (ids.tap) {
    await page.goto(BASE + '/postings/' + ids.tap, { waitUntil: 'networkidle' });
    await shot('silent-top', 'Hired 4 days ago, no word since');
    await shot('silent-full', 'Same page, full length', { fullPage: true });
    await label(/^Get help with this job$/);
    await shot('silent-help', 'Get help with this job (hired job)');
    await label(/^Close$/);
  }

  if (ids.cleaning) {
    await page.goto(BASE + '/postings/' + ids.cleaning, { waitUntil: 'networkidle' });
    await shot('review-top', 'Work submitted, waiting on the poster');
    await shot('review-full', 'Same page, full length', { fullPage: true });
    await label(/^Check the work$/);
    await page.waitForTimeout(2500);
    await shot('review-sheet', 'Check the work: message and photo');
    await tap(/^Approve and pay \$/);
    await shot('review-confirm', 'The confirm step (the slide is NOT completed)');
  }
} finally {
  writeFileSync(
    path.join(out, 'walkthrough.json'),
    JSON.stringify({ account: account.email, viewport: VIEWPORT, consoleErrors, steps: log }, null, 2)
  );
  await browser.close();
}
