/**
 * Static contract tests for the Connect-native payout handler in
 * supabase/functions/connect/index.ts (Phases 4-5 of the Stripe Connect native
 * wallet migration).
 *
 * The handler takes live Stripe/Supabase clients and the Supabase bundler does
 * not support local imports, so — matching the convention already established
 * in withdrawal-validation.test.ts and webhooks-contract.test.ts — these are
 * source-level regression guards rather than behavioural tests.
 *
 * What they defend is the whole point of the migration: this code path must
 * spend the connected account's Stripe balance and nothing else. A future edit
 * that reintroduces a profiles.balance read, a compensating ledger write, or a
 * platform Transfer would silently recreate the stranded-funds bug, and these
 * assertions are what catch it.
 */
import * as fs from 'fs';
import * as path from 'path';

const connectSource = fs.readFileSync(
  path.join(__dirname, '../../supabase/functions/connect/index.ts'),
  'utf8'
);

function extractFunctionBody(source: string, functionName: string): string {
  const start = source.indexOf(`function ${functionName}(`);
  if (start === -1) throw new Error(`function ${functionName} not found`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') {
      depth--;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`unterminated body for ${functionName}`);
}

const handlerBody = extractFunctionBody(connectSource, 'handleConnectNativePayout');

describe('handleConnectNativePayout — Stripe is the only balance source', () => {
  test('never selects profiles.balance', () => {
    // The profile select must not pull the ledger columns at all: not reading
    // them is what stops a future change from quietly gating on them again.
    const selectMatch = handlerBody.match(/\.select\(\s*'([^']*stripe_connect_account_id[^']*)'\s*\)/);
    expect(selectMatch).not.toBeNull();
    expect(selectMatch![1]).not.toContain('balance');
  });

  test('never reads p.balance or balance_on_hold', () => {
    expect(handlerBody).not.toMatch(/\bp\.balance\b/);
    expect(handlerBody).not.toMatch(/balance_on_hold/);
  });

  test('reads the balance from the connected account via readConnectBalance', () => {
    expect(handlerBody).toContain('readConnectBalance(stripe, accountId, currency)');
  });

  test('never calls the ledger mutation RPCs', () => {
    expect(handlerBody).not.toContain('withdraw_balance');
    expect(handlerBody).not.toContain('update_balance');
    expect(handlerBody).not.toContain('apply_deposit');
  });

  test('never creates a platform transfer', () => {
    // The legacy flow transferred platform funds into the connected account
    // before paying out. The money is already there under this architecture.
    expect(handlerBody).not.toContain('stripe.transfers.create');
  });

  test('creates exactly one payout, scoped to the connected account', () => {
    const payoutCalls = handlerBody.match(/stripe\.payouts\.create/g) ?? [];
    expect(payoutCalls).toHaveLength(1);
    expect(handlerBody).toContain('stripeAccount: accountId');
  });
});

describe('handleConnectNativePayout — account resolution is server-side', () => {
  test('resolves the connected account from the authenticated user id', () => {
    expect(handlerBody).toMatch(/\.eq\(\s*'id'\s*,\s*userId\s*\)/);
  });

  test('never takes an account id from the request body', () => {
    // Any of these would let a caller name someone else's Connect account.
    expect(handlerBody).not.toMatch(/body\.accountId/);
    expect(handlerBody).not.toMatch(/body\.stripeAccount/);
    expect(handlerBody).not.toMatch(/body\.connectAccountId/);
    expect(handlerBody).not.toMatch(/body\.stripe_connect_account_id/);
  });

  test('scopes the idempotency replay lookup to the caller', () => {
    const replaySection = handlerBody.slice(
      handlerBody.indexOf('idempotent replay') - 1500,
      handlerBody.indexOf('idempotent replay')
    );
    expect(replaySection).toMatch(/\.eq\(\s*'user_id'\s*,\s*userId\s*\)/);
  });
});

describe('handleConnectNativePayout — instant vs standard balance selection', () => {
  test('instant spends instant_available, standard spends available', () => {
    expect(handlerBody).toContain(
      "method === 'instant' ? balance.instantAvailableCents : balance.availableCents"
    );
  });

  test('reads instant balance net of fees, not gross', () => {
    // Stripe warns that using instant_available[].amount instead of
    // net_available breaks the integration once instant payout application
    // fees are enabled — the user cannot pay out the gross figure.
    const readBalanceBody = extractFunctionBody(connectSource, 'readConnectBalance');
    expect(readBalanceBody).toContain('net_available');
    expect(readBalanceBody).not.toMatch(/instant_available[\s\S]{0,120}\.amount\s*\?\?\s*0[\s\S]{0,40}\)\s*;/);
  });
});

