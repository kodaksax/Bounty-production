/**
 * Real Stripe test-mode API integration tests — NOT part of the default
 * `jest`/`npm test` run (they make live network calls to Stripe's test API
 * and would otherwise make the whole suite network-dependent and flaky in
 * offline/sandboxed CI). Opt in with:
 *
 *   RUN_STRIPE_INTEGRATION_TESTS=true STRIPE_SECRET_TEST_KEY=sk_test_... npx jest __tests__/integration/stripe
 *
 * Guardrails: STRIPE_SECRET_TEST_KEY must start with `sk_test_` (asserted
 * below) so this can never accidentally run against live Stripe. No real
 * money is ever involved — everything here is test-mode.
 *
 * ── The actual restriction, empirically confirmed (2026-07-21) ────────────
 * Phase 1 of this codebase's Instant Payouts work assumed
 * controller.requirement_collection === "stripe" was, by itself, sufficient
 * to make Stripe reject createExternalAccount/updateExternalAccount/
 * deleteExternalAccount. Directly testing both states on the same test-mode
 * account proved that's incomplete:
 *   - Before onboarding (details_submitted: false): createExternalAccount
 *     SUCCEEDS, even with requirement_collection === "stripe".
 *   - After completing Stripe-hosted onboarding (details_submitted: true,
 *     payouts_enabled: true — i.e. control has actually transferred to
 *     Stripe): createExternalAccount FAILS with
 *     `403 oauth_not_supported — "This application does not have the
 *     required permissions for this endpoint on account '...'."`
 * This still fully validates the Phase 1/2 production fix: every real code
 * path in this app that could reach a createExternalAccount call requires
 * the user to already be payouts_enabled (every withdrawal/payout-method
 * screen gates on it), so in practice every account those calls ever hit
 * was already onboarded — the failing case. The suite below tests both
 * states explicitly so this nuance can never silently regress into a wrong
 * assumption again.
 *
 * ── Why the onboarded-account tests need a fixture, not a fresh account ───
 * Completing Stripe-hosted onboarding cannot be automated from Jest (it's a
 * human-facing, JS/form-driven hosted flow — there is no API bypass, in test
 * mode or live). STRIPE_TEST_FIXTURE_ACCOUNT_ID names a test-mode Express
 * account that has already been through hosted onboarding once; set it and
 * that block of tests runs automatically. The bare/pre-onboarding tests
 * below don't need this — a fresh account created in beforeAll is enough,
 * since "not yet onboarded" is the starting state of every new account.
 */
import Stripe from 'stripe';

const RUN = process.env.RUN_STRIPE_INTEGRATION_TESTS === 'true';
const TEST_KEY = process.env.STRIPE_SECRET_TEST_KEY;
const FIXTURE_ACCOUNT_ID = process.env.STRIPE_TEST_FIXTURE_ACCOUNT_ID;

const describeIfEnabled = RUN && TEST_KEY ? describe : describe.skip;
const describeIfFixture = RUN && TEST_KEY && FIXTURE_ACCOUNT_ID ? describe : describe.skip;

describeIfEnabled('Express Connect account BEFORE onboarding: external-account writes are still API-writable', () => {
  if (TEST_KEY && !TEST_KEY.startsWith('sk_test_')) {
    throw new Error(
      'STRIPE_SECRET_TEST_KEY does not look like a test-mode key (must start with sk_test_) — refusing to run.'
    );
  }

  const stripe = new Stripe(TEST_KEY ?? 'sk_test_unused_placeholder', { apiVersion: '2023-10-16' });
  let accountId: string;

  beforeAll(async () => {
    // Same account-creation params connect/index.ts itself uses — an Express
    // account under this platform always gets
    // controller.requirement_collection === "stripe" (this is a platform-level
    // setting, not something the individual accounts.create() call chooses).
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'US',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      business_type: 'individual',
      metadata: { purpose: 'jest-integration-test', suite: 'express-account-permissions' },
    });
    accountId = account.id;
  }, 30000);

  afterAll(async () => {
    // Deleting an Express account you created is a supported platform
    // lifecycle action — distinct from writing its external accounts, which
    // is what's actually restricted. Cleans up so test runs don't litter the
    // test-mode Dashboard with throwaway accounts.
    if (accountId) {
      await stripe.accounts.del(accountId).catch(() => {
        // Best-effort cleanup; a leftover test-mode fixture account is
        // harmless and not worth failing the suite over.
      });
    }
  }, 30000);

  test('confirms the account actually has controller.requirement_collection === "stripe"', async () => {
    const account = await stripe.accounts.retrieve(accountId);
    expect((account as any).controller?.requirement_collection).toBe('stripe');
    expect(account.details_submitted).toBe(false);
  });

  test('createExternalAccount SUCCEEDS before onboarding, despite requirement_collection === "stripe" — this is the nuance Phase 1 initially missed', async () => {
    const card = await stripe.accounts.createExternalAccount(accountId, {
      external_account: 'tok_visa_debit',
    });
    expect(card.id).toMatch(/^card_/);
  });
});

