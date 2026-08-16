// Supabase Edge Function: stripe-mode-check
// Diagnostic-only. Reports whether this project's STRIPE_SECRET_KEY is a
// live-mode or test-mode key, without touching any financial data or
// exposing the key itself (only its sk_test_/sk_live_ prefix). Exists to let
// a human (or CI) verify environment isolation before treating a Supabase
// branch as safe for withdrawal/payment testing — this project has a history
// of assuming an environment's Stripe configuration without checking it
// first, which is exactly the class of mistake this closes.
//
// GET/POST, no body required. Gateway JWT verification is enabled in
// supabase/config.toml because Stripe mode and account configuration are
// operationally sensitive.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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

  const stripeKey = Deno.env.get('STRIPE_SECRET_KEY');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

  if (!stripeKey) {
    return jsonResponse({ configured: false, webhookSecretConfigured: !!webhookSecret });
  }

  try {
    const resp = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const data = await resp.json();
    return jsonResponse({
      configured: true,
      reachable: resp.ok,
      livemode: typeof data.livemode === 'boolean' ? data.livemode : null,
      webhookSecretConfigured: !!webhookSecret,
    });
  } catch (err) {
    return jsonResponse(
      {
        configured: true,
        reachable: false,
        error: (err as Error).message,
        webhookSecretConfigured: !!webhookSecret,
      },
      502
    );
  }
});
