#!/usr/bin/env node
/**
 * One Stripe customer per person, end to end on STAGING with Stripe TEST mode.
 *
 *   node scripts/e2e-one-stripe-customer-staging.mjs [--slot=0] [--headed] [--keep]
 *
 * Needs .env.staging (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 * STRIPE_SECRET_KEY) and BOUNTY_SHOAL_POOL_SECRET in .env. Refuses to run
 * unless the project is staging and the Stripe key is sk_test_. Uses the Shoal
 * pool poster in --slot (default 0, the operator spare), which should start
 * with no Stripe customer.
 *
 * Runs this branch's code locally, imported from supabase/functions (Node strips
 * the types): resolveCustomerPlan and buildCheckoutSessionParams for the website
 * Checkout, linkCheckoutCustomerAndCard for the webhook step, and the sole-card
 * rule. Staging's deployed functions do the app's part: payments/create-setup-intent
 * and payments/methods. Hosted Checkout is completed in a real browser
 * (Playwright) with Stripe test cards.
 *
 *   1. The app saves a Visa: the profile gets a customer and one card.
 *   2. The sole-card rule makes that card the default, in payment_methods and
 *      in invoice_settings on Stripe.
 *   3. The same person posts on the website signed out: Checkout uses their
 *      existing customer, shows no saved card and no save box, and the payment
 *      is charged on that customer.
 *   4. They post signed in: Checkout offers save. They pay with a new
 *      Mastercard and tick save. The webhook step mirrors it, and the app's
 *      payments/methods lists it. With two cards, the default stays where it was.
 *      (Reported, not checked: whether Checkout showed the app's card. Hosted
 *      Checkout prefills only cards saved with consent, allow_redisplay
 *      'always', and the app saves cards as 'unspecified'.)
 *   5. Signed out again, now that a consented card is on the customer: a guest
 *      payment, so that card is never shown to someone who typed the email.
 *   6. Stripe has exactly one customer for this email.
 *
 * The sessions use flow_type 'one_customer_e2e', so the deployed webhook skips
 * them and no bounty or pending row is created. Stripe objects stay in test
 * mode. Afterwards the pool slot is reset (cards detached, rows deleted, test
 * customer deleted, profile customer cleared) so the next run starts clean;
 * --keep skips that.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { derivePassword, poolAccount } from '../qa/shoal/bin/lib/accounts.mjs';
import { buildCheckoutSessionParams } from '../supabase/functions/bounty-checkout/logic.ts';
import { resolveCustomerPlan } from '../supabase/functions/bounty-checkout/customer-plan.ts';
import { linkCheckoutCustomerAndCard } from '../supabase/functions/webhooks/checkout-customer.ts';
import {
  applySoleDefaultPlan,
  readSoleDefaultPlan,
} from '../supabase/functions/_shared/sole-payment-method-default.ts';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');
const Stripe = require('stripe');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const SLOT = Number((args.find(a => a.startsWith('--slot=')) ?? '--slot=0').slice(7));
const HEADED = args.includes('--headed');
const KEEP = args.includes('--keep');

function envFile(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const STAGING_REF = 'gwumwpoomwvkjyibdmpj';
const env = envFile('.env.staging');
const poolSecret = envFile('.env').BOUNTY_SHOAL_POOL_SECRET;
const { SUPABASE_URL, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, STRIPE_SECRET_KEY } = env;
if (!SUPABASE_URL?.includes(STAGING_REF)) throw new Error('Refusing: SUPABASE_URL is not staging');
if (!STRIPE_SECRET_KEY?.startsWith('sk_test_')) throw new Error('Refusing: Stripe key is not a test key');
if (!poolSecret) throw new Error('BOUNTY_SHOAL_POOL_SECRET missing from .env');

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });
const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
const SHOTS = join(tmpdir(), 'one-stripe-customer-e2e');

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  const extra = info === undefined ? '' : `  (${typeof info === 'string' ? info : JSON.stringify(info)})`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra}`);
  return !!ok;
}

async function fn(path, token, { method = 'POST', body } = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 300) } };
  }
}

const profileCustomer = async id =>
  (await admin.from('profiles').select('stripe_customer_id').eq('id', id).single()).data?.stripe_customer_id ?? null;
const cardRows = async id =>
  (await admin.from('payment_methods').select('id, stripe_payment_method_id, card_last4, is_default').eq('user_id', id))
    .data ?? [];

async function waitFor(what, probe, ms = 45000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 1500));
  }
}

async function createSession(plan, email, title) {
  const params = buildCheckoutSessionParams({
    mode: 'payment',
    amount: 5,
    title,
    description: 'Staging test of one Stripe customer per person. Not a real task.',
    email,
    customerPlan: plan,
    successUrl: 'https://www.bountyfinder.net/#post-success',
    cancelUrl: 'https://www.bountyfinder.net/#post?checkout=cancelled',
    pendingBountyId: 'e2e',
    // Not 'bounty_creation': the deployed webhook skips it, so no bounty is made.
    metadata: { flow_type: 'one_customer_e2e', customer_email: email },
    nowSeconds: Math.floor(Date.now() / 1000),
  });
  return stripe.checkout.sessions.create(params);
}

// Best effort: a screenshot is evidence, never a reason to fail the run.
async function shot(page, name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`), timeout: 8000 }).catch(() => {});
}

async function fillCard(page, number) {
  await page.locator('#cardNumber').fill(number);
  await page.locator('#cardExpiry').fill('12 / 34');
  await page.locator('#cardCvc').fill('123');
  const name = page.locator('#billingName');
  if (await name.count()) await name.fill('Test Poster');
  const zip = page.locator('#billingPostalCode');
  if (await zip.count()) await zip.fill('20001');
}

/** Pays a hosted Checkout page. Returns what the page offered (saved card shown, save box). */
async function payCheckout(browser, url, { card, save, label }) {
  const page = await browser.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-testid="hosted-payment-submit-button"]:visible, .SubmitButton:visible').first().waitFor({ timeout: 45000 });
    await page.waitForTimeout(2500);
    const offered = { savedVisa: /4242/.test(await page.locator('body').innerText()), saveBox: false };
    await shot(page, `${label}-before`);

    // A saved card is preselected; pick a new card instead.
    if (!(await page.locator('#cardNumber').isVisible().catch(() => false))) {
      const other = page.getByText(/(use|pay with) (a )?(different|another|new) (card|payment method)|add (a )?new card/i).first();
      if (await other.isVisible().catch(() => false)) await other.click();
      const accordion = page.locator('[data-testid="card-accordion-item-button"]').first();
      if (!(await page.locator('#cardNumber').isVisible().catch(() => false)) && (await accordion.count())) {
        // Stripe renders this button at zero size over the "Card" radio row.
        await accordion.dispatchEvent('click');
        await page.waitForTimeout(800);
        if (!(await page.locator('#cardNumber').isVisible().catch(() => false))) {
          await page.locator('input[type="radio"][value="card"]').first().check({ force: true }).catch(() => {});
        }
      }
      await page.locator('#cardNumber').waitFor({ timeout: 15000 });
    }
    await fillCard(page, card);

    // Link's own "Save my information with Link" box is Stripe's Link account,
    // not our customer, and it wants a phone number: leave Link out of it.
    const link = page.locator('#enableStripePass');
    if ((await link.count()) && (await link.isChecked().catch(() => false))) await link.uncheck({ force: true });

    // Stripe's save-for-later consent box (payment_method_save), never Link's.
    const consent = page
      .getByRole('checkbox', { name: /future|next time|save (my )?payment/i })
      .and(page.locator(':not(#enableStripePass)'))
      .first();
    offered.saveBox = (await consent.count()) > 0;
    if (save && offered.saveBox && !(await consent.isChecked())) await consent.check({ force: true });
    await shot(page, `${label}-filled`);
    await page.locator('[data-testid="hosted-payment-submit-button"]:visible, .SubmitButton:visible').first().click();
    await page.waitForURL(/bountyfinder\.net/, { timeout: 60000, waitUntil: 'commit' });
    return offered;
  } catch (err) {
    await shot(page, `${label}-error`);
    writeFileSync(join(SHOTS, `${label}-error.txt`), await page.locator('body').innerText().catch(() => ''));
    throw err;
  } finally {
    await page.close();
  }
}

