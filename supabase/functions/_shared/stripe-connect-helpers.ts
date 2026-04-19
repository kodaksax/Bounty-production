import Stripe from 'npm:stripe@14';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function getRequiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getStripeClient() {
  const stripeKey = getRequiredEnv('STRIPE_SECRET_KEY');
  return new Stripe(stripeKey, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  });
}

function getServiceHeaders(params: { serviceRoleKey: string; authToken?: string }) {
  const { serviceRoleKey, authToken } = params;
  return {
    apikey: serviceRoleKey,
    Authorization: authToken ? `Bearer ${authToken}` : `Bearer ${serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
}

export function getSupabaseEnv() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL').replace(/\/$/, '');
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  return { supabaseUrl, serviceRoleKey };
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

export async function validateUserFromJwt(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  token: string;
}) {
  const { supabaseUrl, serviceRoleKey, token } = params;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: getServiceHeaders({ serviceRoleKey, authToken: token }),
  });

  if (!response.ok) {
    return null;
  }

  const user = (await response.json()) as { id?: string } | null;
  if (!user?.id) return null;
  return user;
}

export async function getProfileById(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  select: string;
}) {
  const { supabaseUrl, serviceRoleKey, userId, select } = params;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=${encodeURIComponent(select)}&limit=1`,
    {
      method: 'GET',
      headers: {
        ...getServiceHeaders({ serviceRoleKey }),
        Prefer: 'count=none',
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to fetch profile (${response.status}): ${body}`);
  }

  const rows = (await response.json()) as Record<string, unknown>[];
  return rows[0] ?? null;
}

export async function updateProfileById(params: {
  supabaseUrl: string;
  serviceRoleKey: string;
  userId: string;
  updates: Record<string, unknown>;
}) {
  const { supabaseUrl, serviceRoleKey, userId, updates } = params;
  const response = await fetch(
    `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        ...getServiceHeaders({ serviceRoleKey }),
        Prefer: 'return=representation',
      },
      body: JSON.stringify(updates),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to update profile (${response.status}): ${body}`);
  }

  return response.json();
}
