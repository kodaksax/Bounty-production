/**
 * Unit tests for the withdrawal request validation and error mapping used by
 * the /connect/transfer Supabase Edge Function (withdrawal hardening audit).
 *
 * The pure helpers live in supabase/functions/connect/withdrawal-validation.ts
 * and are inlined into the edge function (the Supabase bundler does not
 * support local imports) — a contract test below asserts the inlined copy in
 * index.ts stays in sync on the critical markers.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  MAX_WITHDRAWAL_USD,
  MIN_WITHDRAWAL_USD,
  mapStripeTransferError,
  mapWithdrawBalanceError,
  resolveWithdrawalDestination,
  validateAccountEligibility,
  validateWithdrawalRequest,
} from '../../supabase/functions/connect/withdrawal-validation';

describe('validateWithdrawalRequest', () => {
  test('accepts a valid whole-dollar amount', () => {
    const result = validateWithdrawalRequest({ amount: 50 });
    expect(result).toEqual({ ok: true, amount: 50, amountCents: 5000 });
  });

  test('accepts a valid amount with cents', () => {
    const result = validateWithdrawalRequest({ amount: 25.75, currency: 'usd' });
    expect(result).toEqual({ ok: true, amount: 25.75, amountCents: 2575 });
  });

  test('accepts string-typed numeric amounts (JSON coercion)', () => {
    const result = validateWithdrawalRequest({ amount: '20' });
    expect(result).toEqual({ ok: true, amount: 20, amountCents: 2000 });
  });

  test.each([[0], [-5], [NaN], [Infinity], [-Infinity], [undefined], ['abc'], [null]])(
    'rejects invalid amount %p',
    amount => {
      const result = validateWithdrawalRequest({ amount });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('invalid_amount');
    }
  );

  test('rejects sub-cent precision', () => {
    const result = validateWithdrawalRequest({ amount: 10.001 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid_amount_precision');
  });

  test('does not reject float representation noise (e.g. 10.10)', () => {
    const result = validateWithdrawalRequest({ amount: 10.1 });
    expect(result).toEqual({ ok: true, amount: 10.1, amountCents: 1010 });
  });

  test('rejects amounts below the minimum', () => {
    const result = validateWithdrawalRequest({ amount: MIN_WITHDRAWAL_USD - 0.01 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('below_minimum');
  });

  test('accepts exactly the minimum', () => {
    const result = validateWithdrawalRequest({ amount: MIN_WITHDRAWAL_USD });
    expect(result.ok).toBe(true);
  });

  test('rejects amounts above the maximum', () => {
    const result = validateWithdrawalRequest({ amount: MAX_WITHDRAWAL_USD + 0.01 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('above_maximum');
  });

  test('accepts exactly the maximum', () => {
    const result = validateWithdrawalRequest({ amount: MAX_WITHDRAWAL_USD });
    expect(result.ok).toBe(true);
  });

  test('rejects non-USD currency', () => {
    const result = validateWithdrawalRequest({ amount: 50, currency: 'eur' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported_currency');
  });

  test('accepts uppercase USD currency', () => {
    const result = validateWithdrawalRequest({ amount: 50, currency: 'USD' });
    expect(result.ok).toBe(true);
  });

  test('defaults currency to usd when omitted', () => {
    expect(validateWithdrawalRequest({ amount: 50 }).ok).toBe(true);
  });
});

describe('mapStripeTransferError', () => {
  test('maps platform balance_insufficient to a retriable 503', () => {
    const mapped = mapStripeTransferError({ code: 'balance_insufficient' });
    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe('platform_balance_insufficient');
    expect(mapped.error).toMatch(/has not been charged/i);
  });

  test.each(['account_invalid', 'transfers_not_allowed'])(
    'maps destination account error %s to an actionable 400',
    code => {
      const mapped = mapStripeTransferError({ code });
      expect(mapped.status).toBe(400);
      expect(mapped.code).toBe('destination_account_invalid');
    }
  );

  test('maps connection errors to a retriable 503', () => {
    const mapped = mapStripeTransferError({ type: 'StripeConnectionError' });
    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe('stripe_unreachable');
  });

  test('maps idempotency conflicts to 409', () => {
    const mapped = mapStripeTransferError({ type: 'idempotency_error' });
    expect(mapped.status).toBe(409);
    expect(mapped.code).toBe('idempotency_conflict');
  });

  test('falls back to a generic 502 without leaking internal details', () => {
    const mapped = mapStripeTransferError({ message: 'internal stripe stack trace xyz' });
    expect(mapped.status).toBe(502);
    expect(mapped.code).toBe('transfer_failed');
    expect(mapped.error).not.toMatch(/stack trace/);
  });
});

describe('mapWithdrawBalanceError', () => {
  test('maps dispute freeze to 403 with a human-readable message', () => {
    const mapped = mapWithdrawBalanceError(
      'Balance is frozen for profile abc due to an open Stripe dispute'
    );
    expect(mapped.status).toBe(403);
    expect(mapped.code).toBe('balance_frozen');
  });

  test('maps insufficient available balance to 400', () => {
    const mapped = mapWithdrawBalanceError(
      'Insufficient available balance: balance=5 on_hold=0 available=5 requested=10'
    );
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe('insufficient_balance');
  });

  test('maps unknown RPC failures to a generic 500', () => {
    const mapped = mapWithdrawBalanceError('connection reset');
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe('balance_reservation_failed');
  });

  test('handles undefined message', () => {
    const mapped = mapWithdrawBalanceError(undefined);
    expect(mapped.status).toBe(500);
  });
});

describe('resolveWithdrawalDestination', () => {
  const accounts = [
    { id: 'ba_1', default_for_currency: true, bank_name: 'Chase', last4: '1111' },
    { id: 'ba_2', default_for_currency: false, bank_name: 'Ally', last4: '2222' },
  ];

  test('rejects when the account has no linked bank accounts', () => {
    const result = resolveWithdrawalDestination([], 'ba_1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_bank_account');
  });

  test('rejects a requested bankAccountId that does not belong to the account', () => {
    const result = resolveWithdrawalDestination(accounts, 'ba_does_not_exist');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('bank_account_not_found');
  });

  test('selecting the already-default account requires no update', () => {
    const result = resolveWithdrawalDestination(accounts, 'ba_1');
    expect(result).toEqual({
      ok: true,
      targetAccount: accounts[0],
      needsDefaultUpdate: false,
    });
  });

  test('selecting a non-default account requires promoting it to default', () => {
    const result = resolveWithdrawalDestination(accounts, 'ba_2');
    expect(result).toEqual({
      ok: true,
      targetAccount: accounts[1],
      needsDefaultUpdate: true,
    });
  });

  test('falls back to the current default when no bankAccountId is requested (older client)', () => {
    const result = resolveWithdrawalDestination(accounts, undefined);
    expect(result).toEqual({
      ok: true,
      targetAccount: accounts[0],
      needsDefaultUpdate: false,
    });
  });

  test('falls back to the first account when none is marked default and none requested', () => {
    const noDefault = [
      { id: 'ba_3', default_for_currency: false, bank_name: 'Wells Fargo', last4: '3333' },
    ];
    const result = resolveWithdrawalDestination(noDefault, undefined);
    expect(result).toEqual({
      ok: true,
      targetAccount: noDefault[0],
      needsDefaultUpdate: false,
    });
  });
});

describe('validateAccountEligibility', () => {
  test.each(['suspended', 'banned'])('blocks a %s account', status => {
    const result = validateAccountEligibility(status);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('account_not_eligible');
  });

  test.each(['active', undefined, null, '', 'anything-else'])('allows account_status %p', status => {
    expect(validateAccountEligibility(status as string | null | undefined)).toEqual({ ok: true });
  });
});

describe('connect edge function contract (inlined helpers stay in sync)', () => {
  const indexSource = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/connect/index.ts'),
    'utf8'
  );

  test('inlines the withdrawal validation helpers with env-configurable default limits', () => {
    expect(indexSource).toContain('function validateWithdrawalRequest');
    expect(indexSource).toContain('function mapStripeTransferError');
    expect(indexSource).toContain('function mapWithdrawBalanceError');
    // Verify the env-configurable initialiser uses the correct default values
    // (matching the exported constants from the sibling module) via the
    // NaN-safe readEnvNumber helper — a misconfigured (non-numeric) env value
    // must fall back to the default rather than silently disabling the limit
    // (Number(badValue) is NaN, and `amount < NaN` / `amount > NaN` are both
    // always false).
    expect(indexSource).toContain('function readEnvNumber');
    expect(indexSource).toContain(`readEnvNumber('WITHDRAW_MIN_USD', ${MIN_WITHDRAWAL_USD})`);
    expect(indexSource).toContain(`readEnvNumber('WITHDRAW_MAX_USD', ${MAX_WITHDRAWAL_USD})`);
  });

  test('replays duplicate withdrawals via the idempotency_key column', () => {
    expect(indexSource).toContain(".eq('idempotency_key', idempotencyKey)");
    expect(indexSource).toContain('idempotency_key: idempotencyKey ?? null');
  });

  test('passes a Stripe idempotency key when creating transfers', () => {
    expect(indexSource).toMatch(/idempotencyKey: `transfer_\$\{userId\}_\$\{idempotencyKey\}/);
    expect(indexSource).toMatch(/idempotencyKey: `retry_\$\{transactionId\}_\$\{retryCount \+ 1\}`/);
  });

  test('verifies live payout eligibility before deducting balance', () => {
    expect(indexSource).toContain('account.payouts_enabled');
    expect(indexSource).toContain("code: 'payouts_disabled'");
  });

  test('refunds the deducted balance when a concurrent duplicate loses the insert race', () => {
    expect(indexSource).toContain('concurrent duplicate detected');
    expect(indexSource).toContain("'23505'");
  });

  test('inlines resolveWithdrawalDestination and wires it into both transfer and retry-transfer', () => {
    expect(indexSource).toContain('function resolveWithdrawalDestination');
    // Both the primary transfer path and the retry path must call the
    // resolver.
    const resolverCallCount = (indexSource.match(/resolveWithdrawalDestination\(/g) || []).length;
    expect(resolverCallCount).toBeGreaterThanOrEqual(2);
  });

  test('never calls stripe.accounts.updateExternalAccount — these Connect accounts reject it unconditionally', () => {
    // controller.requirement_collection === "stripe" on these accounts means
    // Stripe rejects createExternalAccount/updateExternalAccount/
    // deleteExternalAccount from the platform side with a permissions error,
    // always — there is no "payouts disabled" case that unblocks it. Every
    // call site that used to attempt this (bank-accounts/:id/default,
    // /transfer, /retry-transfer, debit-cards add/delete) must instead fail
    // closed with an actionable error pointing at the Stripe payout
    // dashboard (POST /connect/login-link).
    expect(indexSource).not.toContain('stripe.accounts.updateExternalAccount(');
    expect(indexSource).not.toContain('stripe.accounts.createExternalAccount(');
    expect(indexSource).not.toContain('stripe.accounts.deleteExternalAccount(');
  });

  test('fails closed with bank_account_not_default instead of promoting a non-default account', () => {
    const failClosedCount = (indexSource.match(/code: 'bank_account_not_default'/g) || []).length;
    // Once in /transfer, once in /retry-transfer.
    expect(failClosedCount).toBe(2);
  });

  test('exposes a login-link endpoint into the Stripe Express Dashboard', () => {
    expect(indexSource).toContain("subPath === '/login-link'");
    expect(indexSource).toContain('stripe.accounts.createLoginLink(');
  });

  test('records the resolved destination bank account on the wallet_transactions row', () => {
    expect(indexSource).toContain('destination_bank_account_id: destinationAccount.id');
  });

  test('inlines validateAccountEligibility and enforces it on both /transfer and /instant-payout', () => {
    expect(indexSource).toContain('function validateAccountEligibility');
    const callCount = (indexSource.match(/validateAccountEligibility\(p\.account_status\)/g) || []).length;
    expect(callCount).toBe(2);
    expect(indexSource).toContain("code: 'account_not_eligible'");
    // Must be fetched from the DB wherever it's consumed, not assumed.
    const selectsAccountStatus = (indexSource.match(/select\([^)]*account_status[^)]*\)/g) || []).length;
    expect(selectsAccountStatus).toBeGreaterThanOrEqual(2);
  });
});