async function main() {
  require('node:fs').mkdirSync(SHOTS, { recursive: true });
  const { email } = poolAccount('poster', SLOT);
  const anon = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await anon.auth.signInWithPassword({
    email,
    password: derivePassword(poolSecret, email),
  });
  if (authErr) throw new Error(`sign-in ${email}: ${authErr.message}`);
  const userId = auth.user.id;
  const token = auth.session.access_token;
  console.log(`Staging, Stripe test mode, as ${email} (${userId})\n`);

  const startCustomer = await profileCustomer(userId);
  const startCards = await cardRows(userId);
  if (startCustomer || startCards.length) {
    console.log(`Note: starts with customer ${startCustomer} and ${startCards.length} card(s); some checks assume a clean slot.`);
  }

  // 1. The app saves a Visa (deployed payments function, as the app calls it).
  //    Skipped on a re-run, which would otherwise add a second card.
  if (!startCards.some(r => r.card_last4 === '4242')) {
    const si = await fn('payments/create-setup-intent', token, { body: { usage: 'off_session' } });
    if (si.status !== 200) throw new Error(`create-setup-intent ${si.status}: ${JSON.stringify(si.json)}`);
    await stripe.setupIntents.confirm(si.json.setupIntentId, { payment_method: 'pm_card_visa' });
  }
  const appCustomer = await profileCustomer(userId);
  check('app card save gives the profile a Stripe customer', !!appCustomer, appCustomer);
  const appCardRow = await waitFor('the app card row (setup_intent.succeeded webhook)', async () =>
    (await cardRows(userId)).find(r => r.card_last4 === '4242')
  );
  console.log(`      deployed webhook mirrored the app card with is_default=${appCardRow.is_default}`);

  // 2. The sole-card rule (this branch's code).
  const plan = await readSoleDefaultPlan({ supabase: admin, stripe, userId });
  await applySoleDefaultPlan({ supabase: admin, stripe, plan });
  const afterRule = (await cardRows(userId)).find(r => r.id === appCardRow.id);
  const appCustomerObj = await stripe.customers.retrieve(appCustomer);
  check('sole card: payment_methods.is_default is true', afterRule?.is_default === true);
  check(
    'sole card: Stripe invoice_settings.default_payment_method is that card',
    appCustomerObj.invoice_settings?.default_payment_method === appCardRow.stripe_payment_method_id,
    appCustomerObj.invoice_settings?.default_payment_method
  );

  const browser = await chromium.launch({ headless: !HEADED });
  try {
    // 3. Website post, signed out, same person.
    const outPlan = await resolveCustomerPlan({ stripe, admin, authedUserId: null, email });
    check('signed out: the plan uses the existing customer, no save offered', outPlan.customerId === appCustomer && !outPlan.offerSave, outPlan);
    const outSession = await createSession(outPlan, email, 'Signed-out website post');
    check('signed out: the Checkout Session is on the existing customer', outSession.customer === appCustomer, outSession.customer);
    const outOffered = await payCheckout(browser, outSession.url, { card: '4000056655665556', save: false, label: 'signed-out' });
    check('signed out: Checkout showed no saved card to someone who typed the email', !outOffered.savedVisa);
    check('signed out: Checkout offered no save box', !outOffered.saveBox);
    const outPaid = await stripe.checkout.sessions.retrieve(outSession.id, { expand: ['payment_intent.payment_method'] });
    check(
      "signed out: the payment was charged on the user's existing customer",
      outPaid.payment_status === 'paid' && outPaid.payment_intent?.customer === appCustomer,
      { payment_intent: outPaid.payment_intent?.id, customer: outPaid.payment_intent?.customer }
    );
    check('signed out: the card used was not saved', !outPaid.payment_intent?.payment_method?.customer);

    // 4. Website post, signed in, saving a new card.
    const inPlan = await resolveCustomerPlan({ stripe, admin, authedUserId: userId, email });
    check('signed in: the plan uses their own customer and offers save', inPlan.ownCustomer && inPlan.customerId === appCustomer && inPlan.offerSave, inPlan);
    const inSession = await createSession(inPlan, email, 'Signed-in website post');
    const inOffered = await payCheckout(browser, inSession.url, { card: '5555555555554444', save: true, label: 'signed-in' });
    console.log(
      `INFO  signed in: Checkout ${inOffered.savedVisa ? 'showed' : 'did not show'} the card saved in the app` +
        ' (it prefills only allow_redisplay always)'
    );
    check('signed in: Checkout offered the save box', inOffered.saveBox);
    const inPaid = await stripe.checkout.sessions.retrieve(inSession.id, { expand: ['payment_intent.payment_method'] });
    const savedPm = inPaid.payment_intent?.payment_method;
    check(
      'signed in: paid on the same customer, and the ticked card is attached with consent',
      inPaid.payment_status === 'paid' &&
        inPaid.payment_intent?.customer === appCustomer &&
        savedPm?.customer === appCustomer &&
        savedPm?.allow_redisplay === 'always',
      { customer: savedPm?.customer, allow_redisplay: savedPm?.allow_redisplay, last4: savedPm?.card?.last4 }
    );

    // The webhook step (this branch's code), with the real session and intent.
    const link = await linkCheckoutCustomerAndCard({
      supabase: admin,
      stripe,
      posterId: userId,
      session: inPaid,
      paymentIntent: inPaid.payment_intent,
    });
    check('webhook step mirrors the saved card into payment_methods', link.savedCardId === savedPm?.id, link);

    const methods = await fn('payments/methods', token, { method: 'GET' });
    const listed = (methods.json.paymentMethods ?? []).map(m => m.card?.last4);
    check('the saved card shows up in the app (payments/methods)', listed.includes('4444'), listed);

    const rows = await cardRows(userId);
    check(
      'two cards: the default stays on the first one',
      rows.length === 2 && rows.find(r => r.card_last4 === '4242')?.is_default === true && rows.find(r => r.card_last4 === '4444')?.is_default === false,
      rows.map(r => `${r.card_last4}:${r.is_default}`)
    );
  } finally {
    await browser.close();
  }

  // 5. Signed out again: the customer now has a card Checkout would show.
  const againPlan = await resolveCustomerPlan({ stripe, admin, authedUserId: null, email });
  check(
    'signed out, once a consented card is on the customer: a guest payment, not that customer',
    againPlan.customerId === null && !againPlan.createCustomer && !againPlan.offerSave,
    againPlan
  );

  // 6. One customer.
  const customers = await stripe.customers.list({ email, limit: 10 });
  check('Stripe has exactly one customer for this email', customers.data.length === 1, customers.data.map(c => c.id));

  if (!KEEP) {
    // Reset the pool slot (staging, test mode) so the next run starts clean.
    const pms = await stripe.paymentMethods.list({ customer: appCustomer, type: 'card' });
    for (const pm of pms.data) await stripe.paymentMethods.detach(pm.id);
    await admin.from('payment_methods').delete().eq('user_id', userId);
    await admin.from('profiles').update({ stripe_customer_id: null }).eq('id', userId);
    await stripe.customers.del(appCustomer);
    console.log(`
Reset ${email}: detached ${pms.data.length} test card(s), deleted ${appCustomer} (test mode).`);
  }

  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed. Screenshots: ${SHOTS}`);
  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error(err?.stack ?? err);
  process.exit(1);
});
