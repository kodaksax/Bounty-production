import {
  HttpError,
  createServiceRoleSupabaseClient,
  getFunctionEnvConfig,
  getProfileStripeConnectData,
  saveStripeConnectAccountId,
  validateJwtAndGetUser,
} from '../_shared/supabase.ts';
import { createExpressConnectAccount, createStripeAccountLink } from '../_shared/stripe.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function defaultRefreshUrl(appDomain: string, appDeepLinkScheme: string): string {
  return `${appDomain}/wallet/connect/refresh?deep_link=${encodeURIComponent(
    buildDeepLinkUrl(appDeepLinkScheme, 'refresh')
  )}`;
}

function defaultReturnUrl(appDomain: string, appDeepLinkScheme: string): string {
  return `${appDomain}/wallet/connect/return?deep_link=${encodeURIComponent(
    buildDeepLinkUrl(appDeepLinkScheme, 'return')
  )}`;
}

function buildDeepLinkUrl(appDeepLinkScheme: string, endpoint: 'refresh' | 'return'): string {
  return `${appDeepLinkScheme}://wallet/connect/${endpoint}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const config = getFunctionEnvConfig();
    const user = await validateJwtAndGetUser(req, config);
    const supabase = createServiceRoleSupabaseClient(config);
    const profile = await getProfileStripeConnectData(supabase, user.id);

    const body = await req.json().catch(() => ({})) as {
      returnUrl?: string;
      refreshUrl?: string;
      type?: 'account_onboarding' | 'account_update';
    };

    const linkType: 'account_onboarding' | 'account_update' =
      body?.type === 'account_update' ? 'account_update' : 'account_onboarding';

    let accountId = profile.stripe_connect_account_id ?? null;
    let accountCreated = false;

    if (!accountId) {
      if (linkType === 'account_update') {
        throw new HttpError(400, 'No Stripe Connect account found to update. Start onboarding first.');
      }

      const account = await createExpressConnectAccount(config, {
        userId: user.id,
        email: profile.email ?? user.email,
        idempotencyKey: `create_stripe_connect_account_${user.id}`,
      });

      accountId = account.id;
      accountCreated = true;
      await saveStripeConnectAccountId(supabase, user.id, accountId);
    }

    const refreshUrl = body?.refreshUrl || defaultRefreshUrl(config.appDomain, config.appDeepLinkScheme);
    const returnUrl = body?.returnUrl || defaultReturnUrl(config.appDomain, config.appDeepLinkScheme);
    const deepLinkReturnUrl = buildDeepLinkUrl(config.appDeepLinkScheme, 'return');

    const accountLink = await createStripeAccountLink(config, {
      accountId,
      refreshUrl,
      returnUrl,
      type: linkType,
    });

    return jsonResponse({
      accountId,
      onboardingUrl: accountLink.url,
      expiresAt: accountLink.expires_at * 1000,
      accountCreated,
      refreshUrl,
      returnUrl,
      deepLinkReturnUrl,
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    const err = error as { message?: string };
    console.error('[create-stripe-connect] unexpected error', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});
