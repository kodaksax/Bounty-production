/**
 * Accepting a hunter through the accept-bounty-request edge function.
 *
 * The function checks the poster's account and runs fn_accept_bounty_request as
 * the caller. This returns the same { data, error }
 * shape as supabase.rpc so the mapping in bountyRequestService.acceptRequest
 * applies unchanged: error.message carries the database's own reason
 * ('insufficient_funds_for_escrow', 'bounty_not_open', ...), or the function's
 * code when it refused before reaching the database ('card_charge_failed').
 *
 * The function never charges a card for this client. Every hire in the app goes
 * through the funding gate first, which shows the amount and takes any payment. A
 * shortfall reaching the server means the balance moved after the poster confirmed,
 * so it comes back as insufficient_funds_for_escrow and the gate asks them.
 *
 * Direct fetch rather than supabase.functions.invoke(): invoke() can hang on the
 * supabase-js session lock and never send the request (see invokePayments in
 * stripe-internal.ts). Repeating a call is safe, because the charge is idempotent
 * and the RPC refuses a request that is no longer pending.
 */
import { supabase, supabaseEnv } from 'lib/supabase';
import { getSupabaseAnonKey } from './stripe-internal';

const SESSION_TIMEOUT_MS = 5000;
// Long enough for a card charge plus the acceptance.
const REQUEST_TIMEOUT_MS = 30000;

export interface AcceptEdgeError {
  message: string;
  code?: string;
  status?: number;
  fallback?: string;
}

export interface AcceptEdgeResult {
  data: unknown;
  error: AcceptEdgeError | null;
}

const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/** Turns the function's HTTP response into the supabase.rpc shape. */
export function parseAcceptEdgeResponse(status: number, text: string): AcceptEdgeResult {
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }

  if (status >= 200 && status < 300) {
    return { data: body?.data ?? null, error: null };
  }

  // `details` is PostgREST's error body as text when the RPC itself failed.
  let database: any = null;
  if (typeof body?.details === 'string') {
    try {
      database = JSON.parse(body.details);
    } catch {
      database = { message: body.details };
    }
  }

  const ownCode =
    typeof body?.code === 'string' && MACHINE_CODE.test(body.code) ? body.code : undefined;
  const message: string =
    database?.message ||
    ownCode ||
    // The ownership lookup found no such request.
    (status === 404 ? 'request_not_found' : '') ||
    body?.error ||
    `accept-bounty-request failed with ${status}`;

  return {
    data: null,
    error: {
      message,
      code: database?.code ?? ownCode,
      status,
      ...(typeof body?.fallback === 'string' ? { fallback: body.fallback } : {}),
    },
  };
}

async function currentAccessToken(refresh: boolean): Promise<string | undefined> {
  const read = refresh ? supabase.auth.refreshSession() : supabase.auth.getSession();
  const result: any = await Promise.race([
    read,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session timeout')), SESSION_TIMEOUT_MS)
    ),
  ]);
  return result?.data?.session?.access_token;
}

async function post(requestId: string, token: string | undefined): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(
      `${String(supabaseEnv.url).replace(/\/$/, '')}/functions/v1/accept-bounty-request`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: getSupabaseAnonKey(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ request_id: requestId, allow_card_charge: false }),
        signal: controller.signal,
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function invokeAcceptBountyRequest(requestId: string): Promise<AcceptEdgeResult> {
  try {
    let token: string | undefined;
    try {
      token = await currentAccessToken(false);
    } catch {
      token = undefined; // The function answers 401, and that is retried below.
    }

    let response = await post(requestId, token);
    if (response.status === 401) {
      const refreshed = await currentAccessToken(true).catch(() => undefined);
      if (refreshed) response = await post(requestId, refreshed);
    }

    return parseAcceptEdgeResponse(response.status, await response.text());
  } catch (err) {
    // No response. The hire may or may not have happened, and the caller's list
    // reload shows which. 'network' is what classifyAcceptFundingError matches.
    const detail = err instanceof Error ? err.message : String(err);
    return { data: null, error: { message: `network: ${detail}` } };
  }
}
