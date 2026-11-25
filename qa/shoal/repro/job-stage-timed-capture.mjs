#!/usr/bin/env node
/**
 * READ-ONLY timed capture of what a job page says while it loads (E2E-01, the
 * 2026-11-24 Whole-Job Test's "s11" capture). Locally served STAGING export only.
 *
 * Signs in as one pool account, then cold-opens one route N times. Each open is a
 * full page load; from the moment navigation starts it samples the screen every
 * --interval ms for --duration ms and sorts every frame into:
 *   loading  the page says it is loading and shows no stage
 *   right    the stage the database row says the job is in
 *   wrong    any other stage (the defect)
 * It never taps anything: navigation is by URL only.
 *
 *   BOUNTY_SHOAL_POOL_SECRET=... node qa/shoal/repro/job-stage-timed-capture.mjs \
 *     --slot 11 --expect offers --route /postings/<id> --runs 20 --out <dir>
 *   [--role poster] [--interval 250] [--duration 8000] [--width 390 --height 844]
 *   [--fresh-context]   every open is a cold start: a new browser context restored
 *                       from the signed-in storage state (the session-restore race)
 *
 * --expect picks how a frame is judged (see EXPECT below). The script prints the
 * wrong frames with their time since navigation and writes everything to
 * <out>/<label>.json; the first wrong frame of each run is also screenshotted.
 * A run that leaves the route (the poster sent to the public page) is counted
 * separately as a redirect, not as a wrong stage.
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

/**
 * How each fixture state is judged. `stage` is read from the job page's header
 * (testID workspace-header) and the first of the four questions; `right` says
 * which text is true for that state. Anything stage-like that isn't right is wrong.
 */
const EXPECT = {
  // Open job, three pending offers.
  offers: { right: /\b\d+ people want to help\b|\b1 person wants to help\b/ },
  // Work submitted, waiting for the poster's approval.
  submitted: { right: /says the job is done/ },
  // Approved and released.
  finished: { right: /Done\. (Released to|.* finished the job)/ },
  // Helper side: work submitted, waiting on the poster.
  'helper-submitted': { right: /Step 4 of 5/ },
  // My Jobs: the card for a job with submitted work (no workspace header there,
  // so the card is found by its title and judged on the text after it).
  'myjobs-submitted': { card: /Pick up my dry cleaning/, right: /says the job is done/ },
  // My Jobs opened plainly (no link): the featured card must be work to review
  // when the account has some (it outranks offers).
  'myjobs-featured-review': { card: /job that needs you today\./, right: /says the job is done/ },
  'myjobs-offers': { card: /Remove old furniture from my garage/, right: /\b\d+ people want to help\b/ },
};
const expectKey = opt('expect', 'offers');
const expectation = EXPECT[expectKey];
if (!expectation) throw new Error('--expect must be one of ' + Object.keys(EXPECT).join(', '));

const role = opt('role', 'poster');
const account = poolAccount(role, Number(opt('slot', '11')));
const route = opt('route');
if (!route) throw new Error('--route is required (e.g. /postings/<id>)');
const runs = Number(opt('runs', '20'));
const interval = Number(opt('interval', '250'));
const duration = Number(opt('duration', '8000'));
const label = opt('label', `${expectKey}-${role}-${account.slot}`);
const out = path.resolve(opt('out', 'qa/shoal/artifacts/job-stage-timed-capture'));
mkdirSync(out, { recursive: true });
const VIEWPORT = { width: Number(opt('width', '390')), height: Number(opt('height', '844')) };

const freshContext = args.includes('--fresh-context');

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
let page = await context.newPage();

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
  if ([...keys].some((k) => !k.startsWith('pk_test_'))) {
    console.error('refusing: bundle carries a non-test Stripe key');
    process.exit(2);
  }
  console.log('  guard: supabase ' + staging + ' only, stripe ' + ([...keys].join(',') || 'none') + '\n');
}

/** One frame: what the screen says right now. */
const sample = () =>
  page.evaluate(() => {
    const body = document.body?.innerText ?? '';
    const header = document.querySelector('[data-testid="workspace-header"]');
    const headerText = header ? header.innerText.replace(/\s+/g, ' ').trim() : null;
    // The first of the four questions sits right under the header.
    const four = document.querySelector('[data-testid="four-questions"]');
    const now = four ? four.innerText.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2).join(' | ') : null;
    const loader = /Loading your job…|Opening your job…|Loading…/.test(body) && !header;
    const step = headerText?.match(/Step \d of 5[^A-Z]*·? ?[A-Za-z' ]*/)?.[0]?.trim() ?? null;
    // On-screen leaf text only, in document order: other tabs stay mounted
    // off screen and would otherwise match first.
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const visible = [];
    for (const el of document.querySelectorAll('body *')) {
      if (el.childElementCount !== 0) continue;
      const t = (el.textContent || '').trim();
      if (!t) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.right <= 0 || r.left >= vw || r.bottom <= 0 || r.top >= vh) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      visible.push(t);
    }
    return { loader, headerText, step, now, bodyHead: body.replace(/\s+/g, ' ').slice(0, 400), body: visible.join(' ') };
  });

