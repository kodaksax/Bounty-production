/**
 * Phase 9 — production approval tests for the financial invariants.
 *
 * These assert the properties that must hold for the payment system to be
 * correct, independent of any single code path:
 *
 *   - one financial event produces one ledger event
 *   - no duplicate transfers
 *   - no duplicate payouts
 *   - retries and replayed webhooks are idempotent
 *   - concurrent withdrawals cannot double-spend
 *
 * The money-moving code lives in Deno edge functions that take live Stripe and
 * Supabase clients, so — following the convention in withdrawal-validation and
 * webhooks-contract — the enforcement points are asserted at source level,
 * while the pure decision logic is tested behaviourally.
 *
 * A source-level assertion is weaker than an end-to-end test, and these do NOT
 * substitute for the live-money verification tracked as R1. What they do catch
 * is a future edit silently removing an idempotency guard, which is the most
 * likely way these invariants get broken.
 */
import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '../../', p), 'utf8');

const connectSource = read('supabase/functions/connect/index.ts');
const webhooksSource = read('supabase/functions/webhooks/index.ts');
const walletSource = read('supabase/functions/wallet/index.ts');
const bountyPaymentsSource = read('supabase/functions/bounty-payments/index.ts');
const reconciliationSource = read('supabase/functions/reconciliation/index.ts');

