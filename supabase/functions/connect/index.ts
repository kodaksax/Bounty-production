// Supabase Edge Function: connect
// Handles all /connect/* routes previously served by the Node/Express server.
//
// These Connect accounts have controller.requirement_collection === "stripe"
// (verified live against a real connected account), which means Stripe
// itself owns writes to external accounts on them: the platform CANNOT call
// stripe.accounts.createExternalAccount / updateExternalAccount /
// deleteExternalAccount — Stripe rejects all three unconditionally with a
// permissions error, regardless of payouts_enabled or any other account
// state. Adding, removing, or setting a default bank account/debit card can
// therefore only happen through Stripe's own hosted Express Dashboard,
// reached via POST /connect/login-link. Routes:
//   POST /connect/create-account-link
//   POST /connect/create-account-session   (Stripe Connect Embedded Components)
//   POST /connect/login-link               (Express Dashboard login link — add/remove/default payout methods)
//   GET  /connect/embedded                 (HTML shim that mounts embedded components in a WebView)
//   POST /connect/verify-onboarding
//   POST /connect/transfer
//   POST /connect/retry-transfer
//   POST /connect/instant-payout           (Instant Cash Out to a linked debit card — flag-gated)
//   GET  /connect/bank-accounts            (list external bank accounts on Connect account)
//   POST /connect/bank-accounts            (410 DEPRECATED — use Financial Connections for deposits + login-link for payout accounts)
//   DELETE /connect/bank-accounts/:id      (410 DEPRECATED — use login-link)
//   POST /connect/bank-accounts/:id/default (410 DEPRECATED — use login-link)
//   GET  /connect/debit-cards              (list debit-card external accounts, Instant Cash Out only)
//   POST /connect/debit-cards              (410 DEPRECATED — use login-link)
//   DELETE /connect/debit-cards/:id        (410 DEPRECATED — use login-link)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'npm:stripe@14';
import type { Profile, WalletTransaction } from '../_shared/types.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Structured logging for the CRITICAL/manual-reconciliation-required cases —
// keeps the "CRITICAL" substring for backward-compatible grep against
// existing saved log searches while emitting one machine-parseable JSON blob
// per line instead of a message string plus a separate context object.
// Duplicated identically in webhooks/index.ts and admin-withdrawals/index.ts
// (local imports are not supported by the deploy bundler — see the
// withdrawal-validation helpers below for the same constraint).
function logCritical(event: string, context: Record<string, unknown>) {
  console.error(`CRITICAL [connect] ${event}`, JSON.stringify({ event, ts: new Date().toISOString(), ...context }));
}

// ─── Inlined from ./withdrawal-validation.ts ────────────────────────────────
// (local imports are not supported by the Supabase bundler — keep both copies
// in sync; the sibling module is the unit-tested source of truth)

// Guard against a misconfigured (non-numeric) env value silently disabling
// the limit entirely: `amount < NaN` and `amount > NaN` are both always
// `false`, so an invalid override would remove the min/max check rather
// than falling back to a safe default.
function readEnvNumber(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Minimum withdrawal in USD — env-configurable via WITHDRAW_MIN_USD; defaults to 10. */
const MIN_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MIN_USD', 10);

/** Maximum single withdrawal in USD (fraud/typo guard) — env-configurable via WITHDRAW_MAX_USD; defaults to 10000. */
const MAX_WITHDRAWAL_USD = readEnvNumber('WITHDRAW_MAX_USD', 10000);

type WithdrawalValidationResult =
  | { ok: true; amount: number; amountCents: number }
  | { ok: false; error: string; code: string };

function validateWithdrawalRequest(body: {
  amount?: unknown;
  currency?: unknown;
}): WithdrawalValidationResult {
  const rawAmount = Number(body?.amount);

  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    return {
      ok: false,
      error: 'Please enter a valid withdrawal amount.',
      code: 'invalid_amount',
    };
  }

  const amountCents = Math.round(rawAmount * 100);
  const amount = amountCents / 100;

  // Reject sub-cent precision (e.g. 10.001) instead of silently rounding.
  // The 1e-6 tolerance absorbs binary floating-point representation noise
  // (e.g. 10.10 * 100 === 1009.9999999999999) while still catching any real
  // sub-cent fraction, whose smallest distance from a whole cent is 0.1.
  if (Math.abs(rawAmount * 100 - amountCents) > 1e-6) {
    return {
      ok: false,
      error: 'Withdrawal amount cannot include fractions of a cent.',
      code: 'invalid_amount_precision',
    };
  }

  if (amount < MIN_WITHDRAWAL_USD) {
    return {
      ok: false,
      error: `The minimum withdrawal amount is $${MIN_WITHDRAWAL_USD.toFixed(2)}.`,
      code: 'below_minimum',
    };
  }

  if (amount > MAX_WITHDRAWAL_USD) {
    return {
      ok: false,
      error: `The maximum withdrawal amount is $${MAX_WITHDRAWAL_USD.toLocaleString('en-US')} per transfer. Please contact support for larger withdrawals.`,
      code: 'above_maximum',
    };
  }

  const currency = typeof body?.currency === 'string' ? body.currency.toLowerCase() : 'usd';
  if (currency !== 'usd') {
    return {
      ok: false,
      error: 'Only USD withdrawals are supported.',
      code: 'unsupported_currency',
    };
  }

  return { ok: true, amount, amountCents };
}

function mapStripeTransferError(err: {
  code?: string;
  type?: string;
  message?: string;
}): { error: string; code: string; status: number } {
  const code = err?.code ?? '';
  const type = err?.type ?? '';

  if (code === 'balance_insufficient') {
    return {
      error:
        'Withdrawals are temporarily unavailable. Your balance has not been charged — please try again later.',
      code: 'platform_balance_insufficient',
      status: 503,
    };
  }

  if (code === 'account_invalid' || code === 'transfers_not_allowed') {
    return {
      error:
        'Your linked bank account cannot receive transfers right now. Please review your payout details in your account settings.',
      code: 'destination_account_invalid',
      status: 400,
    };
  }

  if (type === 'StripeConnectionError' || type === 'api_connection_error') {
    return {
      error:
        'We could not reach our payment provider. Your balance has not been charged — please try again.',
      code: 'stripe_unreachable',
      status: 503,
    };
  }

  if (type === 'idempotency_error' || type === 'StripeIdempotencyError') {
    return {
      error:
        'This withdrawal request conflicts with a previous attempt. Please start a new withdrawal.',
      code: 'idempotency_conflict',
      status: 409,
    };
  }

  return {
    error:
      'The transfer could not be completed. Your balance has not been charged — please try again or contact support.',
    code: 'transfer_failed',
    status: 502,
  };
}

function mapWithdrawBalanceError(message: string | undefined): {
  error: string;
  code: string;
  status: number;
} {
  const msg = message ?? '';

  if (/frozen/i.test(msg)) {
    return {
      error:
        'Your balance is temporarily frozen due to an open payment dispute. Withdrawals will be available once the dispute is resolved.',
      code: 'balance_frozen',
      status: 403,
    };
  }

  if (/insufficient/i.test(msg)) {
    return {
      error:
        'Insufficient available balance. Part of your balance may be on hold or already reserved.',
      code: 'insufficient_balance',
      status: 400,
    };
  }

  return {
    error: 'Failed to reserve your balance for withdrawal. Please try again.',
    code: 'balance_reservation_failed',
    status: 500,
  };
}

// ─── Withdrawal destination (bank account) resolution ───────────────────────
// See the identical, documented copy in ./withdrawal-validation.ts for the
// full rationale and the documented residual limitation. Keep in sync.

interface ExternalAccountSummary {
  id: string;
  default_for_currency?: boolean | null;
  bank_name?: string | null;
  last4?: string | null;
}

type DestinationResolution =
  | {
      ok: true;
      targetAccount: ExternalAccountSummary;
      needsDefaultUpdate: boolean;
    }
  | {
      ok: false;
      error: string;
      code: string;
    };

function resolveWithdrawalDestination(
  accounts: ExternalAccountSummary[],
  requestedBankAccountId: string | undefined
): DestinationResolution {
  if (accounts.length === 0) {
    return {
      ok: false,
      error: 'No bank account is linked to your payout account. Please add one before withdrawing.',
      code: 'no_bank_account',
    };
  }

  if (requestedBankAccountId) {
    const requested = accounts.find(a => a.id === requestedBankAccountId);
    if (!requested) {
      return {
        ok: false,
        error:
          'Your selected bank account could not be found on your payout account. Please refresh and try again.',
        code: 'bank_account_not_found',
      };
    }
    return { ok: true, targetAccount: requested, needsDefaultUpdate: !requested.default_for_currency };
  }

  const current = accounts.find(a => a.default_for_currency) ?? accounts[0];
  return { ok: true, targetAccount: current, needsDefaultUpdate: false };
}

type AccountEligibilityResult = { ok: true } | { ok: false; error: string; code: string };

// Blocks self-service /transfer and /instant-payout for suspended/banned
// accounts (profiles.account_status). Deliberately not applied to
// admin-withdrawals' recovery actions — see withdrawal-validation.ts for
// the full rationale. Keep in sync.
function validateAccountEligibility(accountStatus: string | null | undefined): AccountEligibilityResult {
  if (accountStatus === 'suspended' || accountStatus === 'banned') {
    return {
      ok: false,
      error: 'Withdrawals are unavailable while your account is under review. Contact support for details.',
      code: 'account_not_eligible',
    };
  }
  return { ok: true };
}
// ─── End inlined withdrawal-validation helpers ──────────────────────────────

