#!/usr/bin/env node
/**
 * Pay ONE "[shoal] pay-replay ..." job once on the locally served STAGING export (Stripe
 * test mode) and record what the job page says from the "Yes, pay" tap onward (E2E-01).
 * The job comes from pay-replay-fixture.mjs (insert-only).
 *
 * It refuses unless the served bundle talks only to staging with a Stripe test key, and
 * unless the job on screen is titled "[shoal] pay-replay ...". It taps, in order:
 * "Review the completed work", "Approve and pay ...", then "Yes, pay ..." exactly once.
 * From that tap it samples the page every --interval ms for --duration ms. At
 * --close-at ms it closes the rating sheet ("Skip rating for now") to check that
 * opening or closing the sheet can't reset the stage.
 *
 * Each frame is placed on the line review (Step 4, the server hasn't recorded the
 * approval yet) < paying < finished. Wrong frame: Step 1-3, "Work underway" or
 * "working" / "Doing the work", any move back along that line, or an error message.
 *
 * With --helper-slot, the helper's own job page is opened in a second browser before
 * the tap and sampled side by side (their device during the same payment).
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/pay-replay-capture.mjs \
 *     --slot 11 --helper-slot 12 --job <bountyId> --out <dir>
 *     [--interval 250] [--duration 30000] [--close-at 8000]
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
const duration = Number(opt('duration', '30000'));
const closeAt = Number(opt('close-at', '8000'));
const out = path.resolve(opt('out', 'qa/shoal/artifacts/pay-replay'));
mkdirSync(out, { recursive: true });
const VIEWPORT = { width: Number(opt('width', '390')), height: Number(opt('height', '844')) };

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

const helperSlot = opt('helper-slot');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const helperPage = helperSlot ? await (await browser.newContext({ viewport: VIEWPORT })).newPage() : null;
// The poster's page at 195x422 CSS px (the audit's stand-in for 200% text), for the
// paying-stage screenshot only.
const smallPage = await (await browser.newContext({ viewport: { width: 195, height: 422 }, deviceScaleFactor: 2 })).newPage();
const shots = new Set();
async function shotOnce(name, p) {
  if (shots.has(name)) return;
  shots.add(name);
  await p.screenshot({ path: path.join(out, name) }).catch(() => {});
}
const frames = [];
const sample = (p = page) =>
  p.evaluate(() => {
    const header = document.querySelector('[data-testid="workspace-header"]');
    const four = document.querySelector('[data-testid="four-questions"]');
    const body = (document.body?.innerText ?? '').replace(/\s+/g, ' ');
    return {
      header: header ? header.innerText.replace(/\s+/g, ' ').trim() : null,
      now: four ? four.innerText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ') : null,
      error: /didn't go through|couldn't|Something went wrong|not confirmed/i.test(body) ? body.slice(0, 200) : null,
    };
  });
const LINE = { review: 1, paying: 2, finished: 3 };
/** Where one frame sits; `side` picks the poster's or the helper's words. */
const place = (f, side) => {
  const text = `${f.header ?? ''} ${f.now ?? ''}`;
  if (f.error) return 'error';
  if (/Step [1-3] of 5|Work underway|working on your job|Doing the work|on the clock/i.test(text)) return 'wrong';
  if (side === 'poster') {
    if (/Paying |confirming the payment/i.test(text)) return 'paying';
    if (/Done\. Released|Step 5 of 5 · Finished/.test(text)) return 'finished';
  } else {
    if (/approved your work\.|confirming the payment|Payment on its way/i.test(text) && !/You earned/.test(text)) return 'paying';
    if (/You earned|Step 5 of 5 · Finished/.test(text)) return 'finished';
  }
  if (/Step 4 of 5/.test(text)) return 'review';
  return f.header ? 'other' : 'none';
};
const highest = { poster: 0, helper: 0 };
const judge = (f, side) => {
  const v = place(f, side);
  const rank = LINE[v];
  if (rank) {
    if (rank < highest[side]) return 'wrong'; // moved back along the line
    highest[side] = rank;
  }
  return v;
};

