import { HttpError, type FunctionEnvConfig } from './supabase.ts';

type StripePrimitive = string | number | boolean | null | undefined;
type StripeFormValue = StripePrimitive | StripeFormValue[] | Record<string, StripeFormValue>;

export interface StripeConnectAccount {
  id: string;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  capabilities?: Record<string, string | null>;
  requirements?: {
    currently_due?: string[];
    eventually_due?: string[];
    past_due?: string[];
    pending_verification?: string[];
    disabled_reason?: string | null;
  };
}

export interface StripeAccountLink {
  url: string;
  expires_at: number;
}

function appendFormValue(params: URLSearchParams, key: string, value: StripeFormValue): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendFormValue(params, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === 'object') {
    Object.entries(value).forEach(([nestedKey, nestedValue]) =>
      appendFormValue(params, `${key}[${nestedKey}]`, nestedValue)
    );
    return;
  }
  params.append(key, String(value));
}

function toFormBody(payload: Record<string, StripeFormValue>): string {
  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => appendFormValue(params, key, value));
  return params.toString();
}

async function stripeRequest<T>(config: FunctionEnvConfig, opts: {
  method?: 'GET' | 'POST';
  endpoint: string;
  formBody?: Record<string, StripeFormValue>;
  idempotencyKey?: string;
}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
  };
  let body: string | undefined;

  if (method === 'POST') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = toFormBody(opts.formBody ?? {});
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
  }

  const response = await fetch(`https://api.stripe.com/v1${opts.endpoint}`, {
    method,
    headers,
    body,
  });

  const rawResponse = await response.text();
  let payload: { error?: { message?: string } } | null = null;
  if (rawResponse) {
    try {
      payload = JSON.parse(rawResponse) as { error?: { message?: string } };
    } catch {
      if (!response.ok) {
        throw new HttpError(response.status, `Stripe request failed with status ${response.status}`);
      }
      throw new HttpError(502, 'Stripe returned a non-JSON response');
    }
  }

  if (!response.ok) {
    throw new HttpError(
      response.status,
      payload?.error?.message ?? `Stripe request failed with status ${response.status}`
    );
  }

  return payload as T;
}

export async function createExpressConnectAccount(
  config: FunctionEnvConfig,
  params: { userId: string; email?: string | null; idempotencyKey: string }
): Promise<StripeConnectAccount> {
  return stripeRequest<StripeConnectAccount>(config, {
    method: 'POST',
    endpoint: '/accounts',
    idempotencyKey: params.idempotencyKey,
    formBody: {
      type: 'express',
      business_type: 'individual',
      email: params.email ?? undefined,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: {
        user_id: params.userId,
      },
    },
  });
}

export async function createStripeAccountLink(
  config: FunctionEnvConfig,
  params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
    type?: 'account_onboarding' | 'account_update';
  }
): Promise<StripeAccountLink> {
  return stripeRequest<StripeAccountLink>(config, {
    method: 'POST',
    endpoint: '/account_links',
    formBody: {
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: params.type ?? 'account_onboarding',
    },
  });
}

export async function getStripeAccount(config: FunctionEnvConfig, accountId: string): Promise<StripeConnectAccount> {
  return stripeRequest<StripeConnectAccount>(config, {
    endpoint: `/accounts/${encodeURIComponent(accountId)}`,
  });
}
