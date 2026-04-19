import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface FunctionEnvConfig {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  stripeSecretKey: string;
  appDomain: string;
  appDeepLinkScheme: string;
}

export interface AuthenticatedUser {
  id: string;
  email?: string | null;
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new HttpError(500, `Missing required environment variable: ${name}`);
  }
  return value;
}

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getFunctionEnvConfig(): FunctionEnvConfig {
  const supabaseUrl = trimTrailingSlashes(requiredEnv('SUPABASE_URL'));
  const supabaseServiceRoleKey = requiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = requiredEnv('STRIPE_SECRET_KEY');

  const appDomain = trimTrailingSlashes(
    Deno.env.get('APP_DOMAIN') ??
      Deno.env.get('APP_URL') ??
      Deno.env.get('EXPO_PUBLIC_API_URL') ??
      'http://localhost:8081'
  );
  const appDeepLinkScheme =
    Deno.env.get('APP_DEEP_LINK_SCHEME') ?? Deno.env.get('EXPO_PUBLIC_DEEP_LINK_SCHEME') ?? 'bountyexpo';

  return {
    supabaseUrl,
    supabaseServiceRoleKey,
    stripeSecretKey,
    appDomain,
    appDeepLinkScheme,
  };
}

export function getBearerToken(req: Request): string {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new HttpError(401, 'Missing or invalid Authorization header');
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new HttpError(401, 'Missing bearer token');
  }
  return token;
}

export async function validateJwtAndGetUser(req: Request, config: FunctionEnvConfig): Promise<AuthenticatedUser> {
  const token = getBearerToken(req);

  const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: config.supabaseServiceRoleKey,
    },
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(401, 'Invalid or expired token');
    }
    throw new HttpError(503, 'Authentication service unavailable');
  }

  const user = (await response.json()) as AuthenticatedUser | null;
  if (!user?.id) {
    throw new HttpError(401, 'Invalid authentication payload');
  }
  return user;
}

export function createServiceRoleSupabaseClient(config: FunctionEnvConfig) {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export type ServiceRoleSupabaseClient = ReturnType<typeof createServiceRoleSupabaseClient>;

export async function getProfileStripeConnectData(supabase: ServiceRoleSupabaseClient, userId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, stripe_connect_account_id')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, 'Failed to fetch profile');
  }
  if (!data) {
    throw new HttpError(404, 'Profile not found');
  }
  return data as {
    id: string;
    email?: string | null;
    stripe_connect_account_id?: string | null;
  };
}

export async function saveStripeConnectAccountId(
  supabase: ServiceRoleSupabaseClient,
  userId: string,
  accountId: string
) {
  const { error } = await supabase
    .from('profiles')
    .update({ stripe_connect_account_id: accountId })
    .eq('id', userId);

  if (error) {
    throw new HttpError(500, 'Failed to save Stripe Connect account id');
  }
}