try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.goto(BASE + '/postings/' + jobId, { waitUntil: 'networkidle' });
  await page.getByText(/says the job is done/).first().waitFor({ timeout: 30000 });
  const title = await page.locator('[data-testid="workspace-header"]').innerText();
  if (!/\[shoal\] pay-replay /.test(title)) {
    console.error('refusing: the job on screen is not a "[shoal] pay-replay" job: ' + title.slice(0, 120));
    process.exit(2);
  }
  await page.screenshot({ path: path.join(out, 'pay-replay-01-before.png') });
  {
    await smallPage.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
    await smallPage.locator('input').nth(0).fill(account.email);
    await smallPage.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
    await smallPage.getByRole('button', { name: /^sign in$/i }).first().click();
    await smallPage.waitForURL(/\/tabs\//, { timeout: 45000 });
    await smallPage.goto(BASE + '/postings/' + jobId, { waitUntil: 'networkidle' });
  }
  if (helperPage) {
    const h = poolAccount('hunter', Number(helperSlot));
    await helperPage.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
    await helperPage.locator('input').nth(0).fill(h.email);
    await helperPage.locator('input[type="password"]').first().fill(derivePassword(secret, h.email));
    await helperPage.getByRole('button', { name: /^sign in$/i }).first().click();
    await helperPage.waitForURL(/\/tabs\//, { timeout: 45000 });
    await helperPage.goto(BASE + '/in-progress/' + jobId + '/hunter', { waitUntil: 'networkidle' });
    await helperPage.getByText(/Step 4 of 5/).first().waitFor({ timeout: 30000 });
  }
  await page.getByRole('button', { name: 'Review the completed work' }).first().click();
  const approve = page.getByRole('button', { name: /^Approve and pay / }).first();
  await approve.waitFor({ timeout: 20000 });
  await approve.click();
  const yes = page.getByRole('button', { name: /^Yes, pay / }).first();
  await yes.waitFor({ timeout: 10000 });
  const t0 = Date.now();
  await yes.click(); // the one money-moving tap (Stripe test mode)
  let closed = false;
  while (Date.now() - t0 < duration) {
    const at = Date.now() - t0;
    if (!closed && at >= closeAt) {
      const skip = page.getByLabel('Skip rating for now').first();
      if (await skip.isVisible().catch(() => false)) {
        await skip.click().catch(() => {});
        frames.push({ at, event: 'closed the rating sheet' });
      }
      closed = true;
    }
    const f = await sample().catch(() => ({ header: null, now: null, error: null }));
    const pv = judge(f, 'poster');
    frames.push({ at, side: 'poster', verdict: pv, ...f });
    if (pv === 'paying') {
      await shotOnce('pay-replay-paying-poster-390x844.png', page);
      const sf = await sample(smallPage).catch(() => ({ header: null, now: null }));
      if (place(sf, 'poster') === 'paying') await shotOnce('pay-replay-paying-poster-195x422.png', smallPage);
    }
    if (pv === 'finished') await shotOnce('pay-replay-finished-poster-390x844.png', page);
    if (helperPage) {
      const hf = await sample(helperPage).catch(() => ({ header: null, now: null, error: null }));
      const hv = judge(hf, 'helper');
      frames.push({ at, side: 'helper', verdict: hv, ...hf });
      if (hv === 'paying') await shotOnce('pay-replay-paying-helper-390x844.png', helperPage);
    }
    const ticks = frames.filter((x) => x.side === 'poster').length;
    const wait = t0 + ticks * interval - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
  }
  await page.screenshot({ path: path.join(out, 'pay-replay-02-after.png') });
  if (helperPage) await helperPage.screenshot({ path: path.join(out, 'pay-replay-03-helper-after.png') });
} finally {
  const transitions = [];
  const summary = {};
  for (const side of helperPage ? ['poster', 'helper'] : ['poster']) {
    const counted = frames.filter((f) => f.side === side);
    const by = (v) => counted.filter((f) => f.verdict === v);
    let prev = '';
    for (const f of frames.filter((x) => x.event || x.side === side)) {
      const k = f.event ?? `${side} ${f.verdict} | ${(f.now ?? f.header ?? '').slice(0, 80)}`;
      if (k !== prev) transitions.push(`${String(f.at).padStart(6)}ms  ${k}`);
      prev = k;
    }
    summary[side] = {
      frames: counted.length,
      wrong: by('wrong').length,
      errors: by('error').length,
      review: by('review').length,
      paying: by('paying').length,
      finished: by('finished').length,
      firstPayingAt: by('paying')[0]?.at ?? null,
      firstFinishedAt: by('finished')[0]?.at ?? null,
    };
  }
  writeFileSync(path.join(out, 'pay-replay.json'), JSON.stringify({ jobId, viewport: VIEWPORT, summary, transitions, frames }, null, 2));
  console.log(transitions.join('\n'));
  console.log('\n  ' + JSON.stringify(summary));
  await browser.close();
}