describe('handleConnectNativePayout — validation and safe failure', () => {
  test('rejects a zero or negative spendable balance before calling Stripe', () => {
    expect(handlerBody).toContain('spendableCents <= 0');
    expect(handlerBody).toContain("'no_available_funds'");
    expect(handlerBody.indexOf('spendableCents <= 0')).toBeLessThan(
      handlerBody.indexOf('stripe.payouts.create')
    );
  });

  test('rejects an amount above the spendable balance before calling Stripe', () => {
    expect(handlerBody).toContain('amountCents > spendableCents');
    expect(handlerBody).toContain("'insufficient_balance'");
    expect(handlerBody.indexOf('amountCents > spendableCents')).toBeLessThan(
      handlerBody.indexOf('stripe.payouts.create')
    );
  });

  test('requires a Connect account and completed onboarding', () => {
    expect(handlerBody).toContain("'no_connect_account'");
    expect(handlerBody).toContain("'connect_not_onboarded'");
  });

  test('requires payouts to be enabled on the account', () => {
    expect(handlerBody).toContain('!account.payouts_enabled');
    expect(handlerBody).toContain("'payouts_disabled'");
  });

  test('enforces account status (ban/suspension) before paying out', () => {
    expect(handlerBody).toContain('validateAccountEligibility');
  });

  test('performs no compensating ledger write when Stripe rejects the payout', () => {
    const catchStart = handlerBody.indexOf('} catch (payoutError) {');
    expect(catchStart).toBeGreaterThan(-1);
    const catchBlock = handlerBody.slice(catchStart, catchStart + 1600);
    // Nothing was debited, so there is nothing to refund. A compensating
    // write here would invent money.
    expect(catchBlock).not.toContain('update_balance');
    expect(catchBlock).not.toContain('withdraw_balance');
    expect(catchBlock).toContain('mapStripePayoutError');
  });
});

describe('handleConnectNativePayout — idempotency', () => {
  test('replays a prior withdrawal with the same key instead of paying twice', () => {
    expect(handlerBody).toMatch(/\.eq\(\s*'idempotency_key'\s*,\s*idempotencyKey\s*\)/);
    expect(handlerBody).toContain('duplicate: true');
  });

  test('passes a scoped idempotency key to Stripe', () => {
    expect(handlerBody).toContain('buildNativePayoutIdempotencyKey');
  });

  test('handles the concurrent duplicate insert race without reversing money', () => {
    const raceStart = handlerBody.indexOf("(txError as { code?: string }).code === '23505'");
    expect(raceStart).toBeGreaterThan(-1);
    const raceBlock = handlerBody.slice(raceStart, raceStart + 1200);
    // Stripe idempotency means both callers resolved to the same payout, so
    // there is exactly one payout and nothing to refund.
    expect(raceBlock).not.toContain('update_balance');
    expect(raceBlock).toContain('duplicate: true');
  });
});

describe('handleConnectNativePayout — audit trail', () => {
  const requiredEvents = [
    'withdrawal_requested',
    'withdrawal_validated',
    'stripe_payout_created',
    'withdrawal_completed',
    'withdrawal_failed',
  ];

  test.each(requiredEvents)('emits the %s audit event', event => {
    expect(handlerBody).toContain(`'${event}'`);
  });

  test('records the balance the decision was made against', () => {
    expect(handlerBody).toContain('balanceAvailableCents: balance.availableCents');
    expect(handlerBody).toContain('balanceInstantAvailableCents: balance.instantAvailableCents');
  });

  test('threads a request id through native payout logs and responses', () => {
    expect(handlerBody).toContain('requestId');
    expect(handlerBody).toContain('const reply =');
    expect(connectSource).toContain("req.headers.get('x-request-id')");
    expect(connectSource).toContain("'X-Request-Id': requestId");
  });

  test('audit writes never block the payout', () => {
    const auditBody = extractFunctionBody(connectSource, 'writePayoutAudit');
    expect(auditBody).toContain('try {');
    expect(auditBody).toContain('catch');
    // Must not rethrow: an audit failure cannot fail a payout Stripe accepted.
    expect(auditBody).not.toMatch(/\bthrow\b/);
  });
});

describe('handleConnectNativePayout — transaction record', () => {
  test('records the payout as pending, not assumed complete', () => {
    // A payout is pending until it lands; payout.paid/payout.failed advance it.
    expect(handlerBody).toContain("status: 'pending'");
  });

  test('stores the Stripe payout id for reconciliation', () => {
    expect(handlerBody).toContain('stripe_payout_id: payout.id');
  });

  test('marks the row as Connect-native so history can distinguish the paths', () => {
    expect(handlerBody).toContain('connect_native: true');
  });
});

