/**
 * Unit tests for the Instant Cash Out (debit-card payout) fee estimation and
 * destination resolution used by the POST /connect/instant-payout Supabase
 * Edge Function route.
 *
 * The pure helpers live in
 * supabase/functions/connect/instant-payout-validation.ts and are inlined
 * into the edge function (the Supabase bundler does not support local
 * imports) — a contract test below asserts the inlined copy in index.ts
 * stays in sync on the critical markers, mirroring the existing pattern in
 * withdrawal-validation.test.ts.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  INSTANT_PAYOUT_FEE_MIN_USD,
  INSTANT_PAYOUT_FEE_PERCENT,
  INSTANT_PAYOUT_MAX_USD,
  MAX_INSTANT_PAYOUTS_PER_DAY,
  checkInstantBalance,
  checkInstantDailyLimit,
  estimateInstantFeeCents,
  resolveInstantDestination,
  validateInstantAmount,
} from '../../supabase/functions/connect/instant-payout-validation';

describe('estimateInstantFeeCents', () => {
  test('charges the percent fee when it exceeds the minimum', () => {
    // $100 at 1% = $1.00 = 100 cents, above the 50-cent minimum.
    expect(estimateInstantFeeCents(10000)).toBe(100);
  });

  test('falls back to the minimum fee for small amounts', () => {
    // $10 at 1% = 10 cents, below the 50-cent minimum -> minimum applies.
    expect(estimateInstantFeeCents(1000)).toBe(50);
  });

  test('rounds the percent fee to the nearest cent', () => {
    // $33.33 at 1% = 33.33 cents -> rounds to 33 cents, still below the minimum -> 50.
    expect(estimateInstantFeeCents(3333)).toBe(50);
    // $10,000 at 1% = $100.00 = 10000 cents, well above the minimum.
    expect(estimateInstantFeeCents(1000000)).toBe(10000);
  });

  test('exposes the configured rate/minimum as named constants', () => {
    expect(INSTANT_PAYOUT_FEE_PERCENT).toBe(1);
    expect(INSTANT_PAYOUT_FEE_MIN_USD).toBe(0.5);
  });
});

describe('resolveInstantDestination', () => {
  const eligibleCard = { id: 'card_1', brand: 'Visa', last4: '4242', available_payout_methods: ['standard', 'instant'] };
  const ineligibleCard = { id: 'card_2', brand: 'Visa', last4: '1111', available_payout_methods: ['standard'] };

  test('rejects when no cards are linked at all', () => {
    const result = resolveInstantDestination([], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_debit_card');
  });

  test('rejects when cards exist but none are instant-eligible', () => {
    const result = resolveInstantDestination([ineligibleCard], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_instant_eligible_card');
  });

  test('selects the first instant-eligible card when none is explicitly requested', () => {
    const result = resolveInstantDestination([ineligibleCard, eligibleCard], undefined);
    expect(result).toEqual({ ok: true, targetCard: eligibleCard });
  });

  test('rejects a requested card id that does not exist on the account', () => {
    const result = resolveInstantDestination([eligibleCard], 'card_does_not_exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('debit_card_not_found');
  });

  test('rejects a requested card that exists but is not instant-eligible, distinctly from not-found', () => {
    const result = resolveInstantDestination([eligibleCard, ineligibleCard], 'card_2');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('card_not_instant_eligible');
  });

  test('selects the explicitly requested card when it is instant-eligible', () => {
    const result = resolveInstantDestination([ineligibleCard, eligibleCard], 'card_1');
    expect(result).toEqual({ ok: true, targetCard: eligibleCard });
  });

  test('treats a missing available_payout_methods array as not instant-eligible', () => {
    const cardWithoutMethods = { id: 'card_3', brand: 'Mastercard', last4: '5555' };
    const result = resolveInstantDestination([cardWithoutMethods], undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_instant_eligible_card');
  });
});

describe('validateInstantAmount', () => {
  test('exposes the configured ceiling as a named constant', () => {
    expect(INSTANT_PAYOUT_MAX_USD).toBe(9999);
  });

  test('accepts an amount at or below the ceiling', () => {
    expect(validateInstantAmount(9999)).toEqual({ ok: true });
    expect(validateInstantAmount(500)).toEqual({ ok: true });
  });

  test('rejects an amount above the ceiling', () => {
    const result = validateInstantAmount(10000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('above_instant_maximum');
  });
});

describe('checkInstantBalance', () => {
  test('accepts an amount at or below the instant-available balance', () => {
    expect(checkInstantBalance(5000, 5000)).toEqual({ ok: true });
    expect(checkInstantBalance(4999, 5000)).toEqual({ ok: true });
  });

  test('rejects an amount above the instant-available balance, distinctly from the wallet balance check', () => {
    const result = checkInstantBalance(5001, 5000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('insufficient_instant_balance');
  });

  test('rejects any positive amount when instant-available balance is zero', () => {
    const result = checkInstantBalance(1, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('insufficient_instant_balance');
  });
});

describe('checkInstantDailyLimit', () => {
  test('exposes the configured daily cap as a named constant', () => {
    expect(MAX_INSTANT_PAYOUTS_PER_DAY).toBe(10);
  });

  test('accepts counts below the daily cap', () => {
    expect(checkInstantDailyLimit(0)).toEqual({ ok: true });
    expect(checkInstantDailyLimit(9)).toEqual({ ok: true });
  });

  test('rejects once the count reaches the daily cap', () => {
    const result = checkInstantDailyLimit(10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('daily_instant_limit_reached');
  });

  test('rejects counts above the daily cap too (defensive)', () => {
    const result = checkInstantDailyLimit(11);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('daily_instant_limit_reached');
  });
});

describe('connect edge function contract (inlined instant-payout helpers stay in sync)', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/connect/index.ts'),
    'utf8'
  );

  test('inlines the instant-payout helpers with env-configurable fee defaults', () => {
    expect(indexSource).toContain('function estimateInstantFeeCents');
    expect(indexSource).toContain('function resolveInstantDestination');
    expect(indexSource).toContain('function readEnvNumberForInstantPayout');
    expect(indexSource).toContain(
      `readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_PERCENT', ${INSTANT_PAYOUT_FEE_PERCENT})`
    );
    expect(indexSource).toContain(
      `readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_MIN_USD', ${INSTANT_PAYOUT_FEE_MIN_USD})`
    );
  });

  test('gates the instant-payout route behind an explicit, default-off feature flag', () => {
    expect(indexSource).toContain("Deno.env.get('INSTANT_CASHOUT_ENABLED') === 'true'");
  });

  test('never promotes a debit card to default_for_currency', () => {
    // The instant-payout route must not call updateExternalAccount at all —
    // unlike the bank-account transfer path, Stripe's automatic payout sweep
    // must keep targeting the bank account, never a linked instant-payout card.
    // Extracted by index rather than an exact-whitespace regex, so this stays
    // robust to reformatting: slice from the route's own marker to the next
    // top-level route marker (or the final catch block) that follows it.
    const routeStart = indexSource.indexOf("subPath === '/instant-payout'");
    expect(routeStart).toBeGreaterThan(-1);
    const nextRouteMarkers = ["\n    // POST /connect/", "\n    // GET /connect/", '\n    return jsonResponse({ error: \'Not found\' }'];
    const candidateEnds = nextRouteMarkers
      .map(marker => indexSource.indexOf(marker, routeStart + 1))
      .filter(idx => idx !== -1);
    const routeEnd = candidateEnds.length > 0 ? Math.min(...candidateEnds) : indexSource.length;
    const routeSlice = indexSource.slice(routeStart, routeEnd);
    expect(routeSlice).not.toContain('default_for_currency: true');
  });

  test('creates the instant payout scoped to the connected account via stripeAccount', () => {
    expect(indexSource).toMatch(/stripe\.payouts\.create\(/);
    expect(indexSource).toContain("method: 'instant'");
    expect(indexSource).toMatch(/stripeAccount:\s*p\.stripe_connect_account_id/);
  });

  test('inlines the instant-specific limit helpers and wires them into the route', () => {
    expect(indexSource).toContain('function validateInstantAmount');
    expect(indexSource).toContain('function checkInstantDailyLimit');
    expect(indexSource).toContain(
      `readEnvNumberForInstantPayout('INSTANT_PAYOUT_MAX_USD', ${INSTANT_PAYOUT_MAX_USD})`
    );
    expect(indexSource).toContain(
      `readEnvNumberForInstantPayout('MAX_INSTANT_PAYOUTS_PER_DAY', ${MAX_INSTANT_PAYOUTS_PER_DAY})`
    );
  });

  test('does NOT call checkInstantBalance (or any other) pre-check against the connected account\'s pre-transfer instant_available balance in the /instant-payout route', () => {
    // 2026-07-21 fix: this used to be checked BEFORE this route's own
    // platform->connected-account transfer ran, against a balance that is
    // necessarily $0 for any hunter who hasn't already completed a prior
    // withdrawal (money only lands in the connected account's Stripe
    // balance via this route's own transfer step, which hadn't happened
    // yet at the point of the old check) — permanently locking Instant Cash
    // Out for every first-time user regardless of a valid linked card.
    // Stripe's own stripe.payouts.create call is now the sole authority on
    // instant-eligibility of the (correctly, post-transfer) funded balance;
    // its existing catch block already falls back to a completed standard
    // withdrawal on failure, so no client- or server-side pre-check is
    // reintroduced here. checkInstantBalance() itself remains exported from
    // instant-payout-validation.ts as a general-purpose, independently
    // unit-tested pure helper — it is simply no longer called from index.ts.
    expect(indexSource).not.toContain('function checkInstantBalance');
    expect(indexSource).not.toContain('checkInstantBalance(');
    expect(indexSource).not.toContain('insufficient_instant_balance');
  });

  test('checks balance.instant_available (never the plain available balance) before creating an instant payout', () => {
    // The wrong-field mistake the integration spec calls out by name:
    // `available` reflects funds Stripe hasn't necessarily cleared for
    // instant payout; only `instant_available` has.
    expect(indexSource).toContain('stripe.balance.retrieve(');
    expect(indexSource).toContain('balance.instant_available');
    expect(indexSource).not.toMatch(/balance\.available\?\.\s*find/);
  });
});
