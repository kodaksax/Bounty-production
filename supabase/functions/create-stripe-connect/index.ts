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

    const stripe = getStripeClient();
    const appUrl = Deno.env.get('APP_URL') ?? 'http://localhost:8081';

    const body = await req.json().catch(() => ({}));
    const returnUrl =
      typeof body?.returnUrl === 'string' && body.returnUrl.trim() ? body.returnUrl : undefined;
    const refreshUrl =
      typeof body?.refreshUrl === 'string' && body.refreshUrl.trim() ? body.refreshUrl : undefined;
    const accountLinkType: 'account_onboarding' | 'account_update' =
      body?.type === 'account_update' ? 'account_update' : 'account_onboarding';

    const profile = (await getProfileById({
      supabaseUrl,
      serviceRoleKey,
      userId: user.id,
      select: 'stripe_connect_account_id,email',
    })) as Profile | null;

    let accountId = profile?.stripe_connect_account_id ?? null;

    if (!accountId) {
      if (accountLinkType === 'account_update') {
        return jsonResponse(
          {
            error:
              'No Stripe Connect account found to update. Please complete onboarding first.',
          },
          400
        );
      }

      const account = await stripe.accounts.create({
        type: 'express',
        email: profile?.email ?? undefined,
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        business_type: 'individual',
        metadata: { user_id: user.id },
      });

      accountId = account.id;

      await updateProfileById({
        supabaseUrl,
        serviceRoleKey,
        userId: user.id,
        updates: { stripe_connect_account_id: accountId },
      });
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
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('[create-stripe-connect edge fn] Error:', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});