describe('invariant: one financial event produces one ledger event', () => {
  it('every payout-creating route writes exactly one wallet_transactions row', () => {
    // The native handler is the single payout path for both instant and
    // standard; more than one insert would mean two rows per payout.
    const handlerStart = connectSource.indexOf('async function handleConnectNativePayout');
    const handlerEnd = connectSource.indexOf('\n}', connectSource.indexOf('remainingAvailableCents'));
    const handler = connectSource.slice(handlerStart, handlerEnd);
    const inserts = handler.match(/\.from\('wallet_transactions'\)\s*\n?\s*\.insert\(/g) ?? [];
    expect(inserts).toHaveLength(1);
  });

  it('deposits are keyed on the payment intent so a replay cannot double-credit', () => {
    expect(walletSource).toContain('stripe_payment_intent_id');
    expect(walletSource).toContain('apply_deposit');
  });

  it('reconciliation never inserts a wallet_transactions row', () => {
    // Reconciliation observes and may advance a status; inventing a ledger row
    // would manufacture a financial event that never happened.
    expect(reconciliationSource).not.toMatch(/from\('wallet_transactions'\)[\s\S]{0,80}\.insert\(/);
  });
});

describe('invariant: no duplicate payouts', () => {
  it('the native payout path replays instead of re-paying on a known key', () => {
    expect(connectSource).toContain("This withdrawal was already submitted and is being processed.");
    expect(connectSource).toMatch(/\.eq\(\s*'idempotency_key'\s*,\s*idempotencyKey\s*\)/);
  });

  it('passes an idempotency key to Stripe scoped by user, key, method and amount', () => {
    expect(connectSource).toContain(
      'native_payout_${method}_${userId}_${idempotencyKey}_${amountCents}'
    );
  });

  it('resolves the unique-index race without creating a second payout', () => {
    const idx = connectSource.indexOf("(txError as { code?: string }).code === '23505'");
    const block = connectSource.slice(idx, idx + 1200);
    // Stripe idempotency guarantees both callers resolved to the same payout,
    // so the loser reports the winner rather than paying again.
    expect(block).toContain('duplicate: true');
    expect(block).not.toContain('stripe.payouts.create');
  });

  it('enforces the instant daily cap before calling Stripe', () => {
    expect(connectSource).toContain('checkInstantDailyLimit');
  });
});

describe('invariant: no duplicate transfers', () => {
  it('the Connect-native path creates no transfer at all', () => {
    const handlerStart = connectSource.indexOf('async function handleConnectNativePayout');
    const handlerEnd = connectSource.indexOf('\n}', connectSource.indexOf('remainingAvailableCents'));
    const handler = connectSource.slice(handlerStart, handlerEnd);
    expect(handler).not.toContain('stripe.transfers.create');
  });

  it('the legacy transfer path passes a Stripe idempotency key', () => {
    // Retained for rollback; must stay safe while it exists.
    expect(connectSource).toMatch(/idempotencyKey:\s*`?(instant_)?transfer_/);
  });

  it('Phase 2 release ties the transfer to its source charge', () => {
    // source_transaction is what stops a release transferring funds the
    // platform never actually received for that bounty.
    expect(bountyPaymentsSource).toContain('source_transaction');
  });
});

describe('invariant: webhook replay and duplicate delivery are idempotent', () => {
  it('webhook events are deduplicated by Stripe event id', () => {
    expect(webhooksSource).toContain('stripe_events');
  });

  it('payout webhooks match the ledger row by stripe_payout_id', () => {
    expect(webhooksSource).toMatch(/\.eq\(\s*'stripe_payout_id'\s*,\s*payout\.id\s*\)/);
  });

  it('payout.paid tolerates the partial unique index rather than assuming insert succeeds', () => {
    const idx = webhooksSource.indexOf("case 'payout.paid'");
    expect(idx).toBeGreaterThan(-1);
    const block = webhooksSource.slice(idx, idx + 3000);
    expect(block).toContain('stripe_payout_id');
  });

  it('handles the terminal payout events, not just the happy path', () => {
    for (const evt of ['payout.paid', 'payout.failed', 'payout.canceled', 'payout.updated']) {
      expect(webhooksSource).toContain(`case '${evt}'`);
    }
  });
});

describe('invariant: concurrent withdrawals cannot double-spend', () => {
  it('the legacy path deducts through an atomic RPC, not a read-then-write', () => {
    // withdraw_balance performs the check and the debit under one lock; doing
    // it in application code would allow two concurrent requests to both pass.
    expect(connectSource).toContain("supabase.rpc('withdraw_balance'");
    const handlerStart = connectSource.indexOf("if (subPath === '/transfer')");
    const block = connectSource.slice(handlerStart, handlerStart + 6000);
    expect(block).not.toMatch(/update\(\s*\{\s*balance:/);
  });

  it('the native path relies on Stripe as the concurrency authority', () => {
    // There is no local balance to race on: two concurrent payouts exceeding
    // the Connect balance are rejected by Stripe with balance_insufficient,
    // which is mapped to a user-facing error rather than swallowed.
    expect(connectSource).toContain("case 'balance_insufficient':");
    expect(connectSource).toContain("code: 'insufficient_balance'");
  });

  it('the client hook blocks a second concurrent submission', () => {
    const hook = read('hooks/use-connect-payout.tsx');
    expect(hook).toContain('inFlightRef');
    expect(hook).toContain('if (inFlightRef.current) return null;');
  });

  it('a network failure retains the idempotency key so a retry cannot double-pay', () => {
    const hook = read('hooks/use-connect-payout.tsx');
    const catchIdx = hook.indexOf('catch (networkError)');
    const block = hook.slice(catchIdx, catchIdx + 700);
    // The key must NOT be cleared here — the request may have reached Stripe.
    expect(block).not.toContain('idempotencyKeyRef.current = null');
  });
});

describe('invariant: nothing is marked complete unless Stripe completed it', () => {
  it('the native payout records pending, never assumed completion', () => {
    const handlerStart = connectSource.indexOf('async function handleConnectNativePayout');
    const handlerEnd = connectSource.indexOf('\n}', connectSource.indexOf('remainingAvailableCents'));
    const handler = connectSource.slice(handlerStart, handlerEnd);
    expect(handler).toContain("status: 'pending'");
    expect(handler).not.toContain("status: 'completed'");
  });

  it('reconciliation only advances a ledger row from pending', () => {
    expect(reconciliationSource).toContain("if (ledgerStatus !== 'pending') return false");
    expect(reconciliationSource).toContain(".eq('status', 'pending')");
  });

  it('reconciliation never marks in-flight money as completed', () => {
    const normalizeIdx = reconciliationSource.indexOf('function normalizeStripeStatus');
    const block = reconciliationSource.slice(normalizeIdx, normalizeIdx + 500);
    const inTransitIdx = block.indexOf("case 'in_transit':");
    expect(block.slice(inTransitIdx, inTransitIdx + 60)).toContain("return 'pending'");
  });
});

describe('invariant: reconciliation cannot move money', () => {
  it('creates no Stripe objects', () => {
    expect(reconciliationSource).not.toContain('stripe.payouts.create');
    expect(reconciliationSource).not.toContain('stripe.transfers.create');
    expect(reconciliationSource).not.toContain('stripe.refunds.create');
    expect(reconciliationSource).not.toContain('stripe.paymentIntents.create');
  });

  it('never touches the balance RPCs', () => {
    expect(reconciliationSource).not.toContain('update_balance');
    expect(reconciliationSource).not.toContain('withdraw_balance');
    expect(reconciliationSource).not.toContain('apply_deposit');
  });

  it('the Stage B migration report is read-only', () => {
    const idx = reconciliationSource.indexOf("if (action === 'migration_report')");
    const end = reconciliationSource.indexOf("if (action !== 'run')", idx);
    const block = reconciliationSource.slice(idx, end);
    expect(block).not.toContain('.update(');
    expect(block).not.toContain('.insert(');
    expect(block).not.toContain('.delete(');
  });
});

describe('Stage A freeze migration is gated', () => {
  const freeze = read('supabase/migrations/20260727110000_freeze_profiles_balance_GATED.sql');

  it('creates the trigger DISABLED so applying the migration is itself safe', () => {
    expect(freeze).toContain('DISABLE TRIGGER trg_freeze_profiles_balance');
  });

  it('fails loudly rather than silently no-opping', () => {
    // A silent no-op would let forgotten legacy write paths keep running,
    // which defeats the entire purpose of Stage A.
    expect(freeze).toContain('RAISE EXCEPTION');
  });

  it('ignores profile updates that do not touch the frozen columns', () => {
    expect(freeze).toContain('IS NOT DISTINCT FROM OLD.balance');
  });

  it('documents the preconditions and the outage risk', () => {
    expect(freeze).toContain('DO NOT APPLY');
    expect(freeze).toContain('payment_architecture_version = 1');
  });
});