// ─── Inlined from ./instant-payout-validation.ts ────────────────────────────
// (local imports are not supported by the Supabase bundler — keep both
// copies in sync; the sibling module is the unit-tested source of truth)

// Named distinctly from readEnvNumber() above (rather than reusing it)
// because both inlined copies coexist in this module's scope, where two
// `function readEnvNumber` declarations would collide.
function readEnvNumberForInstantPayout(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Estimated instant-payout fee rate, as a percent — env-configurable via INSTANT_PAYOUT_FEE_PERCENT; defaults to 1 (%). */
const INSTANT_PAYOUT_FEE_PERCENT = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_PERCENT', 1);

/** Estimated minimum instant-payout fee in USD — env-configurable via INSTANT_PAYOUT_FEE_MIN_USD; defaults to 0.50. */
const INSTANT_PAYOUT_FEE_MIN_USD = readEnvNumberForInstantPayout('INSTANT_PAYOUT_FEE_MIN_USD', 0.5);

/**
 * Estimates the instant-payout fee (in whole cents) for pre-confirmation
 * display only — the authoritative fee is whatever Stripe actually charges
 * on the created Payout, reconciled via the payout.paid/payout.updated
 * webhook handling in webhooks/index.ts.
 */
function estimateInstantFeeCents(amountCents: number): number {
  const percentFee = Math.round((amountCents * INSTANT_PAYOUT_FEE_PERCENT) / 100);
  const minFeeCents = Math.round(INSTANT_PAYOUT_FEE_MIN_USD * 100);
  return Math.max(percentFee, minFeeCents);
}

interface InstantCardSummary {
  id: string;
  brand?: string | null;
  last4?: string | null;
  available_payout_methods?: string[] | null;
}

type InstantDestinationResolution =
  | { ok: true; targetCard: InstantCardSummary }
  | { ok: false; error: string; code: string };

/**
 * Decides which linked debit card an Instant Cash Out should target. Unlike
 * resolveWithdrawalDestination() above, this NEVER instructs promoting the
 * chosen card to default_for_currency — Stripe's automatic payout sweep
 * (which still drives every *standard* withdrawal) must keep targeting the
 * bank account, never a linked instant-payout card.
 */
function resolveInstantDestination(
  cards: InstantCardSummary[],
  requestedCardId: string | undefined
): InstantDestinationResolution {
  if (cards.length === 0) {
    return {
      ok: false,
      error: 'No debit card is linked for Instant Cash Out. Add a debit card to use this feature.',
      code: 'no_debit_card',
    };
  }

  const instantEligible = cards.filter(
    c => Array.isArray(c.available_payout_methods) && c.available_payout_methods.includes('instant')
  );

  if (requestedCardId) {
    const requested = cards.find(c => c.id === requestedCardId);
    if (!requested) {
      return {
        ok: false,
        error: 'Your selected debit card could not be found. Please refresh and try again.',
        code: 'debit_card_not_found',
      };
    }
    const isEligible = Array.isArray(requested.available_payout_methods)
      && requested.available_payout_methods.includes('instant');
    if (!isEligible) {
      return {
        ok: false,
        error:
          'This debit card does not currently support Instant Cash Out. Choose a different card, or use a standard bank withdrawal instead.',
        code: 'card_not_instant_eligible',
      };
    }
    return { ok: true, targetCard: requested };
  }

  if (instantEligible.length === 0) {
    return {
      ok: false,
      error:
        "None of your linked debit cards currently support Instant Cash Out. This is determined by your card's bank and may change — you can still withdraw normally to your bank account.",
      code: 'no_instant_eligible_card',
    };
  }

  return { ok: true, targetCard: instantEligible[0] };
}

// Instant-specific limits — see the identical, documented copy in
// ./instant-payout-validation.ts for the full rationale. Keep in sync.
const INSTANT_PAYOUT_MAX_USD = readEnvNumberForInstantPayout('INSTANT_PAYOUT_MAX_USD', 9999);
const MAX_INSTANT_PAYOUTS_PER_DAY = readEnvNumberForInstantPayout('MAX_INSTANT_PAYOUTS_PER_DAY', 10);

type InstantLimitResult = { ok: true } | { ok: false; error: string; code: string };

function validateInstantAmount(amount: number): InstantLimitResult {
  if (amount > INSTANT_PAYOUT_MAX_USD) {
    return {
      ok: false,
      error: `Instant Cash Out is limited to $${INSTANT_PAYOUT_MAX_USD.toLocaleString('en-US')} per transfer. Please use a standard bank withdrawal for larger amounts.`,
      code: 'above_instant_maximum',
    };
  }
  return { ok: true };
}

function checkInstantBalance(amountCents: number, netAvailableCents: number): InstantLimitResult {
  if (amountCents > netAvailableCents) {
    return {
      ok: false,
      error:
        'Your Stripe balance available for Instant Cash Out is lower than this amount right now. Try a smaller amount, or use a standard bank withdrawal.',
      code: 'insufficient_instant_balance',
    };
  }
  return { ok: true };
}

function checkInstantDailyLimit(countToday: number): InstantLimitResult {
  if (countToday >= MAX_INSTANT_PAYOUTS_PER_DAY) {
    return {
      ok: false,
      error: `You've reached the limit of ${MAX_INSTANT_PAYOUTS_PER_DAY} Instant Cash Outs per day. Please try again tomorrow, or use a standard bank withdrawal.`,
      code: 'daily_instant_limit_reached',
    };
  }
  return { ok: true };
}
// ─── End inlined instant-payout-validation helpers ──────────────────────────

// ─── Staged Phase 2 retirement of the legacy wallet-balance withdrawal path ─
// When true, /connect/transfer and /connect/retry-transfer return 410 Gone
// (mirroring the completed /bank-accounts deprecation further below) instead
// of running the legacy custodial-wallet withdrawal flow. Off by default —
// this is a STAGED step for the Stripe Phase 2 migration
// (see supabase/functions/bounty-payments) and must not be flipped on until
// production wallet balances are confirmed fully migrated. The legacy
// withdrawal logic below is left completely intact; this only adds a guard
// in front of it.
const CONNECT_TRANSFER_RETIRED = Deno.env.get('CONNECT_TRANSFER_RETIRED') === 'true';

function legacyTransferRetiredResponse() {
  return jsonResponse(
    {
      error:
        'Wallet-balance withdrawals are being retired in favor of the new Stripe-backed payout flow. Please contact support if you still have a pending balance.',
      code: 'legacy_transfer_deprecated',
      migrate_to: '/functions/v1/bounty-payments',
    },
    410,
  );
}

// ─── Instant Cash Out rollout flag ───────────────────────────────────────────
// Off by default. POST /connect/instant-payout and the debit-card management
// routes are implemented and safe to deploy inert, but must not be flipped on
// in production until: (1) the migration adding wallet_transactions'
// payout_method/stripe_payout_id/instant_fee_amount columns has been applied,
// (2) an end-to-end Instant Cash Out has been exercised against a Stripe
// test-mode account (add a test card, confirm available_payout_methods
// includes 'instant', run a payout, confirm the webhook updates the row),
// and (3) a standard withdrawal has been re-confirmed to still route to the
// bank account, never a linked card — see docs/withdrawals/13-instant-cash-out.md.
const INSTANT_CASHOUT_ENABLED = Deno.env.get('INSTANT_CASHOUT_ENABLED') === 'true';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split('/connect');
  const subPath = pathParts.length > 1 ? pathParts[1] : '/';

  // GET /connect/embedded — HTML shim loaded inside a React Native WebView.
  // Public (no auth header) because WebView's initial navigation cannot set
  // Authorization. The page itself does NOT call Stripe with any secret; it
  // only receives a short-lived client_secret via postMessage from the app.
  if (req.method === 'GET' && subPath === '/embedded') {
    return new Response(renderEmbeddedPage(), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        // Allow loading Stripe's Connect JS and API from the CDN.
        'Content-Security-Policy':
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' https://connect-js.stripe.com https://js.stripe.com; " +
          'frame-src https://connect-js.stripe.com https://js.stripe.com; ' +
          'connect-src https://api.stripe.com https://connect-js.stripe.com https://merchant-ui-api.stripe.com; ' +
          "img-src 'self' data: https:; " +
          "style-src 'self' 'unsafe-inline';",
      },
    });
  }

  const isBankAccountsPath = subPath === '/bank-accounts' || subPath.startsWith('/bank-accounts/');
  const isDebitCardsPath = subPath === '/debit-cards' || subPath.startsWith('/debit-cards/');
  if (
    req.method !== 'POST' &&
    !(req.method === 'GET' && (isBankAccountsPath || isDebitCardsPath)) &&
    !(req.method === 'DELETE' && (isBankAccountsPath || isDebitCardsPath))
  ) {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500);
  }
  const stripe = new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Authenticate user
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
  }
  const token = authHeader.substring(7);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }
  const userId = user.id;

  try {
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:8081';

    // POST /connect/create-account-link
    if (subPath === '/create-account-link') {
      const body = await req.json();
      const { returnUrl, refreshUrl, type: linkType } = body;

      // Supported link types: 'account_onboarding' (default) and 'account_update'
      const accountLinkType: 'account_onboarding' | 'account_update' =
        linkType === 'account_update' ? 'account_update' : 'account_onboarding';

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, email')
        .eq('id', userId)
        .single();

      const profileRow = profile as Profile | null;
      let accountId = profileRow?.stripe_connect_account_id;

      if (!accountId) {
        if (accountLinkType === 'account_update') {
          // Cannot update an account that doesn't exist yet
          return jsonResponse(
            {
              error: 'No Stripe Connect account found to update. Please complete onboarding first.',
            },
            400
          );
        }
        const account = await stripe.accounts.create({
          type: 'express',
          email: profileRow?.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: { user_id: userId },
        });
        accountId = account.id;
        await supabase
          .from('profiles')
          .update({ stripe_connect_account_id: accountId })
          .eq('id', userId);
        console.log(`[connect] Created new account: ${accountId} for user ${userId}`);
      }

      const accountLink = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl ?? `${appUrl}/wallet/connect/refresh`,
        return_url: returnUrl ?? `${appUrl}/wallet/connect/return`,
        type: accountLinkType,
      });

      return jsonResponse({
        url: accountLink.url,
        accountId,
        expiresAt: accountLink.expires_at * 1000,
      });
    }

    // POST /connect/login-link — a fresh, single-use link into the user's
    // Stripe Express Dashboard. This is the ONLY supported way for a hunter
    // to add, remove, or set a default bank account / debit card: these
    // Connect accounts have controller.requirement_collection === "stripe",
    // so Stripe rejects stripe.accounts.createExternalAccount /
    // updateExternalAccount / deleteExternalAccount from the platform side
    // with a permissions error, unconditionally — Stripe itself owns writes
    // to external accounts for these accounts. See the (now-deprecated)
    // /debit-cards, /bank-accounts/:id, and /bank-accounts/:id/default
    // handlers below for the endpoints this replaces.
    if (req.method === 'POST' && subPath === '/login-link') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, stripe_connect_onboarded_at')
        .eq('id', userId)
        .single();

      const p = profile as { stripe_connect_account_id?: string; stripe_connect_onboarded_at?: string } | null;
      const accountId = p?.stripe_connect_account_id;
      if (!accountId || !p?.stripe_connect_onboarded_at) {
        return jsonResponse(
          {
            error: 'Complete Stripe Connect onboarding before managing payout methods.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      try {
        const loginLink = await stripe.accounts.createLoginLink(accountId);
        return jsonResponse({ url: loginLink.url });
      } catch (loginLinkError) {
        console.error('[connect/login-link] failed to create login link', {
          userId,
          accountId,
          error: (loginLinkError as { message?: string })?.message,
        });
        return jsonResponse(
          { error: 'Could not open your payout dashboard. Please try again.', code: 'login_link_failed' },
          502
        );
      }
    }

    // POST /connect/create-account-session
    // Creates a Stripe Connect Account Session for Embedded Components.
    // If the user doesn't have a Connect account yet, one is created lazily
    // (Express account, individual, card_payments + transfers capabilities).
    if (subPath === '/create-account-session') {
      const publishableKey = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
      if (!publishableKey) {
        console.error('[connect] STRIPE_PUBLISHABLE_KEY not configured');
        return jsonResponse({ error: 'Stripe publishable key not configured' }, 500);
      }

      const body = await req.json().catch(() => ({}));
      const components =
        body && typeof body.components === 'object' && body.components !== null
          ? body.components
          : { account_onboarding: true, payments: true, payouts: true };

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, email')
        .eq('id', userId)
        .single();

      const profileRow = profile as Profile | null;
      let accountId = profileRow?.stripe_connect_account_id;

      if (!accountId) {
        const requestedCountry =
          typeof body.country === 'string' ? body.country.trim().toUpperCase() : '';
        const country = /^[A-Z]{2}$/.test(requestedCountry) ? requestedCountry : 'US';
        const account = await stripe.accounts.create({
          type: 'express',
          country,
          email: profileRow?.email ?? undefined,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          business_type: 'individual',
          metadata: { user_id: userId },
        });
        accountId = account.id;
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ stripe_connect_account_id: accountId })
          .eq('id', userId);
        if (updateError) {
          console.error('[connect] Failed to persist stripe_connect_account_id', {
            userId,
            accountId,
            error: updateError,
          });
          // We created an orphan Stripe account; surface the error so the client retries.
          return jsonResponse({ error: 'Failed to save account. Please try again.' }, 500);
        }
        console.log(`[connect] Created new Express account ${accountId} for user ${userId}`);
      }

      // Build the components payload. Accept either:
      //   { account_onboarding: true, payments: true }
      //   { account_onboarding: { enabled: true, features: { ... } }, ... }
      type ComponentSpec = boolean | { enabled?: boolean; features?: Record<string, unknown> };
      const normalize = (spec: ComponentSpec, defaultFeatures?: Record<string, unknown>) => {
        if (spec === false || spec === undefined) return undefined;
        if (spec === true) {
          return { enabled: true, ...(defaultFeatures ? { features: defaultFeatures } : {}) };
        }
        if (typeof spec === 'object' && spec.enabled !== false) {
          return {
            enabled: true,
            ...(spec.features
              ? { features: spec.features }
              : defaultFeatures
                ? { features: defaultFeatures }
                : {}),
          };
        }
        return undefined;
      };

      const componentsPayload: Record<string, unknown> = {};
      const accountOnboardingConfig = normalize(components.account_onboarding, {
        external_account_collection: true,
      });
      if (accountOnboardingConfig) componentsPayload.account_onboarding = accountOnboardingConfig;
      const paymentsConfig = normalize(components.payments, {
        refund_management: true,
        dispute_management: true,
        capture_payments: true,
      });
      if (paymentsConfig) componentsPayload.payments = paymentsConfig;
      const payoutsConfig = normalize(components.payouts, {
        instant_payouts: false,
        standard_payouts: true,
        edit_payout_schedule: false,
      });
      if (payoutsConfig) componentsPayload.payouts = payoutsConfig;

      if (Object.keys(componentsPayload).length === 0) {
        componentsPayload.account_onboarding = { enabled: true };
      }

      const accountSession = await stripe.accountSessions.create({
        account: accountId,
        components: componentsPayload as Stripe.AccountSessionCreateParams.Components,
      });

      return jsonResponse({
        clientSecret: accountSession.client_secret,
        publishableKey,
        accountId,
        expiresAt: accountSession.expires_at * 1000,
      });
    }

    // POST /connect/verify-onboarding
    if (subPath === '/verify-onboarding') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, stripe_connect_onboarded_at, payout_failed_at')
        .eq('id', userId)
        .single();

      const profileRow = profile as (Profile & { payout_failed_at?: string | null }) | null;
      if (!profileRow?.stripe_connect_account_id) {
        return jsonResponse({ onboarded: false });
      }

      const account = await stripe.accounts.retrieve(profileRow.stripe_connect_account_id);
      const onboarded = account.charges_enabled && account.payouts_enabled;

      const profileUpdates: Record<string, unknown> = {};

      if (onboarded && !profileRow.stripe_connect_onboarded_at) {
        profileUpdates.stripe_connect_onboarded_at = new Date().toISOString();
      }

      // Clear payout_failed_at when payouts are re-enabled so the recovery banner dismisses
      if (account.payouts_enabled && profileRow.payout_failed_at) {
        profileUpdates.payout_failed_at = null;
        profileUpdates.payout_failure_code = null;
        console.log(`[connect] Cleared payout_failed_at for user ${userId} — payouts re-enabled`);
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update(profileUpdates)
          .eq('id', userId);

        if (updateError) {
          console.error('[connect] Failed to update profile during verify-onboarding', {
            userId,
            error: updateError,
          });
          return jsonResponse({ error: 'Failed to update account status. Please try again.' }, 500);
        }
      }

      return jsonResponse({
        onboarded,
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        payoutFailedCleared: account.payouts_enabled && !!profileRow.payout_failed_at,
        requirementsCurrentlyDue: account.requirements?.currently_due ?? [],
        disabledReason: account.requirements?.disabled_reason ?? null,
      });
    }

    // POST /connect/transfer
    if (subPath === '/transfer') {
      if (CONNECT_TRANSFER_RETIRED) return legacyTransferRetiredResponse();
      const body = await req.json();

      // Server-side validation: finite, whole-cent, min/max, USD only.
      const validation = validateWithdrawalRequest(body);
      if (!validation.ok) {
        console.warn('[connect/transfer] validation failed', {
          userId,
          code: validation.code,
        });
        return jsonResponse({ error: validation.error, code: validation.code }, 400);
      }
      const amount = validation.amount;
      const currency = 'usd';

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 200)
          : undefined;

      // Which external bank account the hunter selected in the withdraw
      // screen. Optional for backward compatibility with older clients; see
      // resolveWithdrawalDestination() above for why this is now required to
      // actually control where the money goes (it previously wasn't wired
      // through at all — see docs/payments/BOUNTY_WITHDRAWAL_TECHNICAL_SPECIFICATION.md §3.8).
      const requestedBankAccountId =
        typeof body.bankAccountId === 'string' && body.bankAccountId.trim()
          ? body.bankAccountId.trim()
          : undefined;

      console.log('[connect/transfer] withdrawal requested', {
        userId,
        amount,
        hasIdempotencyKey: !!idempotencyKey,
        hasBankAccountId: !!requestedBankAccountId,
      });

      // Idempotency replay: if this key was already processed, return the
      // recorded withdrawal instead of creating a duplicate payout.
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from('wallet_transactions')
          .select('id, stripe_transfer_id, stripe_connect_account_id, amount, status')
          .eq('user_id', userId)
          .eq('type', 'withdrawal')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existing) {
          const e = existing as WalletTransaction & { stripe_connect_account_id?: string };
          console.log('[connect/transfer] idempotent replay', {
            userId,
            transactionId: e.id,
            transferId: e.stripe_transfer_id,
          });
          const { data: replayProfile } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
          const replayBalance =
            typeof (replayProfile as { balance?: number } | null)?.balance === 'number'
              ? (replayProfile as { balance: number }).balance
              : null;
          return jsonResponse({
            transferId: e.stripe_transfer_id,
            status: e.status ?? 'pending',
            amount: Math.abs(e.amount),
            currency,
            accountId: e.stripe_connect_account_id,
            transactionId: e.id,
            newBalance: replayBalance,
            duplicate: true,
            estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            message: 'This withdrawal was already submitted and is being processed.',
          });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('balance, balance_on_hold, stripe_connect_account_id, stripe_connect_onboarded_at, account_status')
        .eq('id', userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404);
      }

      const p = profile as Profile;

      const accountEligibility = validateAccountEligibility(p.account_status);
      if (!accountEligibility.ok) {
        console.warn('[connect/transfer] blocked for account_status', { userId, accountStatus: p.account_status });
        return jsonResponse({ error: accountEligibility.error, code: accountEligibility.code }, 403);
      }

      if (!p.stripe_connect_account_id || !p.stripe_connect_onboarded_at) {
        return jsonResponse(
          {
            error:
              'Your payout account is not set up yet. Please complete Stripe Connect onboarding before withdrawing.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      // Live payout eligibility check: onboarding may have been completed in
      // the past but the account can become restricted (missing requirements,
      // disabled payouts, disconnected bank). Verify with Stripe before
      // touching the user's balance.
      try {
        const account = await stripe.accounts.retrieve(p.stripe_connect_account_id);
        if (!account.payouts_enabled) {
          console.warn('[connect/transfer] payouts disabled on connected account', {
            userId,
            accountId: p.stripe_connect_account_id,
            disabledReason: account.requirements?.disabled_reason ?? null,
          });
          return jsonResponse(
            {
              error:
                'Payouts are currently disabled on your account. Please review and update your payout details, then try again.',
              code: 'payouts_disabled',
            },
            400
          );
        }
      } catch (accountError) {
        console.error('[connect/transfer] failed to verify connected account', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (accountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not verify your payout account. Your balance has not been charged — please try again.',
            code: 'account_verification_failed',
          },
          503
        );
      }

      // Resolve and (if needed) promote the destination bank account BEFORE
      // touching the balance. stripe.transfers.create() below only moves
      // funds into the connected account's shared Stripe balance — Stripe's
      // own automatic payout schedule later sweeps that balance to whichever
      // external account is `default_for_currency` at sweep time. Making the
      // hunter's selection authoritative here is what actually fixes "money
      // sent to the wrong account" (see the extended rationale next to
      // resolveWithdrawalDestination() above).
      let destinationAccount: ExternalAccountSummary;
      try {
        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'bank_account', limit: 100 }
        );
        const summaries: ExternalAccountSummary[] = externalAccounts.data.map(ba => ({
          id: ba.id,
          default_for_currency: (ba as unknown as { default_for_currency?: boolean }).default_for_currency,
          bank_name: (ba as unknown as { bank_name?: string }).bank_name ?? null,
          last4: (ba as unknown as { last4?: string }).last4 ?? null,
        }));

        const destination = resolveWithdrawalDestination(summaries, requestedBankAccountId);
        if (!destination.ok) {
          console.warn('[connect/transfer] bank account resolution failed', {
            userId,
            code: destination.code,
            requestedBankAccountId,
          });
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }

        destinationAccount = destination.targetAccount;

        // CANNOT promote destinationAccount to default_for_currency here:
        // these Connect accounts have controller.requirement_collection ===
        // "stripe", so stripe.accounts.updateExternalAccount is rejected by
        // Stripe with a permissions error unconditionally — there is no
        // "payouts disabled" case that unblocks it, it always fails. Fail
        // closed immediately with a clear, actionable message instead of
        // attempting (and always losing to) that call. The user must set
        // their selected bank as default themselves via the Stripe payout
        // dashboard (POST /connect/login-link) — Stripe's own automatic
        // payout sweep pays out to whichever account is default at sweep
        // time, so this is the only account that can correctly receive it.
        if (destination.needsDefaultUpdate) {
          console.warn('[connect/transfer] selected bank account is not the default payout account', {
            userId,
            accountId: p.stripe_connect_account_id,
            bankAccountId: destinationAccount.id,
          });
          return jsonResponse(
            {
              error:
                'This bank account is not your default payout method. Open your payout dashboard to set it as default, then try again.',
              code: 'bank_account_not_default',
            },
            400
          );
        }
      } catch (bankAccountError) {
        console.error('[connect/transfer] failed to resolve/set destination bank account', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (bankAccountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not confirm your payout destination. Your balance has not been charged — please try again.',
            code: 'bank_account_resolution_failed',
          },
          503
        );
      }

      // Enforce hold: available = balance - balance_on_hold (pre-check; the
      // withdraw_balance RPC re-enforces this atomically under a row lock).
      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        console.warn('[connect/transfer] insufficient available balance', { userId, amount });
        return jsonResponse(
          {
            error:
              'Insufficient available balance. Part of your balance may be on hold or already reserved.',
            code: 'insufficient_balance',
          },
          400
        );
      }

      // Deduct balance atomically via withdraw_balance which enforces the
      // hold check and dispute freeze, and returns the new balance.
      const { data: newBalanceData, error: balanceError } = await supabase.rpc(
        'withdraw_balance',
        {
          p_user_id: userId,
          p_amount: amount,
        }
      );

      if (balanceError) {
        console.error('[connect/transfer] Error deducting balance before transfer:', {
          userId,
          amount,
          error: balanceError.message,
        });
        const mapped = mapWithdrawBalanceError(balanceError.message);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      const newBalance = typeof newBalanceData === 'number' ? newBalanceData : null;

      let transfer: Stripe.Transfer;
      try {
        console.log('[connect/transfer] creating Stripe transfer', {
          userId,
          amountCents: validation.amountCents,
          accountId: p.stripe_connect_account_id,
        });
        transfer = await stripe.transfers.create(
          {
            amount: validation.amountCents,
            currency,
            destination: p.stripe_connect_account_id,
            metadata: { user_id: userId, ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}) },
          },
          // Stripe-side idempotency: retries of the same client key with the
          // same amount cannot create a second transfer even if two requests
          // race past the DB replay check above.
          idempotencyKey
            ? { idempotencyKey: `transfer_${userId}_${idempotencyKey}_${validation.amountCents}` }
            : undefined
        );
      } catch (stripeError) {
        // Refund the deducted balance if Stripe transfer creation fails
        const errInfo = stripeError as { code?: string; type?: string; message?: string };
        console.error('[connect/transfer] Transfer creation failed, refunding balance:', {
          userId,
          amount,
          stripeCode: errInfo?.code,
          stripeType: errInfo?.type,
          message: errInfo?.message,
        });
        const { error: refundError } = await supabase.rpc('update_balance', {
          p_user_id: userId,
          p_amount: amount,
        });
        if (refundError) {
          logCritical('balance refund after failed transfer also failed — manual reconciliation required', {
            userId, amount, error: refundError,
          });
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
            },
            500
          );
        }
        const mapped = mapStripeTransferError(errInfo);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      console.log('[connect/transfer] Stripe transfer created', {
        userId,
        transferId: transfer.id,
      });

      // Stripe transfers to a connected account's balance are synchronous —
      // by the time stripe.transfers.create() above returned without throwing,
      // the funds have already moved. There is no `transfer.paid` webhook for
      // this flow (that event, along with `transfer.failed`, belongs to a
      // legacy recipient-transfer API and is never delivered here), so
      // recording this as 'pending' and waiting on a webhook to promote it
      // would leave the row stuck forever. Record it as 'completed' now;
      // `payout.failed` already expects a 'completed' row to roll back if the
      // later bank-level payout fails.
      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'withdrawal',
          amount: -amount,
          description: 'Withdrawal to bank account',
          status: 'completed',
          stripe_transfer_id: transfer.id,
          stripe_connect_account_id: p.stripe_connect_account_id,
          idempotency_key: idempotencyKey ?? null,
          metadata: {
            transfer_id: transfer.id,
            idempotency_key: idempotencyKey ?? null,
            destination_bank_account_id: destinationAccount.id,
            destination_bank_last4: destinationAccount.last4 ?? null,
            destination_bank_name: destinationAccount.bank_name ?? null,
          },
        })
        .select()
        .single();

      if (txError) {
        // Unique violation on (user_id, idempotency_key): a concurrent
        // duplicate request won the insert race. Stripe idempotency ensured
        // both requests share ONE transfer, but the balance was deducted
        // twice — refund this request's deduction and replay the winner.
        if ((txError as { code?: string }).code === '23505' && idempotencyKey) {
          console.warn('[connect/transfer] concurrent duplicate detected, refunding extra deduction', {
            userId,
            transferId: transfer.id,
          });
          const { error: dupRefundError } = await supabase.rpc('update_balance', {
            p_user_id: userId,
            p_amount: amount,
          });
          if (dupRefundError) {
            logCritical('refund of duplicate deduction failed — manual reconciliation required', {
              userId, amount, error: dupRefundError,
            });
          }

          const { data: winner } = await supabase
            .from('wallet_transactions')
            .select('id, stripe_transfer_id, status')
            .eq('user_id', userId)
            .eq('type', 'withdrawal')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

          const w = winner as WalletTransaction | null;
          return jsonResponse({
            transferId: w?.stripe_transfer_id ?? transfer.id,
            status: w?.status ?? 'pending',
            amount,
            currency,
            accountId: p.stripe_connect_account_id,
            transactionId: w?.id,
            duplicate: true,
            estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
            message: 'This withdrawal was already submitted and is being processed.',
          });
        }

        // The transfer already succeeded and the balance is correctly
        // deducted — only the history row failed. Do NOT surface an error
        // (the user's money IS on the way); log loudly for reconciliation.
        logCritical('transfer succeeded but transaction record failed — manual reconciliation required', {
          userId, transferId: transfer.id, amount, error: txError,
        });
        return jsonResponse({
          transferId: transfer.id,
          status: 'completed',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          newBalance,
          estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
          message: 'Transfer initiated. Funds typically arrive in 1-2 business days.',
          warning: 'Transaction history may take a moment to update.',
        });
      }

      console.log('[connect/transfer] withdrawal completed', {
        userId,
        transferId: transfer.id,
        transactionId: (transaction as WalletTransaction).id,
      });

      return jsonResponse({
        transferId: transfer.id,
        status: 'completed',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
        newBalance,
        estimatedArrival: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        message: 'Transfer initiated. Funds typically arrive in 1-2 business days.',
      });
    }

    // POST /connect/retry-transfer
    if (subPath === '/retry-transfer') {
      if (CONNECT_TRANSFER_RETIRED) return legacyTransferRetiredResponse();
      const body = await req.json();
      const { transactionId } = body;
      // Optional: let the hunter pick a different destination on retry (e.g.
      // the original attempt failed because that bank account was invalid).
      // Falls back to the original transaction's recorded destination, then
      // to whatever Stripe currently has as default for rows created before
      // this fix existed — see resolveWithdrawalDestination() above.
      const requestedBankAccountId =
        typeof body.bankAccountId === 'string' && body.bankAccountId.trim()
          ? body.bankAccountId.trim()
          : undefined;

      if (!transactionId) {
        return jsonResponse({ error: 'Transaction ID is required' }, 400);
      }

      const { data: tx, error: txError } = await supabase
        .from('wallet_transactions')
        .select('*')
        .eq('id', transactionId)
        .eq('user_id', userId)
        .eq('status', 'failed')
        .single();

      if (txError || !tx) {
        return jsonResponse({ error: 'Failed transaction not found' }, 404);
      }

      const t = tx as WalletTransaction;
      const retryCount =
        ((t.metadata as Record<string, unknown> | null)?.retry_count as number) ?? 0;
      if (retryCount >= 3) {
        return jsonResponse(
          {
            error: 'Maximum retry attempts reached. Please contact support.',
            maxRetriesReached: true,
          },
          400
        );
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, balance, balance_on_hold')
        .eq('id', userId)
        .single();

      const p = profile as Profile | null;
      if (!p?.stripe_connect_account_id) {
        return jsonResponse({ error: 'Stripe Connect account not found' }, 400);
      }

      const amount = Math.abs(t.amount);

      // Resolve/promote the destination bank account before touching the
      // balance — same logic and rationale as the primary /transfer path.
      const originalDestinationId =
        (t.metadata as Record<string, unknown> | null)?.destination_bank_account_id;
      const effectiveRequestedBankAccountId =
        requestedBankAccountId ??
        (typeof originalDestinationId === 'string' ? originalDestinationId : undefined);

      let destinationAccount: ExternalAccountSummary;
      try {
        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'bank_account', limit: 100 }
        );
        const summaries: ExternalAccountSummary[] = externalAccounts.data.map(ba => ({
          id: ba.id,
          default_for_currency: (ba as unknown as { default_for_currency?: boolean }).default_for_currency,
          bank_name: (ba as unknown as { bank_name?: string }).bank_name ?? null,
          last4: (ba as unknown as { last4?: string }).last4 ?? null,
        }));

        const destination = resolveWithdrawalDestination(summaries, effectiveRequestedBankAccountId);
        if (!destination.ok) {
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }
        destinationAccount = destination.targetAccount;

        // Same fail-closed reasoning as /transfer above: updateExternalAccount
        // always fails for these accounts, so don't attempt it.
        if (destination.needsDefaultUpdate) {
          console.warn('[connect/retry-transfer] selected bank account is not the default payout account', {
            userId,
            accountId: p.stripe_connect_account_id,
            bankAccountId: destinationAccount.id,
          });
          return jsonResponse(
            {
              error:
                'This bank account is not your default payout method. Open your payout dashboard to set it as default, then try again.',
              code: 'bank_account_not_default',
            },
            400
          );
        }
      } catch (bankAccountError) {
        console.error('[connect] failed to resolve/set destination bank account during retry', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (bankAccountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not confirm your payout destination. Your balance has not been charged — please try again.',
            code: 'bank_account_resolution_failed',
          },
          503
        );
      }

      // Enforce hold: available = balance - balance_on_hold.
      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        return jsonResponse({ error: 'Insufficient balance for retry' }, 400);
      }

      const { error: rpcError } = await supabase.rpc('withdraw_balance', {
        p_user_id: userId,
        p_amount: amount,
      });

      if (rpcError) {
        console.error('[connect] withdraw_balance RPC failed during transfer retry:', rpcError);
        return jsonResponse({ error: 'Failed to reserve balance for retry' }, 500);
      }

      let transfer: Stripe.Transfer;
      try {
        transfer = await stripe.transfers.create(
          {
            amount: Math.round(amount * 100),
            currency: 'usd',
            destination: p.stripe_connect_account_id,
            metadata: { user_id: userId, retry_of_transaction: transactionId },
          },
          // Stripe-side idempotency: a repeated retry of the same attempt
          // number for the same transaction cannot create a second transfer.
          { idempotencyKey: `retry_${transactionId}_${retryCount + 1}` }
        );
      } catch (stripeError) {
        console.error('[connect] Transfer creation failed, refunding balance:', stripeError);
        const { error: retryRefundError } = await supabase.rpc('update_balance', {
          p_user_id: userId,
          p_amount: amount,
        });
        if (retryRefundError) {
          logCritical('balance refund after failed retry transfer also failed — manual reconciliation required', {
            userId, amount, error: retryRefundError,
          });
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
            },
            500
          );
        }
        const mapped = mapStripeTransferError(
          stripeError as { code?: string; type?: string; message?: string }
        );
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      // Same reasoning as the primary /transfer path: the retry's transfer
      // creation above already succeeded synchronously, so this is 'completed'
      // immediately rather than waiting on a `transfer.paid` webhook that
      // Stripe never sends for connected-account balance transfers.
      await supabase
        .from('wallet_transactions')
        .update({
          stripe_transfer_id: transfer.id,
          status: 'completed',
          metadata: {
            ...t.metadata,
            retry_count: retryCount + 1,
            retried_at: new Date().toISOString(),
            destination_bank_account_id: destinationAccount.id,
            destination_bank_last4: destinationAccount.last4 ?? null,
            destination_bank_name: destinationAccount.bank_name ?? null,
          },
        })
        .eq('id', transactionId);

      console.log(
        `[connect] Transfer retry successful: ${transfer.id} for transaction ${transactionId}`
      );

      return jsonResponse({
        success: true,
        transferId: transfer.id,
        transactionId,
        message: 'Transfer retry initiated successfully.',
      });
    }

    // POST /connect/instant-payout — Instant Cash Out to a linked debit card.
    // Deliberately a fresh, independent implementation rather than a refactor
    // of /transfer's internals (which are already audited/tested and out of
    // scope to touch here) — it duplicates the platform-Transfer step but
    // never shares code paths with /transfer, so nothing about that route's
    // existing behavior changes.
    if (subPath === '/instant-payout') {
      if (!INSTANT_CASHOUT_ENABLED) {
        return jsonResponse(
          {
            error: 'Instant Cash Out is not currently available. Please use a standard bank withdrawal.',
            code: 'instant_cashout_disabled',
          },
          503
        );
      }

      const body = await req.json();

      const validation = validateWithdrawalRequest(body);
      if (!validation.ok) {
        console.warn('[connect/instant-payout] validation failed', { userId, code: validation.code });
        return jsonResponse({ error: validation.error, code: validation.code }, 400);
      }
      const amount = validation.amount;
      const currency = 'usd';

      // Instant-specific ceiling — tighter than the shared MAX_WITHDRAWAL_USD.
      const instantAmountCheck = validateInstantAmount(amount);
      if (!instantAmountCheck.ok) {
        console.warn('[connect/instant-payout] amount above instant maximum', { userId, amount });
        return jsonResponse({ error: instantAmountCheck.error, code: instantAmountCheck.code }, 400);
      }

      const idempotencyKey =
        typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
          ? body.idempotencyKey.trim().slice(0, 200)
          : undefined;

      const requestedCardId =
        typeof body.debitCardId === 'string' && body.debitCardId.trim()
          ? body.debitCardId.trim()
          : undefined;

      console.log('[connect/instant-payout] instant cash out requested', {
        userId,
        amount,
        hasIdempotencyKey: !!idempotencyKey,
        hasDebitCardId: !!requestedCardId,
      });

      // Idempotency replay — same DB-level pattern as /transfer, sharing the
      // (user_id, idempotency_key) unique index on wallet_transactions. A
      // client generates a fresh key per attempt (never reused across
      // /transfer and /instant-payout), so this is safe to share.
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from('wallet_transactions')
          .select('id, stripe_transfer_id, stripe_payout_id, stripe_connect_account_id, amount, status, payout_method')
          .eq('user_id', userId)
          .eq('type', 'withdrawal')
          .eq('idempotency_key', idempotencyKey)
          .maybeSingle();

        if (existing) {
          const e = existing as WalletTransaction & {
            stripe_connect_account_id?: string;
            stripe_payout_id?: string | null;
            payout_method?: string;
          };
          console.log('[connect/instant-payout] idempotent replay', { userId, transactionId: e.id });
          const { data: replayProfile } = await supabase
            .from('profiles')
            .select('balance')
            .eq('id', userId)
            .single();
          const replayBalance =
            typeof (replayProfile as { balance?: number } | null)?.balance === 'number'
              ? (replayProfile as { balance: number }).balance
              : null;
          return jsonResponse({
            transferId: e.stripe_transfer_id,
            payoutId: e.stripe_payout_id ?? null,
            payoutMethod: e.payout_method ?? 'standard',
            status: e.status ?? 'completed',
            amount: Math.abs(e.amount),
            currency,
            accountId: e.stripe_connect_account_id,
            transactionId: e.id,
            newBalance: replayBalance,
            duplicate: true,
            message: 'This Instant Cash Out was already submitted and is being processed.',
          });
        }
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('balance, balance_on_hold, stripe_connect_account_id, stripe_connect_onboarded_at, account_status')
        .eq('id', userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404);
      }

      const p = profile as Profile;

      const accountEligibility = validateAccountEligibility(p.account_status);
      if (!accountEligibility.ok) {
        console.warn('[connect/instant-payout] blocked for account_status', { userId, accountStatus: p.account_status });
        return jsonResponse({ error: accountEligibility.error, code: accountEligibility.code }, 403);
      }

      if (!p.stripe_connect_account_id || !p.stripe_connect_onboarded_at) {
        return jsonResponse(
          {
            error:
              'Your payout account is not set up yet. Please complete Stripe Connect onboarding before withdrawing.',
            code: 'connect_not_onboarded',
          },
          400
        );
      }

      // Stripe caps instant payouts at 10/day per connected account — count
      // this hunter's completed instant withdrawals in the last rolling 24h
      // before touching the balance, same fail-closed discipline as the rest
      // of this route.
      const { count: instantPayoutsToday, error: instantCountError } = await supabase
        .from('wallet_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('type', 'withdrawal')
        .eq('payout_method', 'instant')
        .eq('status', 'completed')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if (instantCountError) {
        console.error('[connect/instant-payout] failed to count today\'s instant payouts', {
          userId,
          error: instantCountError,
        });
        return jsonResponse(
          { error: 'We could not verify your Instant Cash Out eligibility. Please try again.', code: 'account_verification_failed' },
          503
        );
      }
      const dailyLimitCheck = checkInstantDailyLimit(instantPayoutsToday ?? 0);
      if (!dailyLimitCheck.ok) {
        console.warn('[connect/instant-payout] daily instant limit reached', { userId, count: instantPayoutsToday });
        return jsonResponse({ error: dailyLimitCheck.error, code: dailyLimitCheck.code }, 429);
      }

      // Live payout eligibility + instant-eligible card resolution + instant
      // balance check, before touching the balance — same fail-closed
      // discipline as /transfer.
      let destinationCard: InstantCardSummary;
      try {
        const account = await stripe.accounts.retrieve(p.stripe_connect_account_id);
        if (!account.payouts_enabled) {
          console.warn('[connect/instant-payout] payouts disabled on connected account', {
            userId,
            accountId: p.stripe_connect_account_id,
          });
          return jsonResponse(
            {
              error:
                'Payouts are currently disabled on your account. Please review and update your payout details, then try again.',
              code: 'payouts_disabled',
            },
            400
          );
        }

        const externalAccounts = await stripe.accounts.listExternalAccounts(
          p.stripe_connect_account_id,
          { object: 'card', limit: 100 }
        );
        const cards: InstantCardSummary[] = externalAccounts.data.map(c => ({
          id: c.id,
          brand: (c as unknown as { brand?: string }).brand ?? null,
          last4: (c as unknown as { last4?: string }).last4 ?? null,
          available_payout_methods:
            (c as unknown as { available_payout_methods?: string[] }).available_payout_methods ?? null,
        }));

        const destination = resolveInstantDestination(cards, requestedCardId);
        if (!destination.ok) {
          console.warn('[connect/instant-payout] destination resolution failed', {
            userId,
            code: destination.code,
          });
          return jsonResponse({ error: destination.error, code: destination.code }, 400);
        }
        destinationCard = destination.targetCard;

        // Use instant_available (not the plain `available` balance) — only
        // funds Stripe reports here are actually eligible to pay out via
        // `method: "instant"` right now. Using `available` instead is the
        // exact wrong-field mistake called out in the integration spec this
        // logic implements.
        const balance = await stripe.balance.retrieve({ stripeAccount: p.stripe_connect_account_id });
        const instantAvailableCents =
          balance.instant_available?.find(b => b.currency === 'usd')?.net_available?.[0]?.amount ?? 0;
        const instantBalanceCheck = checkInstantBalance(validation.amountCents, instantAvailableCents);
        if (!instantBalanceCheck.ok) {
          console.warn('[connect/instant-payout] insufficient instant-available balance', {
            userId,
            amountCents: validation.amountCents,
            instantAvailableCents,
          });
          return jsonResponse({ error: instantBalanceCheck.error, code: instantBalanceCheck.code }, 400);
        }
      } catch (accountError) {
        console.error('[connect/instant-payout] failed to verify connected account or cards', {
          userId,
          accountId: p.stripe_connect_account_id,
          error: (accountError as { message?: string })?.message,
        });
        return jsonResponse(
          {
            error:
              'We could not verify your Instant Cash Out eligibility. Your balance has not been charged — please try again.',
            code: 'account_verification_failed',
          },
          503
        );
      }

      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        console.warn('[connect/instant-payout] insufficient available balance', { userId, amount });
        return jsonResponse(
          {
            error:
              'Insufficient available balance. Part of your balance may be on hold or already reserved.',
            code: 'insufficient_balance',
          },
          400
        );
      }

      const { data: newBalanceData, error: balanceError } = await supabase.rpc('withdraw_balance', {
        p_user_id: userId,
        p_amount: amount,
      });

      if (balanceError) {
        console.error('[connect/instant-payout] Error deducting balance before transfer:', {
          userId,
          amount,
          error: balanceError.message,
        });
        const mapped = mapWithdrawBalanceError(balanceError.message);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      const newBalance = typeof newBalanceData === 'number' ? newBalanceData : null;

      // Step 1: move funds from the platform balance into the connected
      // account's Stripe balance — required before Stripe will let the
      // connected account pay any of it out, instant or otherwise.
      let transfer: Stripe.Transfer;
      try {
        console.log('[connect/instant-payout] creating platform transfer', {
          userId,
          amountCents: validation.amountCents,
          accountId: p.stripe_connect_account_id,
        });
        transfer = await stripe.transfers.create(
          {
            amount: validation.amountCents,
            currency,
            destination: p.stripe_connect_account_id,
            metadata: {
              user_id: userId,
              purpose: 'instant_cash_out',
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          idempotencyKey
            ? { idempotencyKey: `instant_transfer_${userId}_${idempotencyKey}_${validation.amountCents}` }
            : undefined
        );
      } catch (stripeError) {
        const errInfo = stripeError as { code?: string; type?: string; message?: string };
        console.error('[connect/instant-payout] Transfer creation failed, refunding balance:', {
          userId,
          amount,
          stripeCode: errInfo?.code,
          message: errInfo?.message,
        });
        const { error: refundError } = await supabase.rpc('update_balance', {
          p_user_id: userId,
          p_amount: amount,
        });
        if (refundError) {
          logCritical('balance refund after failed instant-payout transfer also failed — manual reconciliation required', {
            userId, amount, error: refundError,
          });
          return jsonResponse(
            {
              error:
                'Transfer failed and your balance may have been affected. Please contact support for assistance.',
              code: 'transfer_failed_refund_failed',
            },
            500
          );
        }
        const mapped = mapStripeTransferError(errInfo);
        return jsonResponse({ error: mapped.error, code: mapped.code }, mapped.status);
      }

      console.log('[connect/instant-payout] platform transfer created', {
        userId,
        transferId: transfer.id,
      });

      // Step 2: request the actual instant payout FROM the connected
      // account's now-funded balance TO the debit card. Scoped via
      // { stripeAccount } — this Stripe call acts "as" the connected
      // account, unlike every other Stripe call in this file.
      const estimatedFeeCents = estimateInstantFeeCents(validation.amountCents);
      let payout: Stripe.Payout;
      try {
        payout = await stripe.payouts.create(
          {
            amount: validation.amountCents,
            currency,
            method: 'instant',
            destination: destinationCard.id,
            metadata: {
              user_id: userId,
              transfer_id: transfer.id,
              ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
            },
          },
          {
            stripeAccount: p.stripe_connect_account_id,
            idempotencyKey: idempotencyKey
              ? `instant_payout_${userId}_${idempotencyKey}_${validation.amountCents}`
              : undefined,
          }
        );
      } catch (payoutError) {
        // The platform Transfer above already succeeded — the money is
        // already sitting in the connected account's Stripe balance and will
        // still go out via Stripe's normal automatic payout schedule
        // regardless of this failure. This is NOT a failed withdrawal and
        // must never trigger a balance refund (that would let the hunter
        // double-collect once the automatic sweep pays out anyway). Record
        // it as a completed STANDARD withdrawal that simply couldn't be
        // expedited, and tell the hunter plainly.
        const errInfo = payoutError as { code?: string; type?: string; message?: string };
        console.warn('[connect/instant-payout] instant payout call failed, falling back to standard sweep', {
          userId,
          transferId: transfer.id,
          stripeCode: errInfo?.code,
          message: errInfo?.message,
        });

        const { data: fallbackTx } = await supabase
          .from('wallet_transactions')
          .insert({
            user_id: userId,
            type: 'withdrawal',
            amount: -amount,
            description: 'Withdrawal to bank account (Instant Cash Out unavailable)',
            status: 'completed',
            payout_method: 'standard',
            stripe_transfer_id: transfer.id,
            stripe_connect_account_id: p.stripe_connect_account_id,
            idempotency_key: idempotencyKey ?? null,
            metadata: {
              transfer_id: transfer.id,
              idempotency_key: idempotencyKey ?? null,
              instant_payout_attempted_but_fell_back: true,
              instant_payout_error: errInfo?.code ?? errInfo?.message ?? 'unknown',
            },
          })
          .select()
          .single();

        return jsonResponse({
          transferId: transfer.id,
          payoutMethod: 'standard',
          status: 'completed',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          transactionId: (fallbackTx as WalletTransaction | null)?.id,
          newBalance,
          fellBackToStandard: true,
          message:
            "Instant Cash Out couldn't be completed for this card, but your withdrawal is still on its way via standard transfer (typically 1-2 business days). Your balance has been deducted only once.",
        });
      }

      console.log('[connect/instant-payout] instant payout created', {
        userId,
        payoutId: payout.id,
      });

      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'withdrawal',
          amount: -amount,
          description: 'Instant Cash Out to debit card',
          status: 'completed',
          payout_method: 'instant',
          stripe_transfer_id: transfer.id,
          stripe_payout_id: payout.id,
          stripe_connect_account_id: p.stripe_connect_account_id,
          idempotency_key: idempotencyKey ?? null,
          instant_fee_amount: estimatedFeeCents / 100,
          metadata: {
            transfer_id: transfer.id,
            payout_id: payout.id,
            idempotency_key: idempotencyKey ?? null,
            destination_card_id: destinationCard.id,
            destination_card_last4: destinationCard.last4 ?? null,
            destination_card_brand: destinationCard.brand ?? null,
            estimated_fee_cents: estimatedFeeCents,
          },
        })
        .select()
        .single();

      if (txError) {
        // Same concurrent-duplicate-insert race handling as /transfer.
        if ((txError as { code?: string }).code === '23505' && idempotencyKey) {
          console.warn('[connect/instant-payout] concurrent duplicate detected, refunding extra deduction', {
            userId,
            transferId: transfer.id,
            payoutId: payout.id,
          });
          const { error: dupRefundError } = await supabase.rpc('update_balance', {
            p_user_id: userId,
            p_amount: amount,
          });
          if (dupRefundError) {
            logCritical('refund of duplicate instant-payout deduction failed — manual reconciliation required', {
              userId, amount, error: dupRefundError,
            });
          }

          const { data: winner } = await supabase
            .from('wallet_transactions')
            .select('id, stripe_transfer_id, stripe_payout_id, status, payout_method')
            .eq('user_id', userId)
            .eq('type', 'withdrawal')
            .eq('idempotency_key', idempotencyKey)
            .maybeSingle();

          const w = winner as
            | (WalletTransaction & { stripe_payout_id?: string; payout_method?: string })
            | null;
          return jsonResponse({
            transferId: w?.stripe_transfer_id ?? transfer.id,
            payoutId: w?.stripe_payout_id ?? payout.id,
            payoutMethod: w?.payout_method ?? 'instant',
            status: w?.status ?? 'completed',
            amount,
            currency,
            accountId: p.stripe_connect_account_id,
            transactionId: w?.id,
            duplicate: true,
            message: 'This Instant Cash Out was already submitted and is being processed.',
          });
        }

        logCritical('instant payout succeeded but transaction record failed — manual reconciliation required', {
          userId, transferId: transfer.id, payoutId: payout.id, amount, error: txError,
        });
        return jsonResponse({
          transferId: transfer.id,
          payoutId: payout.id,
          payoutMethod: 'instant',
          status: 'completed',
          amount,
          currency,
          accountId: p.stripe_connect_account_id,
          newBalance,
          message: 'Instant Cash Out initiated.',
          warning: 'Transaction history may take a moment to update.',
        });
      }

      console.log('[connect/instant-payout] instant cash out completed', {
        userId,
        transferId: transfer.id,
        payoutId: payout.id,
        transactionId: (transaction as WalletTransaction).id,
      });

      return jsonResponse({
        transferId: transfer.id,
        payoutId: payout.id,
        payoutMethod: 'instant',
        status: 'completed',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
        newBalance,
        estimatedFee: estimatedFeeCents / 100,
        message: 'Instant Cash Out complete. Funds typically arrive within minutes.',
      });
    }

    // GET /connect/bank-accounts — list external bank accounts on the Connect
    // account, plus the server-computed withdrawal limits/available balance
    // the withdraw screen renders. BUGFIX: this response previously returned
    // only `{ bankAccounts }`, but withdraw-with-bank-screen.tsx has always
    // read `minWithdrawal`/`maxWithdrawal`/`availableBalance` from it too —
    // those fields were silently always undefined, so the screen fell back
    // to a client-side default minimum, no maximum, and the wallet context's
    // cached balance instead of the real balance-minus-hold figure. Fixed by
    // actually returning the values this file already computes elsewhere.
    if (req.method === 'GET' && subPath === '/bank-accounts') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id, balance, balance_on_hold')
        .eq('id', userId)
        .single();

      const p = profile as Profile | null;
      const accountId = p?.stripe_connect_account_id;
      const availableBalance = (p?.balance ?? 0) - (p?.balance_on_hold ?? 0);

      if (!accountId) {
        return jsonResponse({
          bankAccounts: [],
          minWithdrawal: MIN_WITHDRAWAL_USD,
          maxWithdrawal: MAX_WITHDRAWAL_USD,
          availableBalance,
        });
      }

      const accounts = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'bank_account',
        limit: 20,
      });
      const bankAccounts = accounts.data.map(ba => ({
        id: ba.id,
        bankName: (ba as unknown as { bank_name?: string }).bank_name ?? null,
        last4: ba.last4,
        routingNumber: (ba as unknown as { routing_number?: string }).routing_number ?? null,
        accountHolderName:
          (ba as unknown as { account_holder_name?: string }).account_holder_name ?? null,
        accountType: (ba as unknown as { account_type?: string }).account_type ?? null,
        default: ba.default_for_currency,
        status: ba.status,
      }));
      return jsonResponse({
        bankAccounts,
        minWithdrawal: MIN_WITHDRAWAL_USD,
        maxWithdrawal: MAX_WITHDRAWAL_USD,
        availableBalance,
      });
    }

    // GET /connect/debit-cards — list debit-card external accounts (Instant
    // Cash Out destinations only; never used for the standard automatic
    // payout sweep, see the default_for_currency note on POST below). Also
    // returns instantAvailableCents (from balance.instant_available, NOT the
    // plain `available` balance — see checkInstantBalance() above for why)
    // so the client can gray out the Instant option *before* the hunter ever
    // attempts a payout, rather than only discovering insufficient instant
    // funds after tapping Confirm.
    if (req.method === 'GET' && subPath === '/debit-cards') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        return jsonResponse({ debitCards: [], instantAvailableCents: 0 });
      }

      const cards = await stripe.accounts.listExternalAccounts(accountId, {
        object: 'card',
        limit: 20,
      });
      const debitCards = cards.data.map(c => {
        const methods = (c as unknown as { available_payout_methods?: string[] })
          .available_payout_methods ?? [];
        return {
          id: c.id,
          brand: (c as unknown as { brand?: string }).brand ?? null,
          last4: (c as unknown as { last4?: string }).last4 ?? null,
          expMonth: (c as unknown as { exp_month?: number }).exp_month ?? null,
          expYear: (c as unknown as { exp_year?: number }).exp_year ?? null,
          availablePayoutMethods: methods,
          instantEligible: methods.includes('instant'),
        };
      });

      let instantAvailableCents = 0;
      try {
        const balance = await stripe.balance.retrieve({ stripeAccount: accountId });
        instantAvailableCents =
          balance.instant_available?.find(b => b.currency === 'usd')?.net_available?.[0]?.amount ?? 0;
      } catch (balanceError) {
        console.warn('[connect/debit-cards] failed to fetch instant_available balance', {
          userId,
          accountId,
          error: (balanceError as { message?: string })?.message,
        });
        // Non-fatal: the list of cards is still useful without this figure;
        // the client just can't pre-gate on instant balance this refresh.
      }

      return jsonResponse({ debitCards, instantAvailableCents });
    }

    // POST /connect/debit-cards — DEPRECATED.
    // Adding a debit card via a client-tokenized card token
    // (stripe.accounts.createExternalAccount) can never succeed: these
    // Connect accounts have controller.requirement_collection === "stripe",
    // so Stripe rejects the call with a permissions error unconditionally —
    // this is not a "payouts disabled" condition that can be worked around.
    // Debit cards must be added through Stripe's own hosted Express
    // Dashboard instead. Returns 410 Gone so clients can detect the
    // deprecation and migrate, matching the POST /bank-accounts pattern.
    if (req.method === 'POST' && subPath === '/debit-cards') {
      return jsonResponse(
        {
          error:
            'Adding a debit card here is no longer supported. Please add it securely through your Stripe payout dashboard.',
          code: 'debit_card_add_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410,
      );
    }

    // DELETE /connect/debit-cards/:debitCardId — DEPRECATED, same reason as
    // POST /debit-cards above (stripe.accounts.deleteExternalAccount is
    // rejected unconditionally for these accounts).
    if (req.method === 'DELETE' && subPath.startsWith('/debit-cards/')) {
      return jsonResponse(
        {
          error:
            'Removing a debit card here is no longer supported. Please remove it through your Stripe payout dashboard.',
          code: 'debit_card_remove_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410,
      );
    }

    // POST /connect/bank-accounts — DEPRECATED.
    // Manual bank-account entry (raw routing/account numbers) is no longer
    // supported. Clients must use Stripe Financial Connections instead via:
    //   POST /payments/create-financial-connections-session
    //   POST /payments/financial-connections-complete
    // Returns 410 Gone so older clients can detect the deprecation and migrate.
    if (req.method === 'POST' && subPath === '/bank-accounts') {
      return jsonResponse(
        {
          error:
            'Manual bank account entry is no longer supported. Please link your bank securely using Stripe Financial Connections.',
          code: 'manual_bank_entry_deprecated',
          migrate_to: '/functions/v1/payments/create-financial-connections-session',
        },
        410,
      );
    }

    // DELETE /connect/bank-accounts/:bankAccountId — DEPRECATED.
    // stripe.accounts.deleteExternalAccount is rejected unconditionally for
    // these Connect accounts (controller.requirement_collection === "stripe").
    // Remove bank accounts through the Stripe payout dashboard instead.
    if (req.method === 'DELETE' && subPath.startsWith('/bank-accounts/')) {
      return jsonResponse(
        {
          error:
            'Removing a bank account here is no longer supported. Please remove it through your Stripe payout dashboard.',
          code: 'bank_account_remove_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410,
      );
    }

    // POST /connect/bank-accounts/:bankAccountId/default — DEPRECATED.
    // stripe.accounts.updateExternalAccount is rejected unconditionally for
    // these Connect accounts. Set the default payout account through the
    // Stripe payout dashboard instead.
    if (
      req.method === 'POST' &&
      subPath.startsWith('/bank-accounts/') &&
      subPath.endsWith('/default')
    ) {
      return jsonResponse(
        {
          error:
            'Setting a default bank account here is no longer supported. Please set it through your Stripe payout dashboard.',
          code: 'bank_account_default_deprecated',
          migrate_to: '/functions/v1/connect/login-link',
        },
        410,
      );
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[connect edge fn] Error:', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});

/**
 * Returns the HTML document that is loaded inside a React Native WebView to
 * host Stripe Connect Embedded Components (onboarding / payments / payouts).
 *
 * Protocol (postMessage between WebView and RN):
 *   WebView -> RN:  { type: 'ready' }                     // page has loaded Connect.js
 *                   { type: 'exit' }                      // onExit from onboarding
 *                   { type: 'load_error', error: string } // Connect.js load failed
 *                   { type: 'log', level, message }       // console passthrough
 *                   { type: 'mounted' }                   // component mounted OK
 *   RN -> WebView:  { type: 'init', publishableKey, clientSecret,
 *                     component: 'onboarding' | 'payments' | 'payouts',
 *                     appearance?: object, locale?: string }
 *
 * The page never sees the Stripe secret key. The client_secret is short-lived
 * (≈ minutes) and scoped to a single connected account + component set.
 */
function renderEmbeddedPage(): string {
  // Branded dark emerald theme matching lib/theme.ts
  const defaultAppearance = {
    overlays: 'dialog',
    variables: {
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      colorPrimary: '#00912C',
      colorBackground: '#1a3d2e',
      colorText: '#fffef5',
      colorSecondaryText: 'rgba(255, 254, 245, 0.75)',
      colorBorder: 'rgba(0, 145, 44, 0.4)',
      colorDanger: '#ef4444',
      buttonPrimaryColorBackground: '#00912C',
      buttonPrimaryColorBorder: '#00912C',
      buttonPrimaryColorText: '#ffffff',
      buttonSecondaryColorBackground: '#2d5240',
      buttonSecondaryColorText: '#fffef5',
      buttonSecondaryColorBorder: 'rgba(0, 145, 44, 0.4)',
      formHighlightColorBorder: '#00912C',
      formAccentColor: '#00912C',
      actionPrimaryColorText: '#00912C',
      actionSecondaryColorText: 'rgba(255, 254, 245, 0.8)',
      badgeNeutralColorBackground: 'rgba(45, 82, 64, 0.85)',
      badgeNeutralColorText: '#fffef5',
      offsetBackgroundColor: '#2d5240',
      formBackgroundColor: 'rgba(45, 82, 64, 0.75)',
      borderRadius: '12px',
      buttonBorderRadius: '10px',
      formBorderRadius: '10px',
      badgeBorderRadius: '8px',
      overlayBorderRadius: '16px',
      spacingUnit: '9px',
      fontSizeBase: '15px',
    },
  };
  const appearanceJson = JSON.stringify(defaultAppearance);

  // NOTE: Escape `</` inside the string literal below if you add any.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover" />
<title>Bounty • Stripe Connect</title>
<style>
  html, body { margin: 0; padding: 0; background: #1a3d2e; color: #fffef5;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    min-height: 100vh; -webkit-font-smoothing: antialiased; }
  #root { padding: 16px 12px 48px; max-width: 720px; margin: 0 auto; }
  .state { display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 60vh; gap: 16px; text-align: center; padding: 24px; }
  .spinner { width: 36px; height: 36px; border-radius: 50%;
    border: 3px solid rgba(0,145,44,0.25); border-top-color: #00912C;
    animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .muted { color: rgba(255,254,245,0.7); font-size: 14px; line-height: 1.5; }
  .err { color: #fecaca; background: rgba(239,68,68,0.1);
    border: 1px solid rgba(239,68,68,0.4); border-radius: 12px; padding: 16px;
    font-size: 14px; line-height: 1.5; max-width: 420px; }
  .retry { margin-top: 8px; background: #00912C; color: #fff; border: 0;
    border-radius: 10px; padding: 12px 20px; font-size: 15px; font-weight: 600;
    cursor: pointer; }
</style>
</head>
<body>
<div id="root">
  <div id="loading" class="state">
    <div class="spinner" aria-hidden="true"></div>
    <div class="muted">Loading secure Stripe session…</div>
  </div>
  <div id="container" style="display:none"></div>
  <div id="error" class="state" style="display:none">
    <div class="err" id="error-message">Something went wrong.</div>
    <button class="retry" id="retry-btn" type="button">Try again</button>
  </div>
</div>
<script>
  (function () {
    var DEFAULT_APPEARANCE = ${appearanceJson};
    var rn = (window.ReactNativeWebView && window.ReactNativeWebView.postMessage)
      ? function (obj) { try { window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (_) {} }
      : function () {};

    function show(id) {
      ['loading', 'container', 'error'].forEach(function (k) {
        var el = document.getElementById(k);
        if (el) el.style.display = (k === id) ? (k === 'container' ? 'block' : 'flex') : 'none';
      });
    }
    function showError(msg) {
      var el = document.getElementById('error-message');
      if (el) el.textContent = msg || 'Something went wrong.';
      show('error');
      rn({ type: 'load_error', error: msg });
    }

    ['log', 'warn', 'error'].forEach(function (level) {
      var orig = console[level];
      console[level] = function () {
        try {
          rn({ type: 'log', level: level, message: Array.prototype.slice.call(arguments).map(String).join(' ') });
        } catch (_) {}
        if (orig) orig.apply(console, arguments);
      };
    });

    window.addEventListener('error', function (ev) {
      rn({ type: 'log', level: 'error', message: 'window.error: ' + (ev && ev.message) });
    });

    document.getElementById('retry-btn').addEventListener('click', function () {
      rn({ type: 'retry' });
    });

    var initialized = false;
    function handleInit(payload) {
      if (initialized) return;
      if (!payload || !payload.publishableKey || !payload.clientSecret) {
        showError('Missing Stripe credentials.');
        return;
      }
      initialized = true;
      var component = payload.component || 'onboarding';
      var appearance = payload.appearance || DEFAULT_APPEARANCE;
      var locale = payload.locale || 'en-US';

      var loader =
        (window.StripeConnect && (window.StripeConnect.init || window.StripeConnect.loadConnectAndInitialize)) ||
        window.loadConnectAndInitialize;
      if (typeof loader !== 'function') {
        showError('Stripe Connect SDK failed to load.');
        return;
      }

      try {
        var instance = loader({
          publishableKey: payload.publishableKey,
          fetchClientSecret: function () { return Promise.resolve(payload.clientSecret); },
          appearance: { overlays: appearance.overlays || 'dialog', variables: appearance.variables || {} },
          locale: locale,
        });

        var container = document.getElementById('container');
        container.innerHTML = '';
        var el;
        if (component === 'payments') {
          el = instance.create('payments');
        } else if (component === 'payouts') {
          el = instance.create('payouts');
        } else {
          el = instance.create('account-onboarding');
          el.setOnExit(function () { rn({ type: 'exit' }); });
          el.setOnLoadError(function (e) {
            rn({ type: 'load_error', error: (e && e.error && e.error.message) || 'onboarding load error' });
          });
        }
        container.appendChild(el);
        show('container');
        rn({ type: 'mounted', component: component });
      } catch (e) {
        showError((e && e.message) || 'Failed to initialize Stripe Connect.');
      }
    }

    function onMessage(ev) {
      var data = ev && ev.data;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { return; }
      }
      if (!data || typeof data !== 'object') return;
      if (data.type === 'init') handleInit(data);
    }
    // WebView delivers messages on both window and document depending on platform.
    window.addEventListener('message', onMessage);
    document.addEventListener('message', onMessage);

    function loadScript() {
      var s = document.createElement('script');
      s.src = 'https://connect-js.stripe.com/v1.0/connect.js';
      s.async = true;
      s.onload = function () { rn({ type: 'ready' }); };
      s.onerror = function () { showError('Could not reach Stripe. Check your connection.'); };
      document.head.appendChild(s);
    }
    loadScript();
  })();
</script>
</body>
</html>`;
}
