// Supabase Edge Function: connect
// Handles all /connect/* routes previously served by the Node/Express server.
// Routes:
//   POST /connect/create-account-link
//   POST /connect/create-account-session   (Stripe Connect Embedded Components)
//   GET  /connect/embedded                 (HTML shim that mounts embedded components in a WebView)
//   POST /connect/verify-onboarding
//   POST /connect/transfer
//   POST /connect/retry-transfer
//   GET  /connect/bank-accounts            (list external bank accounts on Connect account)
//   POST /connect/bank-accounts            (add a bank account to Connect account)
//   DELETE /connect/bank-accounts/:id      (remove a bank account)
//   POST /connect/bank-accounts/:id/default (set a bank account as default for currency)

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

// ─── Inlined from ./withdrawal-validation.ts ────────────────────────────────
// (local imports are not supported by the Supabase bundler — keep both copies
// in sync; the sibling module is the unit-tested source of truth)

/** Minimum withdrawal in USD — keep in sync with lib/constants.ts MIN_WITHDRAWAL_AMOUNT. */
const MIN_WITHDRAWAL_USD = 10;

/** Maximum single withdrawal in USD (fraud/typo guard). */
const MAX_WITHDRAWAL_USD = 10000;

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
// ─── End inlined withdrawal-validation helpers ──────────────────────────────

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
  if (
    req.method !== 'POST' &&
    !(req.method === 'GET' && isBankAccountsPath) &&
    !(req.method === 'DELETE' && isBankAccountsPath)
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
      });
    }

    // POST /connect/transfer
    if (subPath === '/transfer') {
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

      console.log('[connect/transfer] withdrawal requested', {
        userId,
        amount,
        hasIdempotencyKey: !!idempotencyKey,
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
        .select('balance, balance_on_hold, stripe_connect_account_id, stripe_connect_onboarded_at')
        .eq('id', userId)
        .single();

      if (!profile) {
        return jsonResponse({ error: 'Profile not found' }, 404);
      }

      const p = profile as Profile;
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
          console.error(
            '[connect/transfer] CRITICAL: balance refund after failed transfer also failed — manual reconciliation required',
            { userId, amount, error: refundError }
          );
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

      const { data: transaction, error: txError } = await supabase
        .from('wallet_transactions')
        .insert({
          user_id: userId,
          type: 'withdrawal',
          amount: -amount,
          description: 'Withdrawal to bank account',
          status: 'pending',
          stripe_transfer_id: transfer.id,
          stripe_connect_account_id: p.stripe_connect_account_id,
          idempotency_key: idempotencyKey ?? null,
          metadata: { transfer_id: transfer.id, idempotency_key: idempotencyKey ?? null },
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
            console.error(
              '[connect/transfer] CRITICAL: refund of duplicate deduction failed — manual reconciliation required',
              { userId, amount, error: dupRefundError }
            );
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
        console.error(
          '[connect/transfer] CRITICAL: transfer succeeded but transaction record failed — manual reconciliation required',
          { userId, transferId: transfer.id, amount, error: txError }
        );
        return jsonResponse({
          transferId: transfer.id,
          status: 'pending',
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
        status: 'pending',
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
      const body = await req.json();
      const { transactionId } = body;

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
          console.error(
            '[connect] CRITICAL: balance refund after failed retry transfer also failed — manual reconciliation required',
            { userId, amount, error: retryRefundError }
          );
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

      await supabase
        .from('wallet_transactions')
        .update({
          stripe_transfer_id: transfer.id,
          status: 'pending',
          metadata: {
            ...t.metadata,
            retry_count: retryCount + 1,
            retried_at: new Date().toISOString(),
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

    // GET /connect/bank-accounts — list external bank accounts on the Connect account
    if (req.method === 'GET' && subPath === '/bank-accounts') {
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        return jsonResponse({ bankAccounts: [] });
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
      return jsonResponse({ bankAccounts });
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

    // DELETE /connect/bank-accounts/:bankAccountId — remove a bank account
    if (req.method === 'DELETE' && subPath.startsWith('/bank-accounts/')) {
      const bankAccountId = subPath.slice('/bank-accounts/'.length).split('/')[0];
      if (!bankAccountId) {
        return jsonResponse({ error: 'bankAccountId is required' }, 400);
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        return jsonResponse({ error: 'Stripe Connect account not found' }, 404);
      }

      await stripe.accounts.deleteExternalAccount(accountId, bankAccountId);
      return jsonResponse({ success: true });
    }

    // POST /connect/bank-accounts/:bankAccountId/default — set as default payout account
    if (
      req.method === 'POST' &&
      subPath.startsWith('/bank-accounts/') &&
      subPath.endsWith('/default')
    ) {
      const bankAccountId = subPath.slice('/bank-accounts/'.length).replace('/default', '');
      if (!bankAccountId) {
        return jsonResponse({ error: 'bankAccountId is required' }, 400);
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        return jsonResponse({ error: 'Stripe Connect account not found' }, 404);
      }

      const updated = (await stripe.accounts.updateExternalAccount(accountId, bankAccountId, {
        default_for_currency: true,
      } as Stripe.ExternalAccountUpdateParams)) as Stripe.BankAccount;

      return jsonResponse({
        success: true,
        bankAccount: {
          id: updated.id,
          last4: updated.last4,
          isDefault: updated.default_for_currency,
        },
      });
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
