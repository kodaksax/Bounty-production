/**
 * Shared internals for the Stripe service family.
 *
 * This module holds:
 *  - The low-level Edge Function invocation helpers (`fetchEdgeFunction`, `invokePayments`).
 *  - Error normalization (`handleStripeError`).
 *  - Small pure helpers used across Stripe sub-services (card brand detection,
 *    card number validation, payment-intent status mapping).
 *  - The canonical Stripe request/response TypeScript interfaces.
 *
 * Extracted from the original monolithic `stripe-service.ts` so that focused
 * sub-services (`escrow-service`, `payment-methods-service`, `connect-service`)
 * can reuse the same low-level plumbing without duplicating it.
 */
import Constants from 'expo-constants';
import { FINANCIAL_API_BASE_URL } from '../config/api';
import { API_TIMEOUTS } from '../config/network';
import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';
import { getNetworkErrorMessage } from '../utils/network-connectivity';

/**
 * Options for `invokePayments`, which calls a Supabase Edge Function
 * sub-path under `/payments`.
 *
 * Control flow of `invokePayments` (in order of preference):
 *
 *   1. **Direct fetch with explicit auth headers (preferred).** When the
 *      Supabase anon key is available we call `${FINANCIAL_API_BASE_URL}/<subPath>`
 *      directly with `apikey` + `Authorization: Bearer <jwt>` headers. We
 *      obtain the JWT either from `options.accessToken` (when the caller
 *      already has a fresh token) or via `supabase.auth.getSession()` with a
 *      5 s timeout guard. This avoids the supabase-js internal session lock
 *      contention described in the `invokePayments` body comment, which can
 *      cause `functions.invoke()` to hang indefinitely under concurrent auth
 *      events (explicit refresh racing with auto-refresh).
 *
 *   2. **`supabase.functions.invoke()` fallback.** Used when no anon key is
 *      configured (local dev / unit tests with a stubbed Supabase client that
 *      still exposes `.functions.invoke`). Supabase JS client sets the auth
 *      headers internally but is subject to the session-lock contention above,
 *      so it is only used as a fallback.
 *
 *   3. **Unauthenticated direct fetch (last resort).** If the stubbed client
 *      also lacks `.functions.invoke` (legacy Node server setups), we fall
 *      back to a plain fetch with no auth headers.
 */
export interface InvokePaymentsOptions {
  method?: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Pre-obtained JWT — skips the internal getSession() call and avoids lock contention. */
  accessToken?: string;
}

function getExtraValue(key: string): string {
  try {
    const extra = Constants.expoConfig?.extra as Record<string, unknown> | undefined;
    const v = extra?.[key];
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return '';
  }
}

