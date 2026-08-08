// eslint-disable-next-line import/no-unresolved
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const ATTRIBUTION_KEYS = [
  'initial_utm_source',
  'initial_utm_medium',
  'initial_utm_campaign',
  'initial_referrer',
  'initial_landing_page',
  'install_source',
  'install_campaign',
] as const;

type AttributionProperties = Partial<Record<(typeof ATTRIBUTION_KEYS)[number], string>>;

function safeString(value: unknown, maxLength = 1000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maxLength) : undefined;
}

function parseDeferredDeepLink(value: unknown): AttributionProperties {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return Object.fromEntries(
    ATTRIBUTION_KEYS.flatMap(key => {
      const parsed = safeString(
        input[key],
        key.includes('page') || key.includes('referrer') ? 1000 : 200
      );
      return parsed ? [[key, parsed]] : [];
    })
  );
}

function parseInstallReferrer(value: unknown): AttributionProperties {
  const raw = safeString(value, 4000);
  if (!raw) return {};

  const params = new URLSearchParams(raw);
  const source = safeString(params.get('utm_source'), 200);
  const medium = safeString(params.get('utm_medium'), 200);
  const campaign = safeString(params.get('utm_campaign'), 200);
  const referrer = safeString(params.get('referrer'), 1000);
  return {
    ...(source ? { initial_utm_source: source, install_source: source } : {}),
    ...(medium ? { initial_utm_medium: medium } : {}),
    ...(campaign ? { initial_utm_campaign: campaign, install_campaign: campaign } : {}),
    ...(referrer ? { initial_referrer: referrer } : {}),
  };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser();
  if (authError || !user) return jsonResponse({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const platform = body.platform === 'ios' || body.platform === 'android' ? body.platform : null;
  if (!platform) return jsonResponse({ error: 'Invalid platform' }, 400);

  const referrerProperties = parseInstallReferrer(body.install_referrer);
  const deferredProperties = parseDeferredDeepLink(body.deferred_deep_link);
  const properties: AttributionProperties = {
    ...referrerProperties,
    ...deferredProperties,
  };

  if (Object.keys(properties).length === 0) {
    return jsonResponse({ status: 'unattributed', platform });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc('claim_marketing_attribution', {
    p_user_id: user.id,
    p_properties: properties,
  });
  if (error || !data) {
    console.error('[marketing-attribute] failed to claim attribution', {
      userId: user.id,
      message: error?.message,
    });
    return jsonResponse({ error: 'Failed to persist attribution' }, 500);
  }

  const result = data as AttributionProperties & { already_attributed?: boolean };
  return jsonResponse({
    status: result.already_attributed ? 'already_attributed' : 'attributed',
    platform,
    match_method:
      Object.keys(deferredProperties).length > 0 ? 'branch_deferred_link' : 'play_referrer',
    match_confidence: 1,
    campaign_id: result.initial_utm_campaign ?? null,
    utm_source: result.initial_utm_source ?? null,
    ...Object.fromEntries(ATTRIBUTION_KEYS.map(key => [key, result[key] ?? null])),
  });
});
