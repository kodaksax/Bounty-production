/**
 * Regression tests for the wallet-deposit integrity vulnerability.
 *
 * Two things were wrong:
 *
 *   1. `apply_deposit(UUID, NUMERIC, TEXT, JSONB)` — a SECURITY DEFINER RPC
 *      that credits an arbitrary user an arbitrary amount — was granted
 *      EXECUTE to `authenticated` by 20260310_apply_deposit.sql. So was
 *      `update_balance`, and `apply_escrow` (which credits when passed a
 *      negative amount).
 *   2. POST /wallet/deposit credited `body.amount` for whatever string the
 *      caller passed as `paymentIntentId`, with no Stripe lookup at all.
 *
 * The behavioural cases below (3–7) run against the real decision function the
 * edge function calls. The grant cases (1–2) and the idempotency cases (8–9)
 * are asserted at migration/source level, following the convention in
 * financial-invariants.test.ts — the money-moving code itself lives in Deno
 * edge functions that take live Stripe and Supabase clients.
 *
 * scripts/verify-apply-deposit-permissions.mjs proves cases 1 and 2 against a
 * real database; it is deliberately not a Jest test because it needs
 * production credentials.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
    isPaymentIntentId,
    verifyDepositPaymentIntent,
    type DepositPaymentIntent,
} from '../../supabase/functions/_shared/deposit-verification';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

const walletSource = read('supabase/functions/wallet/index.ts');
const verificationSource = read('supabase/functions/_shared/deposit-verification.ts');
const lockdownMigration = read('supabase/migrations/20260830_secure_apply_deposit.sql');
const depositMigration = read('supabase/migrations/20260310_apply_deposit.sql');
const uniqueIndexMigration = read(
  'supabase/migrations/20260311_add_unique_idx_wallet_tx_stripe_payment_intent.sql'
);

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';

function intent(overrides: Partial<DepositPaymentIntent> = {}): DepositPaymentIntent {
  return {
    id: 'pi_3U9W63JekUCspsfJ01uQWTfX',
    amount: 1000, // $10.00
    currency: 'usd',
    status: 'succeeded',
    metadata: { user_id: USER_A, purpose: 'wallet_deposit' },
    ...overrides,
  };
}

// ── Tests 1 & 2: no client role may execute the crediting RPCs ──────────────

describe('apply_deposit is not executable by client roles', () => {
  const signatures = [
    'public.apply_deposit(UUID, NUMERIC, TEXT, JSONB)',
    'public.update_balance(UUID, NUMERIC)',
    'public.apply_escrow(uuid, uuid, numeric, text, jsonb)',
  ];

  it.each(signatures)('revokes EXECUTE on %s from authenticated, anon and PUBLIC', sig => {
    for (const grantee of ['PUBLIC', 'anon', 'authenticated']) {
      expect(lockdownMigration).toContain(`REVOKE ALL ON FUNCTION ${sig} FROM ${grantee};`);
    }
  });

  it.each(signatures)('keeps EXECUTE on %s for service_role', sig => {
    expect(lockdownMigration).toContain(`GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  });

  it('grants EXECUTE to no role other than service_role', () => {
    // Strip `--` comments first: the migration quotes the vulnerable historical
    // grant in its own header to explain what it is undoing.
    const executable = lockdownMigration.replace(/^\s*--.*$/gm, '');
    const grants = executable.match(/GRANT EXECUTE ON FUNCTION[^;]+;/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) {
      expect(grant).toMatch(/TO service_role;$/);
    }
  });

  it('self-verifies the resulting privileges instead of assuming them', () => {
    // A migration that ran is not proof a guardrail is armed. This one asserts
    // the final ACL and aborts the transaction if the lock-down did not take.
    expect(lockdownMigration).toContain('has_function_privilege');
    expect(lockdownMigration).toContain('Lock-down failed');
    expect(lockdownMigration).toContain('service_role lacks EXECUTE');
  });

  it('fails loudly rather than silently missing an overload', () => {
    expect(lockdownMigration).toContain('resolve the overloads before locking down grants');
  });

  it('keeps the vulnerable historical grant in place as history, not as policy', () => {
    // The original migration is not rewritten — the new one supersedes it.
    expect(depositMigration).toContain(
      'GRANT EXECUTE ON FUNCTION apply_deposit(UUID, NUMERIC, TEXT, JSONB) TO authenticated;'
    );
    const lockdownName = '20260830_secure_apply_deposit.sql';
    expect(fs.existsSync(path.join(__dirname, '../../supabase/migrations', lockdownName))).toBe(
      true
    );
  });

  it('adds a defense-in-depth caller check for any future re-grant', () => {
    expect(lockdownMigration).toContain(
      'apply_deposit: caller may not deposit to a different user'
    );
    // Fails closed on a NULL subject rather than letting it slip past the
    // equality comparison.
    expect(lockdownMigration).toContain('v_caller IS NULL OR v_caller <> p_user_id');
    expect(lockdownMigration).toMatch(/ERRCODE = '42501'/);
  });

  it('rejects a negative apply_escrow amount, which would credit instead of debit', () => {
    expect(lockdownMigration).toContain('apply_escrow: amount must be positive');
    expect(lockdownMigration).toContain('apply_deposit: amount must be positive');
  });

  it('is not called from any client-side code', () => {
    const clientDirs = ['app', 'components', 'hooks', 'lib', 'providers'];
    for (const dir of clientDirs) {
      const hits: string[] = [];
      const walk = (d: string) => {
        const abs = path.join(__dirname, '../../', d);
        if (!fs.existsSync(abs)) return;
        for (const entry of fs.readdirSync(abs, { withFileTypes: true, recursive: true } as any)) {
          if (!entry.isFile()) continue;
          if (!/\.tsx?$/.test(entry.name)) continue;
          const file = path.join((entry as any).parentPath ?? abs, entry.name);
          const src = fs.readFileSync(file, 'utf8');
          if (/rpc\(\s*['"](apply_deposit|update_balance|apply_escrow)['"]/.test(src)) {
            hits.push(file);
          }
        }
      };
      walk(dir);
      expect(hits).toEqual([]);
    }
  });
});

// ── Tests 3 & 4: fabricated / nonexistent PaymentIntent ─────────────────────

describe('a fabricated PaymentIntent cannot create wallet funds', () => {
  it.each([
    'pi_fake_deposit_1000000',
    'pi_short',
    'not-a-payment-intent',
    'ch_3U9W63JekUCspsfJ01uQWTfX',
    'seti_3U9W63JekUCspsfJ01uQ',
    '',
    '../../etc/passwd',
    "pi_'; UPDATE profiles SET balance = 99999; --",
  ])('rejects %p before any Stripe or database call', id => {
    expect(isPaymentIntentId(id)).toBe(false);
  });

  it('accepts a real Stripe PaymentIntent id shape', () => {
    expect(isPaymentIntentId('pi_3U9W63JekUCspsfJ01uQWTfX')).toBe(true);
  });

  it('treats a PaymentIntent Stripe cannot retrieve as fatal, never as a credit', () => {
    // The retrieve is inside the handler (it needs a live Stripe client), so
    // assert the enforcement point: a throw returns before apply_deposit.
    const handler = walletSource.slice(
      walletSource.indexOf("subPath === '/deposit'"),
      walletSource.indexOf("rpc('apply_deposit'")
    );
    expect(handler).toContain('stripe.paymentIntents.retrieve');
    expect(handler).toMatch(/catch \(stripeErr[\s\S]{0,600}return jsonResponse/);
    expect(handler).toContain('payment_intent_not_retrievable');
  });

  it('does not treat a Stripe outage as a payment failure the client should give up on', () => {
    // resource_missing → 4xx (client stops retrying); anything else → 502 so
    // the client's retry loop can recover a genuinely paid deposit.
    expect(walletSource).toContain("code === 'resource_missing'");
    expect(walletSource).toContain('isMissing ? 404 : 502');
    expect(walletSource).toContain(
      "code: isMissing ? 'payment_intent_not_found' : 'payment_verification_failed'"
    );
    expect(walletSource).toContain('retryable: !isMissing');
  });

  it('returns correlation ids and stable deposit error codes to speed incident triage', () => {
    expect(walletSource).toContain('function generateRequestId');
    expect(walletSource).toContain("'X-Request-Id': requestId");
    expect(walletSource).toContain('requestId }');
    expect(walletSource).toContain("code: 'invalid_payment_intent_id'");
    expect(walletSource).toContain("code: 'deposit_record_failed'");
    expect(walletSource).toContain("code: 'deposit_recorded_balance_refresh_failed'");
  });
});

// ── Test 5: PaymentIntent not succeeded ─────────────────────────────────────

describe('an unsettled PaymentIntent cannot credit the wallet', () => {
  it.each([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'canceled',
  ])('rejects status %s', status => {
    const result = verifyDepositPaymentIntent({ callerId: USER_A, intent: intent({ status }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.event).toBe('deposit_payment_intent_not_succeeded');
    expect(result.status).toBe(409);
  });

  it('accepts only succeeded', () => {
    expect(verifyDepositPaymentIntent({ callerId: USER_A, intent: intent() }).ok).toBe(true);
  });
});

// ── Test 6: wrong user ──────────────────────────────────────────────────────

describe('a PaymentIntent cannot credit a different user', () => {
  it("rejects User A's payment when User B presents it", () => {
    const result = verifyDepositPaymentIntent({ callerId: USER_B, intent: intent() });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.event).toBe('deposit_payment_intent_user_mismatch');
    expect(result.status).toBe(403);
    expect(result.reason).toBe('user_mismatch');
  });

  it('rejects a PaymentIntent with no owner metadata rather than defaulting to the caller', () => {
    const result = verifyDepositPaymentIntent({
      callerId: USER_A,
      intent: intent({ metadata: { purpose: 'wallet_deposit' } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('missing_intent_user_id');
  });

  it('rejects a bounty-escrow PaymentIntent, which settles through bounty_payments', () => {
    const result = verifyDepositPaymentIntent({
      callerId: USER_A,
      intent: intent({ metadata: { user_id: USER_A, purpose: 'bounty_escrow' } }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('purpose_not_wallet_deposit');
  });
});

// ── Test 7: client amount manipulation ──────────────────────────────────────

describe('the credited amount comes from Stripe, never from the client', () => {
  it('credits $10 for a $10 PaymentIntent even when the client asks for $10,000', () => {
    const result = verifyDepositPaymentIntent({
      callerId: USER_A,
      intent: intent({ amount: 1000 }),
      requestedAmount: 10_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.amount).toBe(10);
    expect(result.amount).not.toBe(10_000);
    expect(result.amountMismatch).toEqual({ requested: 10_000, verified: 10 });
  });

  it.each([
    [50, 0.5],
    [1000, 10],
    [905, 9.05],
    [20_000, 200],
  ])('converts %i cents to $%s', (cents, dollars) => {
    const result = verifyDepositPaymentIntent({
      callerId: USER_A,
      intent: intent({ amount: cents }),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.amount).toBeCloseTo(dollars, 6);
  });

  it('reports no mismatch when the client happened to send the right amount', () => {
    const result = verifyDepositPaymentIntent({
      callerId: USER_A,
      intent: intent({ amount: 1000 }),
      requestedAmount: 10,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.amountMismatch).toBeUndefined();
  });

  it.each([0, -5000])('rejects a non-positive Stripe amount (%i cents)', amount => {
    const result = verifyDepositPaymentIntent({ callerId: USER_A, intent: intent({ amount }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('non_positive_stripe_amount');
  });

  it.each(['eur', 'gbp', 'jpy'])('rejects %s rather than silently crediting dollars', currency => {
    const result = verifyDepositPaymentIntent({ callerId: USER_A, intent: intent({ currency }) });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('unexpected_currency');
  });

  it('passes the verified amount — not the request body — to apply_deposit', () => {
    const call = walletSource.slice(
      walletSource.indexOf("rpc('apply_deposit'"),
      walletSource.indexOf("rpc('apply_deposit'") + 600
    );
    expect(call).toContain('p_amount: amount');
    expect(call).not.toContain('p_amount: requestedAmount');
    // Within the deposit handler, `amount` must be bound from the verdict and
    // never from the request body. (POST /wallet/escrow further down the file
    // legitimately reads body.amount — it debits, and the DB re-checks funds.)
    const handler = walletSource.slice(
      walletSource.indexOf("subPath === '/deposit'"),
      walletSource.indexOf("rpc('apply_deposit'")
    );
    expect(handler).toContain('const amount = verdict.amount;');
    expect(handler).not.toMatch(/const amount =[^;]*body\.amount/);
  });

  it('runs every verification before the RPC that moves money', () => {
    const beforeRpc = walletSource.slice(
      walletSource.indexOf("subPath === '/deposit'"),
      walletSource.indexOf("rpc('apply_deposit'")
    );
    expect(beforeRpc).toContain('verifyDepositPaymentIntent');
    expect(beforeRpc).toContain('if (!verdict.ok)');
  });
});

// ── Tests 8 & 9: idempotency, including under concurrency ───────────────────

describe('a PaymentIntent can only credit the wallet once', () => {
  it('keys the ledger row on the payment intent id', () => {
    expect(depositMigration).toContain('ON CONFLICT (stripe_payment_intent_id)');
    expect(lockdownMigration).toContain('ON CONFLICT (stripe_payment_intent_id)');
  });

  it('backs ON CONFLICT with a real UNIQUE index, so concurrent inserts serialize', () => {
    // Without a unique index, ON CONFLICT would be a syntax error rather than a
    // guarantee; with one, a concurrent duplicate blocks on the index and then
    // takes the DO NOTHING branch — one credit, not two.
    expect(uniqueIndexMigration).toContain('CREATE UNIQUE INDEX');
    expect(uniqueIndexMigration).toContain(
      'ON wallet_transactions(stripe_payment_intent_id)\nWHERE stripe_payment_intent_id IS NOT NULL'
    );
  });

  it('updates the balance only when a new ledger row was actually inserted', () => {
    // The balance update is inside `IF v_tx_id IS NOT NULL`, so the DO NOTHING
    // branch cannot credit a second time.
    const fn = lockdownMigration.slice(
      lockdownMigration.indexOf('CREATE OR REPLACE FUNCTION public.apply_deposit'),
      lockdownMigration.indexOf('COMMENT ON FUNCTION public.apply_deposit')
    );
    const guardAt = fn.indexOf('IF v_tx_id IS NOT NULL THEN');
    const updateAt = fn.indexOf('UPDATE profiles');
    expect(guardAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(guardAt);
    expect(fn).toContain('RETURN QUERY SELECT false, NULL::UUID;');
  });

  it('logs the duplicate rather than reporting a second credit', () => {
    expect(walletSource).toContain('deposit_duplicate');
  });
});

// ── Observability ───────────────────────────────────────────────────────────

describe('rejected deposits are observable without leaking secrets', () => {
  it.each([
    'deposit_verification_failed',
    'deposit_payment_intent_not_succeeded',
    'deposit_payment_intent_user_mismatch',
    'deposit_amount_mismatch',
    'deposit_duplicate',
  ])('emits %s', event => {
    // Rejection events are named by the shared decision function and logged by
    // the handler; either file naming the event satisfies the contract.
    expect(`${walletSource}${verificationSource}`).toContain(event);
  });

  it('never logs the token, the Stripe key or a client secret', () => {
    const logCalls = walletSource.match(/logDepositRejected\([\s\S]{0,400}?\}\);/g) ?? [];
    expect(logCalls.length).toBeGreaterThan(0);
    for (const call of logCalls) {
      expect(call).not.toMatch(/token|stripeKey|client_secret|clientSecret|authHeader/);
    }
  });
});
