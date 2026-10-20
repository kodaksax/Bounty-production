#!/usr/bin/env node
/**
 * SBA-05 end to end on STAGING, as Shoal pool accounts, with Stripe TEST mode.
 *
 *   node scripts/e2e-card-at-post-staging.mjs
 *
 * Needs .env.staging (SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY) and
 * BOUNTY_SHOAL_POOL_SECRET in .env. Refuses to run unless the Supabase project
 * is staging and the Stripe key is sk_test_.
 *
 * Drives the same calls the app makes, in order. The only stand-in is
 * confirming Stripe objects: the native SDK confirms the SetupIntent and the
 * PaymentIntent on the device; here the Stripe API confirms them with a test
 * card (pm_card_visa) and then the card saved at post.
 *
 *   1. First-time poster with $0 and no card: fn_get_posting_card_requirement
 *      says card_required.
 *   2. Save a card: payments/create-setup-intent -> confirm -> payments/methods
 *      lists it. Nothing is charged and the balance doesn't move.
 *   3. Post a $20 bounty (PostgREST insert): funding_mode 'at_accept', no
 *      escrow, no debit.
 *   4. Two hunters apply. The poster declines one (rejection_source 'poster').
 *   5. Hire with the card saved at post, exactly as "Pay $X & hire" does:
 *      fn_get_bounty_funding_requirement (shortfall) ->
 *      payments/create-payment-intent -> confirm with the saved card ->
 *      wallet/deposit -> fn_accept_bounty_request. Escrow is held; request
 *      'accepted'.
 *   6. The poster is no longer first-time: card_required false.
 *   7. Cancel and refund: the hunter requests cancellation, the poster accepts
 *      it (wallet/refund, then the cancellation row, then status 'cancelled').
 *      The escrow comes back to the poster's wallet.
 *   8. A second first-time poster posts and cancels before hiring: nothing to
 *      refund, nothing charged.
 *
 * Leaves its rows on staging (bounties are is_test = true, so they never reach
 * the feed or notifications) and prints their ids. Stripe objects stay in test
 * mode. Exit code 0 only when every check passes.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { derivePassword, poolAccount } from '../qa/shoal/bin/lib/accounts.mjs';

const require = createRequire(import.meta.url);
const { createClient } = require('@supabase/supabase-js');

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
const SUPABASE_URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const FUNCTIONS = `${SUPABASE_URL}/functions/v1`;
const STRIPE_KEY = env.STRIPE_SECRET_KEY;

if (!SUPABASE_URL?.includes(STAGING_REF)) throw new Error('Refusing: SUPABASE_URL is not staging');
if (!STRIPE_KEY?.startsWith('sk_test_')) throw new Error('Refusing: Stripe key is not a test key');
if (!poolSecret) throw new Error('BOUNTY_SHOAL_POOL_SECRET missing from .env');

// is_internal pool accounts, derived exactly as the Shoal seeder does.
const pool = (role, slot) => {
  const { email } = poolAccount(role, slot);
  return { email, password: derivePassword(poolSecret, email) };
};

const results = [];
function check(name, ok, info) {
  results.push({ name, ok: !!ok });
  const extra = info === undefined ? '' : `  (${typeof info === 'string' ? info : JSON.stringify(info)})`;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra}`);
  return !!ok;
}

async function signIn(account) {
  const client = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword(account);
  if (error) throw new Error(`sign-in ${account.email}: ${error.message}`);
  return { client, token: data.session.access_token, id: data.user.id };
}

async function fn(path, token, { method = 'POST', body } = {}) {
  const res = await fetch(`${FUNCTIONS}/${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, json };
}

async function stripe(path, params = {}, method = 'POST') {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(params),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`stripe ${path}: ${json.error?.message}`);
  return json;
}

const balanceOf = async (c, id) =>
  Number((await c.rpc('get_my_profile')).data?.balance ?? (await c.from('profiles').select('balance').eq('id', id).single()).data?.balance);

async function requirement(c, amount) {
  const { data, error } = await c.rpc('fn_get_posting_card_requirement', { p_amount: amount });
  if (error) throw new Error(`fn_get_posting_card_requirement: ${error.message}`);
  return data;
}

async function postBounty(c, posterId, title) {
  const { data, error } = await c
    .from('bounties')
    .insert({
      title,
      description: 'SBA-05 staging end-to-end check. Not a real task.',
      amount: 20,
      is_for_honor: false,
      work_type: 'online',
      location: 'Online',
      poster_id: posterId,
      user_id: posterId,
      status: 'open',
      is_test: true,
    })
    .select('id, funding_mode, status')
    .single();
  if (error) throw new Error(`post: ${error.message}`);
  return data;
}

async function apply(c, bountyId, hunterId, posterId) {
  const { data, error } = await c
    .from('bounty_requests')
    .insert({ bounty_id: bountyId, hunter_id: hunterId, poster_id: posterId, status: 'pending' })
    .select('id')
    .single();
  if (error) throw new Error(`apply: ${error.message}`);
  return data.id;
}

async function main() {
  const poster = await signIn(pool('hunter', 7)); // $0 balance, never posted
  const hunter = await signIn(pool('hunter', 8));
  const declined = await signIn(pool('hunter', 6));
  const poster2 = await signIn(pool('hunter', 5)); // second first-time poster, $0, never posted
  const P = poster.client;
  const ids = {};

  // --- 1. Asked for a card ---------------------------------------------------
  const startBalance = await balanceOf(P, poster.id);
  let req = await requirement(P, 20);
  check('first-time $0 poster: server says card_required', req.card_required === true && req.first_time_poster === true, req);
  check('poster starts with no wallet balance (so no balance exemption)', startBalance === 0, startBalance);

  let methods = await fn('payments/methods', poster.token, { method: 'GET' });
  const cardsBefore = (methods.json.paymentMethods ?? []).filter((m) => m.type === 'card');
  check('payments/methods answers', methods.status === 200, methods.status);

  // --- 2. Save a card (the composer's card sheet) -----------------------------
  let savedPm = cardsBefore[0]?.id;
  if (!savedPm) {
    const si = await fn('payments/create-setup-intent', poster.token, { body: {} });
    check('payments/create-setup-intent', si.status === 200 && si.json.setupIntentId, { status: si.status, err: si.json.error });
    const confirmed = await stripe(`setup_intents/${si.json.setupIntentId}/confirm`, { payment_method: 'pm_card_visa' });
    check('SetupIntent confirmed with a test card', confirmed.status === 'succeeded', confirmed.status);
    savedPm = confirmed.payment_method;
    methods = await fn('payments/methods', poster.token, { method: 'GET' });
  } else {
    console.log(`note: poster already had a card from an earlier run (${savedPm})`);
  }
  const cards = (methods.json.paymentMethods ?? []).filter((m) => m.type === 'card');
  check('saved card is listed by payments/methods (what the app reads)', cards.some((m) => m.id === savedPm), cards.map((m) => m.id));

  const customer = (await stripe(`payment_methods/${savedPm}`, {}, 'GET')).customer;
  const chargesAfterSave = await stripe(`charges?customer=${customer}&limit=100`, {}, 'GET');
  const balanceAfterSave = await balanceOf(P, poster.id);
  ids.customer = customer;
  check('saving the card charged nothing and moved no balance', balanceAfterSave === startBalance && chargesAfterSave.data.every((ch) => ch.created < Date.now() / 1000 - 600 || ch.payment_method !== savedPm || ch.amount === 0), {
    balance: balanceAfterSave,
    recentCharges: chargesAfterSave.data.filter((ch) => ch.created > Date.now() / 1000 - 600).length,
  });

  // --- 3. Post -------------------------------------------------------------------
  const bounty = await postBounty(P, poster.id, 'SBA-05 e2e: proofread a paragraph');
  ids.bounty = bounty.id;
  check("posted bounty is 'at_accept' and open", bounty.funding_mode === 'at_accept' && bounty.status === 'open', bounty);
  const escrowAtPost = await P.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: bounty.id });
  const fr0 = Array.isArray(escrowAtPost.data) ? escrowAtPost.data[0] : escrowAtPost.data;
  check('nothing held at post (requires funding, not already funded)', fr0?.requires_funding === true && fr0?.already_funded === false, fr0);
  check('no balance change at post', (await balanceOf(P, poster.id)) === startBalance);

  // --- 4. Applications, one declined ---------------------------------------------
  const reqHire = await apply(hunter.client, bounty.id, hunter.id, poster.id);
  const reqDecline = await apply(declined.client, bounty.id, declined.id, poster.id);
  const { error: declineErr } = await P.from('bounty_requests').update({ status: 'rejected' }).eq('id', reqDecline);
  const declinedRow = (await P.from('bounty_requests').select('status, rejection_source').eq('id', reqDecline).single()).data;
  check("poster's decline is recorded as rejection_source 'poster'", !declineErr && declinedRow?.status === 'rejected' && declinedRow?.rejection_source === 'poster', declineErr?.message ?? declinedRow);

  // --- 5. Hire with the card saved at post ("Pay $X & hire") ---------------------
  const fr = Array.isArray((await P.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: bounty.id })).data)
    ? (await P.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: bounty.id })).data[0]
    : (await P.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: bounty.id })).data;
  const shortfall = Math.max(0, Number(fr.amount_required) - Number(fr.poster_balance));
  check('hire sheet would show "Pay $20 & hire"', shortfall === 20, { amount_required: fr.amount_required, poster_balance: fr.poster_balance });

  const pi = await fn('payments/create-payment-intent', poster.token, {
    body: { amountCents: Math.round(shortfall * 100), currency: 'usd', metadata: { purpose: 'wallet_deposit' }, idempotencyKey: `sba05_e2e_${bounty.id}` },
  });
  check('payments/create-payment-intent', pi.status === 200 && pi.json.paymentIntentId, { status: pi.status, err: pi.json.error });
  const paid = await stripe(`payment_intents/${pi.json.paymentIntentId}/confirm`, {
    payment_method: savedPm,
    // The SDK passes the app's own return URL (stripe-service.ts); a card never redirects.
    return_url: 'bountyexpo://payment-complete',
  });
  ids.paymentIntent = paid.id;
  check('PaymentIntent confirmed with the card saved at post', paid.status === 'succeeded' && paid.payment_method === savedPm, paid.status);

  const dep = await fn('wallet/deposit', poster.token, { body: { amount: shortfall, paymentIntentId: paid.id } });
  check('wallet/deposit persisted the top-up', dep.status === 200, { status: dep.status, err: dep.json.error });
  check('balance now covers the hire', (await balanceOf(P, poster.id)) === startBalance + shortfall);

  const accepted = await P.rpc('fn_accept_bounty_request', { p_request_id: reqHire });
  check('fn_accept_bounty_request succeeds', !accepted.error, accepted.error?.message);
  const afterHire = (await P.from('bounties').select('status, accepted_by').eq('id', bounty.id).single()).data;
  const hiredRow = (await P.from('bounty_requests').select('status').eq('id', reqHire).single()).data;
  const fr2Raw = (await P.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: bounty.id })).data;
  const fr2 = Array.isArray(fr2Raw) ? fr2Raw[0] : fr2Raw;
  check("request 'accepted', hunter assigned, work can start", hiredRow?.status === 'accepted' && afterHire?.accepted_by === hunter.id && afterHire?.status === 'in_progress', { hiredRow, afterHire });
  check('escrow held at hire, wallet back to the start', fr2?.already_funded === true && (await balanceOf(P, poster.id)) === startBalance, fr2);

  // --- 6. No longer first-time ----------------------------------------------------
  req = await requirement(P, 20);
  check('after a hire the poster is not first-time: card not required', req.card_required === false && req.first_time_poster === false, req);

  // --- 7. Cancel and refund after hire --------------------------------------------
  const cancelReq = await hunter.client.rpc('request_bounty_cancellation', {
    p_bounty_id: bounty.id,
    p_reason: 'SBA-05 staging e2e: hunter cannot do it after all.',
  });
  check('hunter requests cancellation', !cancelReq.error, cancelReq.error?.message);
  const cancellation = Array.isArray(cancelReq.data) ? cancelReq.data[0] : cancelReq.data;
  const refund = await fn('wallet/refund', poster.token, {
    body: { bountyId: bounty.id, reason: '100% refund', refundPercentage: 100 },
  });
  check('poster accepts: wallet/refund returns the escrow', refund.status === 200, { status: refund.status, err: refund.json.error, code: refund.json.code });
  const { error: cancelRowErr } = await P.from('bounty_cancellations')
    .update({ status: 'accepted', responder_id: poster.id, refund_amount: 20, resolved_at: new Date().toISOString() })
    .eq('id', cancellation?.id);
  const { error: statusErr } = await P.from('bounties').update({ status: 'cancelled' }).eq('id', bounty.id);
  check('cancellation accepted and bounty cancelled', !cancelRowErr && !statusErr, cancelRowErr?.message ?? statusErr?.message);
  check('refund landed in the poster wallet', (await balanceOf(P, poster.id)) === startBalance + 20);

  // --- 8. Second first-time poster cancels before hiring ---------------------------
  const p2Start = await balanceOf(poster2.client, poster2.id);
  const b2 = await postBounty(poster2.client, poster2.id, 'SBA-05 e2e: cancel before hiring');
  ids.bountyCancelledUnhired = b2.id;
  const fr3Raw = (await poster2.client.rpc('fn_get_bounty_funding_requirement', { p_bounty_id: b2.id })).data;
  const fr3 = Array.isArray(fr3Raw) ? fr3Raw[0] : fr3Raw;
  check("unhired bounty has nothing held (the app's planCancelRefund: nothing to refund)", fr3?.already_funded === false, fr3);
  const { error: c2Err } = await poster2.client.from('bounties').update({ status: 'cancelled' }).eq('id', b2.id);
  check('poster cancels the unhired bounty; no charge, no refund', !c2Err && (await balanceOf(poster2.client, poster2.id)) === p2Start, c2Err?.message);

  console.log('\nids:', JSON.stringify(ids));
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