describe('connect edge function — route wiring', () => {
  test('the native path is flag-gated and off by default', () => {
    expect(connectSource).toContain(
      "const CONNECT_NATIVE_PAYOUTS = Deno.env.get('CONNECT_NATIVE_PAYOUTS') === 'true';"
    );
  });

  test('/payout refuses while the flag is off', () => {
    expect(connectSource).toContain("'native_payouts_disabled'");
  });

  test('/instant-payout keeps the legacy implementation behind the flag', () => {
    // The legacy ledger-backed code must survive so the flag is a true
    // rollback lever rather than a one-way door.
    expect(connectSource).toContain('if (CONNECT_NATIVE_PAYOUTS) {');
    expect(connectSource).toContain("rpc('begin_legacy_withdrawal'");
  });

  test('new Connect accounts can be created with a manual payout schedule', () => {
    expect(connectSource).toContain("interval: 'manual' as const");
    expect(connectSource).toContain(
      "const CONNECT_MANUAL_PAYOUTS = Deno.env.get('CONNECT_MANUAL_PAYOUTS') === 'true';"
    );
  });

  test('GET /connect/payouts sources the list from Stripe, not the ledger', () => {
    const routeStart = connectSource.indexOf("if (req.method === 'GET' && isPayoutsPath)");
    expect(routeStart).toBeGreaterThan(-1);
    const route = connectSource.slice(routeStart, routeStart + 4500);

    // Stripe is the authority on what happened to the money.
    expect(route).toContain('stripe.payouts.list');
    // Local rows are matched in only for context and drift detection, and the
    // lookup must be scoped to the caller.
    expect(route).toMatch(/\.eq\(\s*'user_id'\s*,\s*userId\s*\)/);
    expect(route).toContain('reconciled');
    expect(route).toContain('statusMatchesLedger');
  });

  test('payout history is scoped to the caller and takes no account id from the client', () => {
    const routeStart = connectSource.indexOf("if (req.method === 'GET' && isPayoutsPath)");
    const route = connectSource.slice(routeStart, routeStart + 4500);
    expect(route).toMatch(/\.eq\(\s*'id'\s*,\s*userId\s*\)/);
    expect(route).not.toMatch(/searchParams\.get\('accountId'\)/);
    expect(route).toContain('stripeAccount: accountId');
  });

  test('in_transit maps to pending, never to completed', () => {
    const mapBody = extractFunctionBody(connectSource, 'normalizePayoutStatusForLedger');
    // Treating in-flight money as settled is what let the legacy flow record
    // withdrawals as completed before they had actually landed.
    const inTransitIdx = mapBody.indexOf("case 'in_transit':");
    expect(inTransitIdx).toBeGreaterThan(-1);
    const afterInTransit = mapBody.slice(inTransitIdx, inTransitIdx + 80);
    expect(afterInTransit).toContain("return 'pending'");
    expect(mapBody).toContain("case 'paid':");
  });

  test('GET /connect/balance never reads the ledger', () => {
    const balanceRouteStart = connectSource.indexOf("if (req.method === 'GET' && isBalancePath)");
    expect(balanceRouteStart).toBeGreaterThan(-1);
    const balanceRoute = connectSource.slice(balanceRouteStart, balanceRouteStart + 3000);
    expect(balanceRoute).not.toMatch(/select\('[^']*\bbalance\b[^']*'\)/);
    expect(balanceRoute).toContain('stripe.balance.retrieve');
  });
});

describe('connect edge function — create-account-link capability regression', () => {
  test('requests both capabilities for new accounts and backfills legacy accounts before creating the account link', () => {
    const createStart = connectSource.indexOf('stripe.accounts.create({');
    const updateStart = connectSource.indexOf('stripe.accounts.update(accountId, {');
    const linkStart = connectSource.indexOf('stripe.accountLinks.create({');

    expect(createStart).toBeGreaterThan(-1);
    expect(updateStart).toBeGreaterThan(-1);
    expect(linkStart).toBeGreaterThan(-1);
    expect(updateStart).toBeLessThan(linkStart);

    const createBlock = connectSource.slice(createStart, updateStart);
    expect(createBlock).toContain('card_payments: { requested: true }');
    expect(createBlock).toContain('transfers: { requested: true }');

    const backfillBlock = connectSource.slice(updateStart, linkStart);
    expect(backfillBlock).toContain('card_payments: { requested: true }');
  });
});
