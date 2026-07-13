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
    // (matching the exported constants from the sibling module).
    expect(indexSource).toContain(`WITHDRAW_MIN_USD') ?? '${MIN_WITHDRAWAL_USD}'`);
    expect(indexSource).toContain(`WITHDRAW_MAX_USD') ?? '${MAX_WITHDRAWAL_USD}'`);
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
});
