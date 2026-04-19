import type { Profile } from '../_shared/types.ts';
import {
  corsHeaders,
  getBearerToken,
  getProfileById,
  getStripeClient,
  getSupabaseEnv,
  jsonResponse,
  updateProfileById,
  validateUserFromJwt,
} from '../_shared/stripe-connect-helpers.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return jsonResponse({ error: 'Missing or invalid authorization header' }, 401);
    }

    const { supabaseUrl, serviceRoleKey } = getSupabaseEnv();
    const user = await validateUserFromJwt({ supabaseUrl, serviceRoleKey, token });
    if (!user?.id) {
      return jsonResponse({ error: 'Invalid or expired token' }, 401);
    }

    const profile = (await getProfileById({
      supabaseUrl,
      serviceRoleKey,
      userId: user.id,
      select: 'stripe_connect_account_id,stripe_connect_onboarded_at,payout_failed_at',
    })) as (Profile & { payout_failed_at?: string | null }) | null;

    if (!profile?.stripe_connect_account_id) {
      return jsonResponse({ onboarded: false });
    }

    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(profile.stripe_connect_account_id);
    const onboarded = account.charges_enabled && account.payouts_enabled;

    const profileUpdates: Record<string, unknown> = {};

    if (onboarded && !profile.stripe_connect_onboarded_at) {
      profileUpdates.stripe_connect_onboarded_at = new Date().toISOString();
    }

    if (account.payouts_enabled && profile.payout_failed_at) {
      profileUpdates.payout_failed_at = null;
      profileUpdates.payout_failure_code = null;
    }

    if (Object.keys(profileUpdates).length > 0) {
      await updateProfileById({
        supabaseUrl,
        serviceRoleKey,
        userId: user.id,
        updates: profileUpdates,
      });
    }

    return jsonResponse({
      onboarded,
      accountId: account.id,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
      payoutFailedCleared: account.payouts_enabled && !!profile.payout_failed_at,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[verify-stripe-connect edge fn] Error:', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});
