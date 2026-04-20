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
      const { currency = 'usd' } = body;
      const amount = Number(body.amount);

      if (!Number.isFinite(amount) || amount <= 0) {
        return jsonResponse({ error: 'Invalid amount' }, 400);
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
        return jsonResponse({ error: 'Stripe Connect account not set up' }, 400);
      }

      // Enforce hold: available = balance - balance_on_hold.
      const available = (p.balance ?? 0) - (p.balance_on_hold ?? 0);
      if (available < amount) {
        return jsonResponse({ error: 'Insufficient balance' }, 400);
      }

      // Deduct balance atomically via withdraw_balance which enforces the hold check.
      const { error: balanceError } = await supabase.rpc('withdraw_balance', {
        p_user_id: userId,
        p_amount: amount,
      });

      if (balanceError) {
        console.error('[connect] Error deducting balance before transfer:', balanceError);
        return jsonResponse({ error: 'Failed to reserve balance' }, 500);
      }

      let transfer: Stripe.Transfer;
      try {
        transfer = await stripe.transfers.create({
          amount: Math.round(amount * 100),
          currency,
          destination: p.stripe_connect_account_id,
          metadata: { user_id: userId },
        });
      } catch (stripeError) {
        // Refund the deducted balance if Stripe transfer creation fails
        console.error('[connect] Transfer creation failed, refunding balance:', stripeError);
        await supabase
          .rpc('update_balance', { p_user_id: userId, p_amount: amount })
          .catch((rpcErr: unknown) =>
            console.error('[connect] Balance refund after failed transfer also failed:', rpcErr)
          );
        throw stripeError;
      }

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
          metadata: { transfer },
        })
        .select()
        .single();

      if (txError) {
        console.error('[connect] Error creating transaction:', txError);
        throw txError;
      }

      return jsonResponse({
        transferId: transfer.id,
        status: 'pending',
        amount,
        currency,
        accountId: p.stripe_connect_account_id,
        transactionId: (transaction as WalletTransaction).id,
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
        transfer = await stripe.transfers.create({
          amount: Math.round(amount * 100),
          currency: 'usd',
          destination: p.stripe_connect_account_id,
          metadata: { user_id: userId, retry_of_transaction: transactionId },
        });
      } catch (stripeError) {
        console.error('[connect] Transfer creation failed, refunding balance:', stripeError);
        await supabase
          .rpc('update_balance', { p_user_id: userId, p_amount: amount })
          .catch((rpcErr: unknown) =>
            console.error(
              '[connect] Balance refund after failed retry transfer also failed:',
              rpcErr
            )
          );
        throw stripeError;
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

    // POST /connect/bank-accounts — add a bank account to the Connect account
    if (req.method === 'POST' && subPath === '/bank-accounts') {
      const body = await req.json().catch(() => ({}));
      const { accountHolderName, routingNumber, accountNumber, accountType } = body ?? {};

      if (!accountHolderName || !routingNumber || !accountNumber || !accountType) {
        return jsonResponse(
          {
            error: 'accountHolderName, routingNumber, accountNumber, and accountType are required',
          },
          400
        );
      }
      if (String(routingNumber).length !== 9) {
        return jsonResponse({ error: 'Routing number must be 9 digits' }, 400);
      }
      if (String(accountNumber).length < 4) {
        return jsonResponse({ error: 'Account number must be at least 4 digits' }, 400);
      }
      if (!['checking', 'savings'].includes(accountType)) {
        return jsonResponse({ error: 'accountType must be "checking" or "savings"' }, 400);
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_connect_account_id')
        .eq('id', userId)
        .single();

      const accountId = (profile as { stripe_connect_account_id?: string } | null)
        ?.stripe_connect_account_id;
      if (!accountId) {
        return jsonResponse(
          {
            error: 'Stripe Connect account not found. Please complete onboarding first.',
            requiresOnboarding: true,
          },
          400
        );
      }

      const bankAccount = await stripe.accounts.createExternalAccount(accountId, {
        external_account: {
          object: 'bank_account',
          country: 'US',
          currency: 'usd',
          account_holder_name: accountHolderName,
          account_holder_type: 'individual',
          routing_number: String(routingNumber),
          account_number: String(accountNumber),
        } as Stripe.ExternalAccountCreateParams,
      });

      const ba = bankAccount as Stripe.BankAccount;
      return jsonResponse({
        success: true,
        bankAccount: {
          id: ba.id,
          last4: ba.last4,
          bankName: ba.bank_name ?? null,
          accountHolderName: ba.account_holder_name ?? null,
          accountType: ba.account_type ?? null,
          default: ba.default_for_currency,
          status: ba.status,
          verified: ba.status === 'verified',
        },
      });
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
