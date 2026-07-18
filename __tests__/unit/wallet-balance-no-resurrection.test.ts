/**
 * Regression guard for the 2026-07-18 "legacy balance resurrection" fix.
 *
 * GET /wallet/balance (in all three server surfaces — the live Supabase Edge
 * Function, and the deprecated Express/Fastify mirrors) used to "reconcile" a
 * $0 cached profiles.balance by deriving a balance from
 * SUM(completed wallet_transactions) and writing it back to profiles.balance.
 * This was unsafe: a cached $0 can be legitimately correct (an in-flight
 * debit already happened, or a deliberate administrative write-off — see the
 * Wallet Phase 2 migration) even when completed-transaction history sums to
 * something positive. The "reconcile" would silently resurrect a phantom,
 * double-spendable balance.
 *
 * profiles.balance is now the sole source of truth for a balance read — every
 * operation that mutates it (apply_deposit, apply_escrow, apply_refund_tx,
 * apply_release_tx, withdraw_balance) already keeps it correct atomically, so
 * there is no legitimate reason for a balance-read endpoint to derive and
 * overwrite it. See docs/payments/WITHDRAWAL_SYSTEM_RUNBOOK.md §8/§9.
 *
 * This test reads the source files directly (rather than importing/executing
 * them) because two of the three are Deno edge functions / a CommonJS Express
 * server, which aren't directly importable under Jest — matching the existing
 * "contract test" pattern in withdrawal-validation.test.ts that keeps the
 * inlined connect/index.ts copy in sync with its sibling module.
 */
import * as fs from 'fs';
import * as path from 'path';

const SURFACES: Array<{ name: string; file: string }> = [
  { name: 'Supabase Edge Function (live)', file: 'supabase/functions/wallet/index.ts' },
  { name: 'Express server (deprecated mirror)', file: 'server/index.js' },
  {
    name: 'Fastify service (mirror)',
    file: 'services/api/src/services/consolidated-wallet-service.ts',
  },
];

describe('GET /wallet/balance must never resurrect a $0 balance from the ledger', () => {
  for (const { name, file } of SURFACES) {
    const source = fs.readFileSync(path.join(__dirname, '../../', file), 'utf8');

    test(`${name} (${file}) does not contain the removed reconcile-on-zero pattern`, () => {
      // These are the specific, low-false-positive markers of the removed
      // logic — not generic terms that would appear for unrelated reasons.
      expect(source).not.toContain('if (balance === 0)');
      expect(source).not.toMatch(/Reconciled stale profile balance/i);
      expect(source).not.toMatch(/deriveBalanceFromTransactions/);
    });
  }
});
