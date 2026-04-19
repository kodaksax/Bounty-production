import {
  HttpError,
  createServiceRoleSupabaseClient,
  getFunctionEnvConfig,
  getProfileStripeConnectData,
  validateJwtAndGetUser,
} from '../_shared/supabase.ts';
import { getStripeAccount } from '../_shared/stripe.ts';

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

    const body = await req.json().catch(() => ({})) as { accountId?: string };
    let accountId = body?.accountId?.trim();

    if (!accountId) {
      const profile = await getProfileStripeConnectData(supabase, user.id);
      accountId = profile.stripe_connect_account_id ?? undefined;
    }

    if (!accountId) {
      throw new HttpError(404, 'No Stripe Connect account found for this user');
    }

    const account = await getStripeAccount(config, accountId);

    return jsonResponse({
      accountId: account.id,
      details_submitted: account.details_submitted,
      capabilities: account.capabilities ?? {},
      charges_enabled: account.charges_enabled,
      payouts_enabled: account.payouts_enabled,
      requirements: account.requirements ?? {},
    });
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    const err = error as { message?: string };
    console.error('[verify-stripe-connect] unexpected error', err);
    return jsonResponse({ error: err.message ?? 'Internal server error' }, 500);
  }
});