const classify = (f) => {
  if (expectation.card) {
    const at = f.body?.search(expectation.card) ?? -1;
    if (at < 0) return 'loading';
    f.now = f.body.slice(at, at + 160);
    return expectation.right.test(f.now) ? 'right' : 'wrong';
  }
  if (!f.headerText) return f.loader ? 'loading' : 'blank';
  const text = [f.headerText, f.now, f.bodyHead].filter(Boolean).join(' ');
  return expectation.right.test(text) ? 'right' : 'wrong';
};

const log = { label, route, expect: expectKey, viewport: VIEWPORT, interval, duration, freshContext, account: account.email, runs: [] };
const routePath = route.split('?')[0];
try {
  await page.goto(BASE + '/auth/sign-in-form', { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(account.email);
  await page.locator('input[type="password"]').first().fill(derivePassword(secret, account.email));
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForURL(/\/tabs\//, { timeout: 45000 });
  await page.waitForTimeout(3000);
  const signedIn = freshContext ? await context.storageState() : null;

  for (let r = 0; r < runs; r++) {
    let runContext = null;
    if (freshContext) {
      // Cold start: nothing in memory, the session restored from storage.
      runContext = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, storageState: signedIn });
      page = await runContext.newPage();
    } else {
      // A cold open: leave for a blank page, then a full load of the job route.
      await page.goto('about:blank');
    }
    const t0 = Date.now();
    const nav = page.goto(BASE + route, { waitUntil: 'commit' }).catch(() => {});
    const frames = [];
    let shot = null;
    while (Date.now() - t0 < duration) {
      const at = Date.now() - t0;
      let f;
      try {
        f = await sample();
      } catch {
        f = { loader: false, headerText: null, step: null, now: null, bodyHead: '' };
      }
      const verdict = classify(f);
      let url = null;
      try {
        url = new URL(page.url()).pathname;
      } catch {
        /* not navigated yet */
      }
      frames.push({
        at,
        url,
        verdict,
        step: f.step,
        now: f.now,
        header: f.headerText,
        // Neither a stage nor the loader: keep what was on screen instead.
        ...(verdict === 'blank' ? { body: f.bodyHead.slice(0, 160) } : {}),
        ...(verdict === 'loading' && expectation.card ? { body: (f.body ?? '').slice(0, 400) } : {}),
      });
      if (verdict === 'wrong' && !shot) {
        shot = `${label}-run${String(r + 1).padStart(2, '0')}-wrong-${at}ms.png`;
        await page.screenshot({ path: path.join(out, shot) }).catch(() => {});
      }
      const next = t0 + (frames.length) * interval;
      const wait = next - Date.now();
      if (wait > 0) await page.waitForTimeout(wait);
    }
    await nav;
    // Left the job's own route (e.g. the poster sent to /bounty/<id>/public): a
    // redirect, judged apart. A forward inside it (the helper's submitted work
    // opens /in-progress/<id>/hunter/payout) is the same job page, not a redirect.
    const leftAt = frames.find(
      (f) => f.url && f.url !== 'blank' && f.url !== routePath && !f.url.startsWith(routePath + '/')
    );
    const redirected = leftAt ? leftAt.url : null;
    // Wrong-stage frames count on every URL the open passed through.
    const wrong = frames.filter((f) => f.verdict === 'wrong');
    const firstRight = frames.find((f) => f.verdict === 'right');
    log.runs.push({ run: r + 1, frames, wrongCount: wrong.length, redirected, firstRightAt: firstRight?.at ?? null, shot });
    if (runContext) await runContext.close();
    const wrongSummary = wrong.length
      ? ' WRONG ' + wrong.length + ' frames, ' + wrong[0].at + '-' + wrong[wrong.length - 1].at + 'ms: "' + (wrong[0].now ?? wrong[0].step ?? wrong[0].header ?? '').slice(0, 70) + '"'
      : '';
    console.log(`  run ${String(r + 1).padStart(2)}  frames ${frames.length}  right from ${firstRight?.at ?? '-'}ms${wrongSummary}${redirected ? ' REDIRECTED to ' + redirected : ''}`);
  }
} finally {
  const total = log.runs.reduce((n, r) => n + r.frames.length, 0);
  const wrong = log.runs.reduce((n, r) => n + r.wrongCount, 0);
  const runsWithWrong = log.runs.filter((r) => r.wrongCount > 0).length;
  const redirects = log.runs.filter((r) => r.redirected).length;
  log.summary = { runs: log.runs.length, frames: total, wrongFrames: wrong, runsWithWrong, redirects };
  writeFileSync(path.join(out, label + '.json'), JSON.stringify(log, null, 2));
  console.log(`\n  ${label}: ${wrong} wrong of ${total} frames; ${runsWithWrong}/${log.runs.length} runs had a wrong frame; ${redirects}/${log.runs.length} runs redirected`);
  await browser.close();
}