// Supabase anon key — required alongside the user's JWT when calling Edge
// Functions directly via fetch (identifies the project to the Supabase gateway).
// Read dynamically (not as a module-level constant) so that the test environment
// can control routing by setting/clearing process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
// in beforeAll/afterAll without needing to re-load the module.
//
// Resolution order matches lib/config.ts (process.env first, Constants.expoConfig.extra
// last) so this function returns the same key as the Supabase client and wallet context.
// Previously Constants.expoConfig.extra was checked first, which could return a stale or
// wrong-project key baked into an older build manifest, causing the Supabase gateway to
// reject requests with "Invalid JWT" before they reached the edge function.
export function getSupabaseAnonKey(): string {
  return (
    (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    (process.env.SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    getExtraValue('EXPO_PUBLIC_SUPABASE_ANON_KEY') ||
    ''
  );
}

/**
 * Shared fetch helper: makes the actual HTTP call to an Edge Function URL,
 * parses the response, and throws structured errors on failure.
 */
export async function fetchEdgeFunction<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Record<string, unknown> | undefined
): Promise<T> {
  const hasBody = body !== undefined;
  if (hasBody) headers['Content-Type'] = 'application/json';

  try {
    const fetchController = new AbortController();
    const fetchTimeoutId = setTimeout(() => fetchController.abort(), API_TIMEOUTS.DEFAULT);

    const fetchResult = fetch(url, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      signal: fetchController.signal,
    });

    const response = await Promise.resolve(fetchResult).finally(() => clearTimeout(fetchTimeoutId));

    // Guard: confirm that the response object is sufficiently shaped before use.
    // Unit-test mocks often provide only { ok, text, json } without headers.
    if (!response || typeof response.text !== 'function') {
      throw {
        type: 'network_error',
        code: 'NETWORK_ERROR',
        message: 'Unexpected response shape from fetch — missing required .text() method',
      };
    }

    let parsedBody: any = null;
    const responseText = await response.text();
    if (responseText) {
      try {
        parsedBody = JSON.parse(responseText);
      } catch {
        /* non-JSON */
      }
    }

    // response.headers may be absent on lightweight test mocks — guard defensively.
    if (response.headers?.get?.('X-Deprecated') === 'true') {
      // eslint-disable-next-line no-console
      console.warn(
        `[API] Received X-Deprecated header on ${method} ${url} — this server surface is deprecated. ` +
          'Please ensure EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_FUNCTIONS_URL is set so requests ' +
          'route to the Supabase Edge Function.'
      );
    }

    if (!response.ok) {
      const status = response.status;
      const errorMsgFromBody =
        (parsedBody && (parsedBody.error || parsedBody.message)) || responseText;
      const errorMsg = errorMsgFromBody ? String(errorMsgFromBody) : `HTTP ${status}`;
      throw {
        type: 'api_error',
        code: String(status),
        message: `Request failed (${status}): ${errorMsg}`,
      };
    }

    return parsedBody as T;
  } catch (err: any) {
    // Re-throw structured errors so callers receive the correct code.
    if (err && (err.type === 'api_error' || err.type === 'network_error')) throw err;
    // Raw network-level failure (offline, DNS, AbortError).
    const message = getNetworkErrorMessage(err as Error);
    throw { type: 'network_error', code: 'NETWORK_ERROR', message };
  }
}