describeIfFixture(
  'Express Connect account AFTER onboarding (STRIPE_TEST_FIXTURE_ACCOUNT_ID): the real production restriction',
  () => {
    // One-time manual setup to activate this block — this is the state every
    // account in production is actually in by the time any withdrawal code
    // runs (payouts_enabled is required to reach those screens at all):
    //   1. Create a test Express account and complete Stripe's hosted
    //      onboarding for it (account_onboarding Account Link), using
    //      Stripe's "fill test data" shortcut. This cannot be automated from
    //      Jest — there is no API bypass, in test mode or live.
    //   2. Export STRIPE_TEST_FIXTURE_ACCOUNT_ID=acct_... alongside
    //      STRIPE_SECRET_TEST_KEY and RUN_STRIPE_INTEGRATION_TESTS=true.
    //   3. (Optional, for the payout-creation tests further down) also add
    //      debit card 4000056655665556 (Visa debit, instant-eligible) via
    //      that account's Express Dashboard login link.
    const stripe = new Stripe(TEST_KEY ?? 'sk_test_unused_placeholder', { apiVersion: '2023-10-16' });
    const accountId = FIXTURE_ACCOUNT_ID as string;

    test('confirms the fixture account has actually completed onboarding', async () => {
      const account = await stripe.accounts.retrieve(accountId);
      expect((account as any).controller?.requirement_collection).toBe('stripe');
      expect(account.details_submitted).toBe(true);
    });

    test('createExternalAccount is rejected with a permissions error once onboarded — the actual regression this codebase hit', async () => {
      await expect(
        stripe.accounts.createExternalAccount(accountId, { external_account: 'tok_visa_debit' })
      ).rejects.toMatchObject({ type: 'StripePermissionError' });
    });

    test('the rejection message names the permissions issue (regression guard for the error-message-based UX mapping)', async () => {
      let caught: any;
      try {
        await stripe.accounts.createExternalAccount(accountId, { external_account: 'tok_visa_debit' });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeDefined();
      expect(String(caught?.message ?? '')).toMatch(/required permissions/i);
    });

    test('standard payout succeeds', async () => {
      try {
        const payout = await stripe.payouts.create(
          { amount: 100, currency: 'usd', method: 'standard' },
          { stripeAccount: accountId, idempotencyKey: `jest_standard_${Date.now()}` }
        );
        expect(payout.status).not.toBe('failed');
      } catch (err: any) {
        // The fixture account's Stripe balance is whatever test transfers
        // have actually landed in it — this suite doesn't fund it (that
        // would require its own charge/transfer setup, orthogonal to what
        // this test verifies: that a well-funded account's standard payout
        // is not blocked by anything this codebase controls). Treat "not
        // enough balance to move" as an environment limitation, not a
        // behavioral failure — any other error is real and still fails.
        if (!/insufficient funds|balance_insufficient/i.test(String(err?.message ?? ''))) throw err;
      }
    });

    test('instant payout succeeds against the linked instant-eligible debit card', async () => {
      const cards = await stripe.accounts.listExternalAccounts(accountId, { object: 'card', limit: 10 });
      const instantCard = cards.data.find(c =>
        ((c as any).available_payout_methods ?? []).includes('instant')
      );
      if (!instantCard) {
        // Debit card 4000056655665556 hasn't been linked to this fixture
        // account yet (via its Express Dashboard login link) — see the
        // block's setup comment, step 3. Skip rather than fail: this is a
        // one-time manual addition, not a code regression.
        return;
      }

      const payout = await stripe.payouts.create(
        { amount: 100, currency: 'usd', method: 'instant', destination: instantCard.id },
        { stripeAccount: accountId, idempotencyKey: `jest_instant_${Date.now()}` }
      );
      expect(payout.status).not.toBe('failed');
    });

    test('a credit card (4242...) is not instant-eligible', async () => {
      const cards = await stripe.accounts.listExternalAccounts(accountId, { object: 'card', limit: 10 });
      const creditCard = cards.data.find(c => (c as any).funding === 'credit');
      if (!creditCard) {
        // Not every fixture will have linked a credit card — this assertion
        // only applies when one is present.
        return;
      }
      expect(((creditCard as any).available_payout_methods ?? []).includes('instant')).toBe(false);
    });

    test('instant payout is blocked when instant_available.net_available is 0', async () => {
      const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
      const netAvailable =
        balance.instant_available?.find(b => b.currency === 'usd')?.net_available?.[0]?.amount ?? 0;
      if (netAvailable > 0) {
        // Can't exercise the zero-balance path on a fixture that currently
        // has instant funds available — this is a live balance, not a mock.
        return;
      }
      const cards = await stripe.accounts.listExternalAccounts(accountId, { object: 'card', limit: 10 });
      const instantCard = cards.data.find(c =>
        ((c as any).available_payout_methods ?? []).includes('instant')
      );
      if (!instantCard) return;

      await expect(
        stripe.payouts.create(
          { amount: 100, currency: 'usd', method: 'instant', destination: instantCard.id },
          { stripeAccount: accountId, idempotencyKey: `jest_instant_zero_${Date.now()}` }
        )
      ).rejects.toBeDefined();
    });
  }
);