export async function invokePayments<T>(
  subPath: string,
  options: InvokePaymentsOptions = {}
): Promise<T> {
  const url = `${FINANCIAL_API_BASE_URL}/${subPath}`;
  const method = options.method ?? 'POST';

  // ── Preferred path: direct fetch with explicit auth headers ─────────────────
  //
  // WHY we do not use supabase.functions.invoke() here:
  //
  // functions.invoke() calls supabase.auth.getSession() internally before
  // making the HTTP request. In React Native, when a 401 (wrong-project JWT)
  // triggers an explicit token refresh at the same time as the supabase-js
  // auto-refresh timer fires, both callers compete for the supabase-js internal
  // session lock. The lock blocks indefinitely, getSession() never resolves, and
  // the HTTP request is never sent — so the Edge Function sees no request at all
  // (confirmed: zero logs in Supabase dashboard for the timed-out calls).
  // The 15 s client timer then fires from the Promise.race, giving the misleading
  // impression of a slow Edge Function when the function was never invoked.
  //
  // Fix: obtain the session ourselves (with a 5 s guard that re-uses the
  // supabase-js client but races against a timeout), then issue the HTTP request
  // directly. This completely bypasses the lock contention because we hold the
  // token in hand before functions.invoke would even try to read it.
  //
  // getSupabaseAnonKey() is required by the Supabase gateway alongside the user JWT.
  // It is always present in staging/prod (EXPO_PUBLIC_SUPABASE_ANON_KEY env var).
  // In local dev without Supabase we fall through to functions.invoke() below.
  const supabaseAnonKey = getSupabaseAnonKey();
  if (supabaseAnonKey) {
    let token: string | undefined;

    if (options.accessToken) {
      // Caller already has a fresh token — use it directly and skip getSession().
      // This avoids the supabase-js internal session lock entirely, preventing
      // the 5 s TIMEOUT that fires when concurrent auth events (e.g. token
      // refresh + existing session read) hold the lock simultaneously.
      token = options.accessToken;
    } else {
      try {
        const sessionResult = await Promise.race([
          supabase.auth.getSession() as Promise<{
            data: { session: { access_token: string } | null };
            error: unknown;
          }>,
          new Promise<never>((_, reject) =>
            setTimeout(
              () =>
                reject({
                  type: 'network_error',
                  code: 'TIMEOUT',
                  message: `getSession() timed out (5000ms) — possible auth lock contention`,
                }),
              5000
            )
          ),
        ]);
        token = sessionResult.data?.session?.access_token;
      } catch (sessionErr: any) {
        // getSession() hung for 5 s — log a warning and proceed without a token
        // so the Edge Function receives the request (it will respond with 401
        // which the auth recovery path in the caller handles gracefully).
        // Previously this threw immediately, converting a lock-contention delay
        // into a hard failure before the network call was ever attempted.
        if (sessionErr?.code === 'TIMEOUT') {
          logger.warning(
            '[invokePayments] getSession() timed out — proceeding without token; Edge Function may return 401.',
            { subPath }
          );
        }
        // Any other session error (no session, storage failure) — proceed without token.
      }
    }

    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
      apikey: supabaseAnonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    // Diagnostic logging to help trace persistent 401s
    if (__DEV__) {
      try {
        const hasToken = !!token;
        const hasAnonKey = !!supabaseAnonKey;
        let tokenExp: number | undefined;
        let tokenIss: string | undefined;
        let tokenSub: string | undefined;
        if (token) {
          const [, payload] = token.split('.');
          const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
          tokenExp = decoded.exp;
          tokenIss = decoded.iss;
          tokenSub = decoded.sub;
        }
        const nowSec = Math.floor(Date.now() / 1000);
        // Extract the project ref from the anon key JWT (`ref` claim) to verify
        // it matches the target URL project ref. A mismatch means the gateway will
        // reject with "Invalid JWT" before reaching the edge function.
        let anonKeyRef: string | undefined;
        try {
          const ak = supabaseAnonKey;
          if (ak) {
            const [, ap] = ak.split('.');
            const ad = JSON.parse(atob(ap.replace(/-/g, '+').replace(/_/g, '/')));
            anonKeyRef = ad.ref;
          }
        } catch {
          /* ignore */
        }
        console.log(`[invokePayments] ${subPath}`, {
          hasToken,
          hasAnonKey,
          anonKeyRef,
          tokenSource: options.accessToken ? 'caller' : 'getSession',
          tokenExpired: tokenExp ? tokenExp < nowSec : 'no-token',
          tokenExpiresIn: tokenExp ? tokenExp - nowSec : undefined,
          tokenIss,
          tokenSub,
          url,
        });
      } catch {
        /* ignore diagnostic errors */
      }
    }

    return fetchEdgeFunction<T>(url, method, headers, options.body);
  }

  // ── Fallback: supabase.functions.invoke() ────────────────────────────────────
  // Used when SUPABASE_ANON_KEY is absent (local dev / unit tests that stub
  // the supabase client and don't configure real Supabase env vars).
  const supabaseClient = supabase as any;
  if (
    supabaseClient &&
    supabaseClient.functions &&
    typeof supabaseClient.functions.invoke === 'function'
  ) {
    const invokeOptions: Record<string, unknown> = {
      method: options.method ?? 'POST',
      body: options.body,
    };
    const mergedHeaders: Record<string, string> = { ...(options.headers ?? {}) };
    if (options.accessToken) mergedHeaders['Authorization'] = `Bearer ${options.accessToken}`;
    if (Object.keys(mergedHeaders).length > 0) invokeOptions.headers = mergedHeaders;

    const invokeResult = await Promise.race<{ data: unknown; error: unknown }>([
      supabaseClient.functions.invoke(subPath, invokeOptions),
      new Promise<never>((_, reject) =>
        setTimeout(
          () =>
            reject({
              type: 'network_error',
              code: 'TIMEOUT',
              message: `Edge Function request timed out (${API_TIMEOUTS.DEFAULT}ms)`,
            }),
          API_TIMEOUTS.DEFAULT
        )
      ),
    ]);
    const { data, error } = invokeResult;
    if (error) {
      const status: number = (error as any).context?.status ?? 0;
      let errorMsg = '';
      try {
        const parsed: Record<string, unknown> | null = await (error as any).context
          ?.json?.()
          .catch(() => null);
        errorMsg =
          (parsed?.error as string) ||
          (parsed?.message as string) ||
          String((error as Error).message);
      } catch {
        errorMsg = String((error as Error).message);
      }
      throw {
        type: 'api_error',
        code: String(status),
        message: `Request failed (${status}): ${errorMsg}`,
      };
    }
    return data as T;
  }

  // ── Last resort: unauthenticated fetch (legacy Node server) ──────────────────
  return fetchEdgeFunction<T>(url, method, { ...(options.headers ?? {}) }, options.body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared domain types used by all Stripe sub-services
// ─────────────────────────────────────────────────────────────────────────────

export interface StripePaymentMethod {
  id: string;
  type: 'card' | string;
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
    // Optional fields present in some SDK responses
    checks?: any;
    country?: string;
    fingerprint?: string;
    funding?: string;
  };
  // Optional billing details (SDK may include this)
  billing_details?: {
    address?: any;
    email?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  // Optional metadata and other properties that some SDKs return
  customer?: string | null;
  livemode?: boolean;
  metadata?: Record<string, any>;
  created: number;
}

export interface StripePaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  currency: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'requires_capture'
    | 'canceled'
    | 'succeeded';
}

export interface StripeSetupIntent {
  id: string;
  client_secret: string;
  status:
    | 'requires_payment_method'
    | 'requires_confirmation'
    | 'requires_action'
    | 'processing'
    | 'canceled'
    | 'succeeded';
  payment_method?: string;
}

export interface CreatePaymentMethodData {
  cardNumber: string;
  expiryDate: string;
  securityCode: string;
  cardholderName: string;
}

export interface StripeError {
  type: string;
  code?: string;
  decline_code?: string;
  message: string;
}

export interface PaymentConfirmationResult {
  paymentIntent: StripePaymentIntent;
  requiresAction: boolean;
  error?: StripeError;
}

// Minimal shape for Connect account responses from backend
export interface StripeConnectAccountResponse {
  accountId: string;
}

// Minimal shape for Connect onboarding link response
export interface StripeConnectAccountLinkResponse {
  url: string;
}

// Escrow creation response from backend
export interface StripeEscrowCreateResponse {
  escrowId: string;
  paymentIntentClientSecret: string;
  paymentIntentId: string;
  status: StripePaymentIntent['status'];
}

// Escrow release response from backend
export interface StripeEscrowReleaseResponse {
  transferId?: string;
  paymentIntentId?: string;
  hunterAmount?: number; // Amount transferred to hunter (after fees)
  platformFee?: number; // Platform fee deducted
  status?: 'released' | 'failed';
}

// Escrow refund response from backend
export interface StripeEscrowRefundResponse {
  paymentIntentId?: string;
  refundAmount?: number;
  status?: 'refunded' | 'canceled' | 'failed';
}

// Connect account verification response from backend
export interface StripeConnectVerificationResponse {
  detailsSubmitted: boolean;
  capabilities?: Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map SDK payment intent status to our typed status.
 */
export function mapPaymentIntentStatus(status: string): StripePaymentIntent['status'] {
  const statusMap: Record<string, StripePaymentIntent['status']> = {
    RequiresPaymentMethod: 'requires_payment_method',
    RequiresConfirmation: 'requires_confirmation',
    RequiresAction: 'requires_action',
    Processing: 'processing',
    RequiresCapture: 'requires_capture',
    Canceled: 'canceled',
    Succeeded: 'succeeded',
    // Also handle lowercase versions
    requires_payment_method: 'requires_payment_method',
    requires_confirmation: 'requires_confirmation',
    requires_action: 'requires_action',
    processing: 'processing',
    requires_capture: 'requires_capture',
    canceled: 'canceled',
    succeeded: 'succeeded',
  };
  return statusMap[status] || 'requires_payment_method';
}

export function detectCardBrand(cardNumber: string): string {
  const cleanNumber = cardNumber.replace(/\s/g, '');

  if (cleanNumber.startsWith('4')) return 'visa';
  if (cleanNumber.startsWith('5') || cleanNumber.startsWith('2')) return 'mastercard';
  if (cleanNumber.startsWith('3')) return 'amex';
  if (cleanNumber.startsWith('6')) return 'discover';

  return 'unknown';
}

/**
 * Basic Luhn-algorithm card number validation.
 */
export function validateCardNumber(cardNumber: string): boolean {
  const cleanNumber = cardNumber.replace(/\s/g, '');

  if (cleanNumber.length < 13 || cleanNumber.length > 19) {
    return false;
  }

  let sum = 0;
  let shouldDouble = false;

  for (let i = cleanNumber.length - 1; i >= 0; i--) {
    let digit = parseInt(cleanNumber.charAt(i));

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

/**
 * Normalize miscellaneous error shapes (Stripe SDK, edge function,
 * raw fetch failures) into a single `Error & { type, code, decline_code? }`
 * shape that upstream payment-handling code expects.
 */
export function handleStripeError(
  error: any
): Error & { type?: string; code?: string; decline_code?: string } {
  // Map specific error types to user-friendly messages (must come before the
  // generic `error?.type` fallback so specific handling is not bypassed)
  if (error?.type === 'card_error' || error?.decline_code) {
    // For card errors, decline_code is more specific
    const declineCode = error.decline_code || error.code;
    const declineMessages: Record<string, string> = {
      insufficient_funds: 'Your card has insufficient funds.',
      card_declined: 'Your card was declined.',
      expired_card: 'Your card has expired.',
      incorrect_cvc: 'The CVC code is incorrect.',
      processing_error: 'An error occurred while processing your card.',
      incorrect_number: 'The card number is incorrect.',
      authentication_required: 'Authentication is required. Please try again.',
      card_not_supported: 'This card type is not supported.',
      currency_not_supported: 'This currency is not supported by your card.',
      duplicate_transaction: 'A duplicate transaction was detected.',
      fraudulent: 'This transaction has been flagged as potentially fraudulent.',
      generic_decline: 'Your card was declined. Please contact your bank.',
      lost_card: 'This card has been reported lost.',
      stolen_card: 'This card has been reported stolen.',
      do_not_honor: 'Your bank declined this transaction. Please contact your bank.',
    };

    const message = declineMessages[declineCode] || error.message || 'Your card was declined.';
    const stripeError = new Error(message) as Error & {
      type?: string;
      code?: string;
      decline_code?: string;
    };
    stripeError.type = 'card_error';
    stripeError.code = declineCode;
    stripeError.decline_code = declineCode;
    return stripeError;
  }

  if (error?.type === 'validation_error' || error?.type === 'StripeValidationError') {
    const stripeError = new Error('Invalid payment information provided') as Error & {
      type?: string;
    };
    stripeError.type = 'validation_error';
    return stripeError;
  }

  if (error?.type === 'api_error' || error?.type === 'StripeAPIError') {
    // Preserve the original message when it contains specific API error details
    // (e.g. "Payment methods request failed (405): Method not allowed") so callers
    // can surface a meaningful message rather than a generic fallback.
    const defaultMessage = 'Payment service temporarily unavailable. Please try again.';
    const message =
      error.message && error.message !== defaultMessage ? error.message : defaultMessage;
    const stripeError = new Error(message) as Error & { type?: string; code?: string };
    stripeError.type = 'api_error';
    stripeError.code = error.code;
    return stripeError;
  }

  if (error?.type === 'rate_limit_error') {
    const stripeError = new Error(
      'Too many requests. Please wait a moment and try again.'
    ) as Error & { type?: string };
    stripeError.type = 'rate_limit_error';
    return stripeError;
  }

  if (error?.type === 'authentication_error') {
    const stripeError = new Error(
      'Payment authentication failed. Please contact support.'
    ) as Error & { type?: string };
    stripeError.type = 'authentication_error';
    return stripeError;
  }

  // Handle network errors
  if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
    const stripeError = new Error(
      'Unable to connect to payment service. Check your connection and try again.'
    ) as Error & { type?: string };
    stripeError.type = 'network_error';
    return stripeError;
  }

  // For any other error that already carries a `type` property (unknown Stripe
  // error types, pre-normalised errors, etc.), preserve the shape as-is.
  if (error?.type) {
    const stripeError = new Error(error.message || 'Payment error occurred') as Error & {
      type?: string;
      code?: string;
      decline_code?: string;
    };
    stripeError.type = error.type;
    stripeError.code = error.decline_code || error.code;
    stripeError.decline_code = error.decline_code;
    return stripeError;
  }

  // Default error
  return new Error(error?.message || 'Payment processing failed. Please try again.');
}
