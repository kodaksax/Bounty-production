
// Stripe API types
import Constants from 'expo-constants';
import { API_BASE_URL } from '../config/api';
import { API_TIMEOUTS } from '../config/network';
import { supabase } from '../supabase';
import { logger } from '../utils/error-logger';
import { getNetworkErrorMessage } from '../utils/network-connectivity';
import { analyticsService } from './analytics-service';
import {
    checkDuplicatePayment,
    completePaymentAttempt,
    generateIdempotencyKey,
    logPaymentError,
    parsePaymentError,
    recordPaymentAttempt,
    withPaymentRetry,
} from './payment-error-handler';
import { performanceService } from './performance-service';

/**
 * Call a Supabase Edge Function sub-path under /payments.
 *
 * Uses `supabase.functions.invoke()` which calls `supabase.auth.getSession()`
 * internally to always attach the freshest possible token — bypassing any
 * React-state propagation lag that can cause a stale JWT to be sent.
 * Both the `Authorization` and `apikey` headers are set automatically by
 * the Supabase JS client.
 *
 * When the Supabase client is not fully configured (e.g. in dev/test where a
 * stub client is used and `.functions` is unavailable), this safely falls
 * back to the legacy REST path under `${API_BASE_URL}`.
 */
interface InvokePaymentsOptions {
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
  } catch { return ''; }
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
function getSupabaseAnonKey(): string {
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
async function fetchEdgeFunction<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: Record<string, unknown> | undefined,
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

    let parsedBody: any = null;
    const responseText = await response.text();
    if (responseText) {
      try { parsedBody = JSON.parse(responseText); } catch { /* non-JSON */ }
    }

    if (!response.ok) {
      const status = response.status;
      const errorMsgFromBody = (parsedBody && (parsedBody.error || parsedBody.message)) || responseText;
      const errorMsg = errorMsgFromBody ? String(errorMsgFromBody) : `HTTP ${status}`;
      throw { type: 'api_error', code: String(status), message: `Request failed (${status}): ${errorMsg}` };
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

async function invokePayments<T>(
  subPath: string,
  options: InvokePaymentsOptions = {}
): Promise<T> {
  const url = `${API_BASE_URL}/${subPath}`;
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
          supabase.auth.getSession() as Promise<{ data: { session: { access_token: string } | null }; error: unknown }>,
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject({ type: 'network_error', code: 'TIMEOUT', message: `getSession() timed out (5000ms) — possible auth lock contention` }),
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
          logger.warning('[invokePayments] getSession() timed out — proceeding without token; Edge Function may return 401.', { subPath });
        }
        // Any other session error (no session, storage failure) — proceed without token.
      }
    }

    const headers: Record<string, string> = {
      ...(options.headers ?? {}),
      apikey: supabaseAnonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    // ── Project-ref mismatch detection (always-on, not just __DEV__) ───────
    // Extract the project ref from the anon key and the URL. If they differ,
    // the Supabase gateway will reject the JWT with 401 before the Edge
    // Function is even invoked. This is the primary diagnostic for the
    // "setup intent 401" production bug.
    try {
      let anonKeyRef: string | undefined;
      if (supabaseAnonKey) {
        const parts = supabaseAnonKey.split('.');
        if (parts.length >= 2 && parts[1]) {
          const ad = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          anonKeyRef = ad.ref;
        }
      }
      // Extract project ref from URL: https://<ref>.supabase.co/...
      // Supabase URLs always use <ref>.supabase.co (no extra subdomains).
      let urlRef: string | undefined;
      try {
        const urlHost = new URL(url).hostname;
        const dotParts = urlHost.split('.');
        if (dotParts.length >= 3 && dotParts.slice(-2).join('.') === 'supabase.co') {
          urlRef = dotParts.slice(0, -2).join('.');
        }
      } catch { /* ignore malformed URL */ }

      if (anonKeyRef && urlRef && anonKeyRef !== urlRef) {
        // This is a critical configuration error — always log even in production
        logger.warning(
          `[invokePayments] ⚠️ PROJECT MISMATCH: anon key is for project "${anonKeyRef}" but URL targets "${urlRef}". ` +
          `This WILL cause 401 errors. Check EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are from the same Supabase project.`,
          { subPath, anonKeyRef, urlRef }
        );
      }
    } catch { /* ignore diagnostic errors */ }

    // Detailed diagnostic logging (dev only — verbose info for debugging)
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
        let anonKeyRef: string | undefined;
        try {
          const ak = supabaseAnonKey;
          if (ak) {
            const [, ap] = ak.split('.')
            const ad = JSON.parse(atob(ap.replace(/-/g, '+').replace(/_/g, '/')))
            anonKeyRef = ad.ref
          }
        } catch { /* ignore */ }
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
      } catch { /* ignore diagnostic errors */ }
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
          () => reject({ type: 'network_error', code: 'TIMEOUT', message: `Edge Function request timed out (${API_TIMEOUTS.DEFAULT}ms)` }),
          API_TIMEOUTS.DEFAULT
        )
      ),
    ]);
    const { data, error } = invokeResult;
    if (error) {
      const status: number = (error as any).context?.status ?? 0;
      let errorMsg = '';
      try {
        const parsed: Record<string, unknown> | null =
          await (error as any).context?.json?.().catch(() => null);
        errorMsg = ((parsed?.error as string) || (parsed?.message as string)) || String((error as Error).message);
      } catch {
        errorMsg = String((error as Error).message);
      }
      throw { type: 'api_error', code: String(status), message: `Request failed (${status}): ${errorMsg}` };
    }
    return data as T;
  }

  // ── Last resort: unauthenticated fetch (legacy Node server) ──────────────────
  return fetchEdgeFunction<T>(url, method, { ...(options.headers ?? {}) }, options.body);
}

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
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
}

export interface StripeSetupIntent {
  id: string;
  client_secret: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'canceled' | 'succeeded';
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

class StripeService {
  private publishableKey: string = '';
  private isInitialized: boolean = false;
  private stripeSDK: any = null;

  constructor() {
    // Read from Expo public env (must be prefixed EXPO_PUBLIC_ to reach client bundle)
    const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      logger.error('[StripeService] Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env variable. Payments disabled.');
      this.publishableKey = '';
    } else {
      this.publishableKey = key;
    }
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;
      
      // Initialize the Stripe React Native SDK if available
      // NOTE: The merchantIdentifier must be registered in Apple Developer portal for Apple Pay to work.
      // See STRIPE_INTEGRATION_BACKEND.md for setup instructions.
      try {
        const stripeModule: any = await import('@stripe/stripe-react-native');
        if (stripeModule.initStripe && this.publishableKey) {
          // merchantIdentifier should match your Apple Pay Merchant ID from Apple Developer portal
          const merchantId = process.env.EXPO_PUBLIC_APPLE_PAY_MERCHANT_ID || 'com.bounty0.BOUNTYExpo';
          // Use centralized deep link scheme constant
          const { DEEP_LINK_SCHEME } = await import('../config/app');
          await stripeModule.initStripe({
            publishableKey: this.publishableKey,
            merchantIdentifier: merchantId,
            urlScheme: DEEP_LINK_SCHEME,
          });
          this.stripeSDK = stripeModule;
        }
      } catch (sdkError) {
        // SDK initialization may fail in non-native environments (e.g., web, Node)
        if (__DEV__) {
          logger.error('[StripeService] Unable to initialize SDK (expected in non-native environments):', { error: sdkError });
        }
      }
      
      this.isInitialized = true;
    } catch (error) {
      logger.error('[StripeService] Failed to initialize:', { error });
      throw new Error('Failed to initialize payment service');
    }
  }

  /**
   * Create a payment method using the Stripe SDK
   * For production, this uses the native Stripe SDK to tokenize card data
   */
  async createPaymentMethod(cardData: CreatePaymentMethodData): Promise<StripePaymentMethod> {
    try {
      await this.initialize();
      
      // Detect manual entry usage: when explicit card fields are provided, avoid SDK path
      const isManualEntry = !!cardData.cardNumber && !!cardData.expiryDate && !!cardData.securityCode;

      // Try to use the native Stripe SDK if available, only when not using manual entry
      if (this.stripeSDK?.createPaymentMethod && !isManualEntry) {
        const { paymentMethod, error } = await this.stripeSDK.createPaymentMethod({
          paymentMethodType: 'Card',
          paymentMethodData: {
            billingDetails: {
              name: cardData.cardholderName,
            },
          },
        });
        
        if (error) {
          throw {
            type: 'card_error',
            code: error.code,
            message: error.message,
          };
        }
        
        if (paymentMethod) {
          return {
            id: paymentMethod.id,
            type: 'card',
            card: {
              brand: paymentMethod.Card?.brand || 'unknown',
              last4: paymentMethod.Card?.last4 || '****',
              exp_month: paymentMethod.Card?.expMonth || 0,
              exp_year: paymentMethod.Card?.expYear || 0,
            },
            created: Math.floor(Date.now() / 1000),
          };
        }
      }
      
      // Fallback: Create payment method using card details (for development/testing)
      // In production, this should use CardField or PaymentSheet
      // Validate basic card inputs for fallback
      const cleanNumber = cardData.cardNumber.replace(/\s/g, '');
      if (!this.validateCardNumber(cleanNumber)) {
        throw {
          type: 'validation_error',
          code: 'incorrect_number',
          message: 'Please enter a valid card number',
        };
      }
      const [mm, yy] = cardData.expiryDate.split('/');
      const expMonth = parseInt(mm, 10);
      const expYear = parseInt('20' + yy, 10);
      if (!expMonth || expMonth < 1 || expMonth > 12 || !expYear) {
        throw {
          type: 'validation_error',
          code: 'expired_card',
          message: 'Please enter a valid expiry date',
        };
      }
      const paymentMethod: StripePaymentMethod = {
        id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'card',
        card: {
          brand: this.detectCardBrand(cardData.cardNumber),
          last4: cleanNumber.slice(-4),
          exp_month: expMonth,
          exp_year: expYear,
        },
        created: Math.floor(Date.now() / 1000),
      };

      // Simulate network delay for fallback
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return paymentMethod;
    } catch (error) {
      logger.error('[StripeService] Error creating payment method:', { error });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a PaymentIntent via the backend API
   * This is the production-ready implementation that calls your backend
   * 
   * NOTE: This method uses retries for reliability but is NOT idempotent.
   * If the backend doesn't use idempotency keys, retries could create duplicate
   * PaymentIntents. For critical payment flows, use createPaymentIntentSecure()
   * which includes built-in idempotency protection.
   */
  async createPaymentIntent(amount: number, currency: string = 'usd', authToken?: string): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_initiate', 'payment_process', {
      amount,
      currency,
    });

    try {
      await this.initialize();
      
      // Validate amount before sending to backend
      if (amount <= 0) {
        throw {
          type: 'validation_error',
          code: 'invalid_amount',
          message: 'Amount must be positive',
        };
      }
      
      const { clientSecret, paymentIntentId } = await invokePayments<{ clientSecret: string; paymentIntentId: string }>(
        'payments/create-payment-intent',
        {
          body: {
            amountCents: Math.round(amount * 100),
            currency,
            metadata: { purpose: 'wallet_deposit' },
          },
          ...(authToken ? { accessToken: authToken } : {}),
        }
      );
      
      const paymentIntent: StripePaymentIntent = {
        id: paymentIntentId,
        client_secret: clientSecret,
        amount: Math.round(amount * 100),
        currency,
        status: 'requires_payment_method',
      };

      // Track payment initiated
      await analyticsService.trackEvent('payment_initiated', {
        amount,
        currency,
        paymentIntentId: paymentIntent.id,
      });

      await performanceService.endMeasurement('payment_initiate', {
        success: true,
        amount,
      });

      return paymentIntent;
    } catch (error) {
      logger.error('[StripeService] Error creating payment intent:', { error });

      await analyticsService.trackEvent('payment_failed', {
        amount,
        currency,
        error: String(error),
        stage: 'initiate',
      });

      await performanceService.endMeasurement('payment_initiate', {
        success: false,
        error: String(error),
      });

      throw this.handleStripeError(error);
    }
  }

  /**
   * Confirm a payment using the Stripe SDK
   * Handles 3D Secure authentication when required
   * Notifies the backend after successful confirmation
   */
  async confirmPayment(paymentIntentClientSecret: string, paymentMethodId: string, authToken?: string): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_confirm', 'payment_process', {
      paymentMethodId,
    });

    try {
      await this.initialize();
      
      let paymentIntent: StripePaymentIntent;
      
      // Try to use the native Stripe SDK for confirmation (handles 3DS)
      if (this.stripeSDK?.confirmPayment) {
        const { paymentIntent: confirmedIntent, error } = await this.stripeSDK.confirmPayment(
          paymentIntentClientSecret,
          {
            paymentMethodType: 'Card',
            paymentMethodData: {
              paymentMethodId,
            },
          }
        );
        
        if (error) {
          // Handle specific error cases
          if (error.code === 'Canceled') {
            throw {
              type: 'card_error',
              code: 'canceled',
              message: 'Payment was cancelled',
            };
          }
          throw {
            type: error.type || 'card_error',
            code: error.code,
            decline_code: error.declineCode,
            message: error.message || 'Payment confirmation failed',
          };
        }
        
        if (confirmedIntent) {
          paymentIntent = {
            id: confirmedIntent.id,
            client_secret: paymentIntentClientSecret,
            amount: confirmedIntent.amount,
            currency: confirmedIntent.currency,
            status: this.mapPaymentIntentStatus(confirmedIntent.status),
          };
        } else {
          throw {
            type: 'api_error',
            code: 'unknown',
            message: 'Payment confirmation returned empty result',
          };
        }
      } else {
        // Fallback for non-native environments (development/testing)
        // In production, this should always use the native SDK
        paymentIntent = {
          id: paymentIntentClientSecret.split('_secret_')[0],
          client_secret: paymentIntentClientSecret,
          amount: 0,
          currency: 'usd',
          status: 'succeeded',
        };
        
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      
      // Handle requires_action status (3D Secure)
      if (paymentIntent.status === 'requires_action') {
        // The SDK should have already handled 3DS if native SDK is available
        // If we get here in fallback mode, we need to handle it manually
        if (!this.stripeSDK?.handleNextAction) {
          throw {
            type: 'card_error',
            code: 'authentication_required',
            message: 'Additional authentication required. Please try again in a supported browser.',
          };
        }
        
        const { paymentIntent: handledIntent, error } = await this.stripeSDK.handleNextAction(paymentIntentClientSecret);
        
        if (error) {
          throw {
            type: 'card_error',
            code: error.code || 'authentication_failed',
            message: error.message || 'Authentication failed',
          };
        }
        
        if (handledIntent) {
          paymentIntent = {
            id: handledIntent.id,
            client_secret: paymentIntentClientSecret,
            amount: handledIntent.amount,
            currency: handledIntent.currency,
            status: this.mapPaymentIntentStatus(handledIntent.status),
          };
        }
      }

      if (paymentIntent.status === 'succeeded') {
        // Notify backend about the successful payment confirmation
        // This ensures the backend is aware of 3DS authentication completion
        try {
          const paymentIntentId = paymentIntentClientSecret.split('_secret_')[0];
          await invokePayments('payments/confirm', {
            body: { paymentIntentId, paymentMethodId } as Record<string, unknown>,
          });
        } catch (backendError) {
          // Log but don't fail - the webhook will handle the actual balance update
          logger.error('[StripeService] Failed to notify backend of confirmation:', { error: backendError });
        }

        // Track payment completed
        await analyticsService.trackEvent('payment_completed', {
          paymentIntentId: paymentIntent.id,
          paymentMethodId,
          amount: paymentIntent.amount / 100,
          currency: paymentIntent.currency,
        });

        // Increment user property for payments
        await analyticsService.incrementUserProperty('payments_completed');
      }

      await performanceService.endMeasurement('payment_confirm', {
        success: paymentIntent.status === 'succeeded',
        paymentIntentId: paymentIntent.id,
        status: paymentIntent.status,
      });

      return paymentIntent;
    } catch (error) {
      logger.error('[StripeService] Error confirming payment:', { error });

      await analyticsService.trackEvent('payment_failed', {
        paymentMethodId,
        error: String(error),
        stage: 'confirm',
      });

      await performanceService.endMeasurement('payment_confirm', {
        success: false,
        error: String(error),
      });

      throw this.handleStripeError(error);
    }
  }

  /**
   * Map SDK payment intent status to our typed status
   */
  private mapPaymentIntentStatus(status: string): StripePaymentIntent['status'] {
    const statusMap: Record<string, StripePaymentIntent['status']> = {
      'RequiresPaymentMethod': 'requires_payment_method',
      'RequiresConfirmation': 'requires_confirmation',
      'RequiresAction': 'requires_action',
      'Processing': 'processing',
      'RequiresCapture': 'requires_capture',
      'Canceled': 'canceled',
      'Succeeded': 'succeeded',
      // Also handle lowercase versions
      'requires_payment_method': 'requires_payment_method',
      'requires_confirmation': 'requires_confirmation',
      'requires_action': 'requires_action',
      'processing': 'processing',
      'requires_capture': 'requires_capture',
      'canceled': 'canceled',
      'succeeded': 'succeeded',
    };
    return statusMap[status] || 'requires_payment_method';
  }

  /**
   * List saved payment methods for the current user
   * Fetches from the backend API which queries Stripe
   */
  async listPaymentMethods(authToken?: string): Promise<StripePaymentMethod[]> {
    try {
      await this.initialize();
      
      // If no auth token, return empty array
      if (!authToken) {
        return [];
      }

      // Helper to map raw API response rows to StripePaymentMethod objects
      const mapMethods = (fnData: { paymentMethods: unknown[] }): StripePaymentMethod[] =>
        (fnData?.paymentMethods || []).map((pm: unknown) => {
          const pmData = pm as Record<string, unknown>;
          const cardData = (pmData.card || {}) as Record<string, unknown>;
          return {
            id: (pmData.id as string) || '',
            type: 'card' as const,
            card: {
              brand: (cardData.brand || pmData.card_brand || 'unknown') as string,
              last4: (cardData.last4 || pmData.card_last4 || '****') as string,
              exp_month: (cardData.exp_month || pmData.card_exp_month || 0) as number,
              exp_year: (cardData.exp_year || pmData.card_exp_year || 0) as number,
            },
            created: (pmData.created as number) || Math.floor(Date.now() / 1000),
          };
        });

      // First attempt: use the React-state token directly (fast path — avoids
      // supabase-js getSession() lock contention described in invokePayments).
      let fnData: { paymentMethods: unknown[] };
      try {
        fnData = await invokePayments<{ paymentMethods: unknown[] }>(
          'payments/methods',
          { method: 'GET', accessToken: authToken }
        );
      } catch (firstErr: unknown) {
        const fe = firstErr as Record<string, unknown>;
        const is401 = fe?.type === 'api_error' && String(fe?.code) === '401';
        if (!is401) throw firstErr;

        // 401: the React-state token is stale (server-side expiry or clock-skew).
        // Use refreshSession() instead of getSession() — getSession() can return
        // the same stale cached token from the supabase-js internal session lock,
        // while refreshSession() makes a real server call and returns the fresh
        // token directly in the result.
        logger.warning('[StripeService] 401 on payment methods — retrying with fresh session token.', {});
        let freshToken: string | undefined;
        try {
          const refreshResult = await Promise.race([
            supabase.auth.refreshSession() as Promise<{ data: { session: { access_token: string } | null }; error: unknown }>,
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('refreshSession timeout')), 5000)
            ),
          ]);
          freshToken = refreshResult.data?.session?.access_token;
        } catch {
          // refreshSession() timed out or errored — propagate the original 401
          throw firstErr;
        }

        if (!freshToken) {
          // No session after refresh — propagate the 401
          throw firstErr;
        }

        // Retry with the fresh token.  If this also fails, the outer catch handles it.
        fnData = await invokePayments<{ paymentMethods: unknown[] }>(
          'payments/methods',
          { method: 'GET', accessToken: freshToken }
        );
      }

      return mapMethods(fnData);
    } catch (error) {
      // Any 401 that survived the internal retry above is a persistent auth
      // failure (session revoked, wrong project, etc.).  Log at warning level
      // so the StripeContext catch-handler can decide how to surface it.
      const _err = error as Record<string, unknown> | null;
      const _is401AuthError =
        _err && _err.type === 'api_error' && String(_err.code) === '401';
      if (_is401AuthError) {
        logger.warning('[StripeService] 401 on payment methods (after retry) — trying direct DB fallback.', { error });
      } else {
        logger.error('[StripeService] Error fetching payment methods via Edge Function:', { error });
      }

      // ── Direct DB fallback ───────────────────────────────────────────────
      // When the Edge Function call fails (e.g. 401 "Invalid JWT" from the
      // Supabase gateway, cold-start timeout, or network issue), try querying
      // the payment_methods table directly via PostgREST.  The Supabase JS
      // client manages its own auth token internally (via refreshSession),
      // which may succeed even when the React-state token passed to the Edge
      // Function was stale.  The payment_methods table has RLS policies that
      // allow users to SELECT their own rows (auth.uid() = user_id).
      try {
        interface PaymentMethodRow {
          stripe_payment_method_id: string | null;
          type: string | null;
          card_brand: string | null;
          card_last4: string | null;
          card_exp_month: number | null;
          card_exp_year: number | null;
          created_at: string | null;
        }
        const { data: dbMethods, error: dbError } = await supabase
          .from('payment_methods')
          .select('stripe_payment_method_id, type, card_brand, card_last4, card_exp_month, card_exp_year, created_at')
          .order('created_at', { ascending: false });

        if (!dbError && dbMethods && dbMethods.length > 0) {
          logger.info('[StripeService] Direct DB fallback returned payment methods.', { count: dbMethods.length });
          return (dbMethods as PaymentMethodRow[]).map((pm) => ({
            id: pm.stripe_payment_method_id ?? '',
            type: 'card' as const,
            card: {
              brand: pm.card_brand ?? 'unknown',
              last4: pm.card_last4 ?? '****',
              exp_month: pm.card_exp_month ?? 0,
              exp_year: pm.card_exp_year ?? 0,
            },
            created: pm.created_at
              ? Math.floor(new Date(pm.created_at).getTime() / 1000)
              : Math.floor(Date.now() / 1000),
          }));
        }
        // DB returned no rows — fall through to throw the original error
        if (dbError) {
          logger.warning('[StripeService] Direct DB fallback also failed.', { dbError });
        }
      } catch (dbFallbackErr) {
        logger.warning('[StripeService] Direct DB fallback threw.', { error: dbFallbackErr });
      }

      // Use proper typing for enhanced error with dynamic properties
      type EnhancedError = Error & Record<string, unknown> & { cause?: unknown };

      // For structured API errors (e.g. 4xx/5xx from Edge Function), preserve the
      // original message so callers see the actual status code rather than a generic
      // "Connection failed" string produced by getNetworkErrorMessage.
      const isStructuredApiError = error && typeof error === 'object' && !Array.isArray(error) &&
        (error as Record<string, unknown>).type === 'api_error' &&
        (error as Record<string, unknown>).code;

      let enhancedError: EnhancedError;
      if (isStructuredApiError) {
        // Keep the original message; only wrap in an Error if needed
        const originalError = error as Record<string, unknown>;
        enhancedError = (error instanceof Error ? error : new Error(String(originalError.message))) as EnhancedError;
        // Copy structured fields so handleStripeError can read type/code
        for (const [key, value] of Object.entries(originalError)) {
          if (!(key in enhancedError)) {
            enhancedError[key] = value;
          }
        }
      } else {
        // For network-level errors, enhance with a user-friendly message
        const errorMessage = getNetworkErrorMessage(error);
        enhancedError = error instanceof Error
          ? error as EnhancedError
          : new Error(errorMessage) as EnhancedError;
        if (errorMessage && enhancedError.message !== errorMessage) {
          enhancedError.message = errorMessage;
        }
        // Preserve structured fields (type, code) from non-Error throws for handleStripeError
        if (error && typeof error === 'object' && !(error instanceof Error)) {
          const originalError = error as Record<string, unknown>;
          for (const [key, value] of Object.entries(originalError)) {
            if (key !== 'message' && key !== 'name' && key !== 'stack' && !(key in enhancedError)) {
              enhancedError[key] = value;
            }
          }
        }
      }

      if (!enhancedError.name) {
        enhancedError.name = error instanceof Error ? error.name : 'Error';
      }
      
      // Preserve original error for debugging
      if (!enhancedError.cause) {
        enhancedError.cause = error;
      }
      
      // Rethrow a handled error so upstream callers (context/services) can
      // present a clear error message to the user instead of silently
      // treating an error as "no payment methods".
      throw this.handleStripeError(enhancedError);
    }
  }

  /**
   * Detach (remove) a payment method
   */
  async detachPaymentMethod(paymentMethodId: string, authToken?: string): Promise<void> {
    try {
      await this.initialize();
      
      if (!authToken) {
        throw new Error('Authentication required to remove payment method');
      }

      await invokePayments(`payments/methods/${paymentMethodId}`, { method: 'DELETE', accessToken: authToken });
    } catch (error) {
      logger.error('[StripeService] Error detaching payment method:', { error });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Attach (save) an existing payment method to the current user's Stripe customer
   * Calls POST /payments/methods on the backend to persist the payment method.
   */
  async attachPaymentMethod(paymentMethodId: string, authToken?: string): Promise<StripePaymentMethod> {
    try {
      await this.initialize();

      if (!authToken) {
        throw new Error('Authentication required to save payment method');
      }

      let rawJson: Record<string, unknown> | null = null;
      try {
        rawJson = await invokePayments<Record<string, unknown>>('payments/methods', {
          body: { paymentMethodId } as Record<string, unknown>,
          ...(authToken ? { accessToken: authToken } : {}),
        });
      } catch (parseErr: unknown) {
        // Log unexpected (unstructured) errors before re-throwing so we preserve
        // the original cause in production logs instead of masking it with the
        // generic "invalid response format" error that follows this block.
        if (!parseErr || typeof parseErr !== 'object' || !('type' in (parseErr as object))) {
          logger.error('[StripeService] Failed to invoke attachPaymentMethod (network or unexpected error):', { error: parseErr });
        }
        // Always re-throw — structured API/auth errors AND raw network errors must
        // propagate to the outer catch so callers receive the real failure reason.
        throw parseErr;
      }
      if (!rawJson || typeof rawJson !== 'object') {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Payment method save failed: invalid response format from server',
        };
      }

      const pmValue = rawJson.paymentMethod;
      if (!pmValue || typeof pmValue !== 'object') {
        throw {
          type: 'api_error',
          code: 'invalid_response',
          message: 'Payment method save failed: missing payment method in server response',
        };
      }

      const pm = pmValue as Record<string, unknown>;
      const rawCard = pm.card;
      const cardData = (rawCard && typeof rawCard === 'object' ? rawCard : {}) as Record<string, unknown>;
      return {
        id: (typeof pm.id === 'string' ? pm.id : '') || '',
        type: 'card' as const,
        card: {
          brand: (typeof cardData.brand === 'string' ? cardData.brand : 'unknown'),
          last4: (typeof cardData.last4 === 'string' ? cardData.last4 : '****'),
          exp_month: (typeof cardData.exp_month === 'number' ? cardData.exp_month : 0),
          exp_year: (typeof cardData.exp_year === 'number' ? cardData.exp_year : 0),
        },
        created: (typeof pm.created === 'number' ? pm.created : Math.floor(Date.now() / 1000)),
      };
    } catch (error) {
      logger.error('[StripeService] Error attaching payment method:', { error });

      // Use proper typing for enhanced error with known Stripe error fields
      type EnhancedError = Error & { type?: string; code?: string; cause?: unknown };

      // For structured API errors (e.g. 4xx/5xx from Edge Function), preserve the
      // original message so the status code surfaces to the caller.
      const isStructuredApiError = error && typeof error === 'object' && !Array.isArray(error) &&
        (error as Record<string, unknown>).type === 'api_error' &&
        (error as Record<string, unknown>).code;

      let enhancedError: EnhancedError;
      if (isStructuredApiError) {
        const originalError = error as Record<string, string | undefined>;
        enhancedError = (error instanceof Error ? error : new Error(String(originalError.message))) as EnhancedError;
        if (!enhancedError.type) enhancedError.type = originalError.type;
        if (!enhancedError.code) enhancedError.code = originalError.code;
      } else {
        const errorMessage = getNetworkErrorMessage(error);
        enhancedError = error instanceof Error
          ? error as EnhancedError
          : new Error(errorMessage) as EnhancedError;
        if (errorMessage && enhancedError.message !== errorMessage) {
          enhancedError.message = errorMessage;
        }
      }

      if (!enhancedError.name) {
        enhancedError.name = error instanceof Error ? error.name : 'Error';
      }
      if (!enhancedError.cause) {
        enhancedError.cause = error;
      }

      throw this.handleStripeError(enhancedError);
    }
  }

  /**
   * Present the Stripe Payment Sheet for a streamlined checkout experience
   * This is the recommended approach for production
   */
  async presentPaymentSheet(clientSecret: string): Promise<{
    success: boolean;
    error?: StripeError;
  }> {
    try {
      await this.initialize();
      
      if (!this.stripeSDK?.initPaymentSheet || !this.stripeSDK?.presentPaymentSheet) {
        // Fallback for non-native environments
        return {
          success: false,
          error: {
            type: 'api_error',
            code: 'not_supported',
            message: 'Payment sheet is not available. Please use the card form.',
          },
        };
      }

      // Initialize the payment sheet
      const { DEEP_LINK_SCHEME } = await import('../config/app');
      const { error: initError } = await this.stripeSDK.initPaymentSheet({
        paymentIntentClientSecret: clientSecret,
        merchantDisplayName: 'BountyExpo',
        style: 'automatic',
        googlePay: {
          merchantCountryCode: 'US',
          testEnv: !this.publishableKey.startsWith('pk_live'),
        },
        applePay: {
          merchantCountryCode: 'US',
        },
        defaultBillingDetails: {},
        returnURL: `${DEEP_LINK_SCHEME}://payment-complete`,
      });

      if (initError) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: initError.code,
            message: initError.message,
          },
        };
      }

      // Present the payment sheet
      const { error: presentError } = await this.stripeSDK.presentPaymentSheet();

      if (presentError) {
        // User cancelled is a special case
        if (presentError.code === 'Canceled') {
          return {
            success: false,
            error: {
              type: 'card_error',
              code: 'canceled',
              message: 'Payment was cancelled',
            },
          };
        }
        
        return {
          success: false,
          error: {
            type: presentError.type || 'card_error',
            code: presentError.code,
            message: presentError.message,
          },
        };
      }

      return { success: true };
    } catch (error) {
      logger.error('[StripeService] Error presenting payment sheet:', { error });
      return {
        success: false,
        error: this.handleStripeError(error) as StripeError,
      };
    }
  }

  /**
   * Create a Stripe Connect Account (server-side via backend API)
   * SECURITY: Never use secret keys in the client. This calls your backend,
   * which should use the Stripe SDK with STRIPE_SECRET_KEY to create accounts.
   */
  async createConnectAccount(
    userId: string,
    email: string,
    authToken?: string
  ): Promise<StripeConnectAccountResponse> {
    performanceService.startMeasurement('connect_account_create', 'payment_process', {
      userId,
    });

    try {
      await this.initialize();

      if (!userId || !email) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'userId and email are required' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/create-connect-account`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ userId, email }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('connect_account_create', {
          success: false,
          status: response.status,
        });
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to create Connect account' };
      }

      const data = (await response.json()) as Partial<StripeConnectAccountResponse> & { account?: { id?: string } };
      const accountId = data.accountId || data?.account?.id;

      if (!accountId) {
        throw { type: 'api_error', code: 'invalid_response', message: 'Missing accountId in response' };
      }

      await performanceService.endMeasurement('connect_account_create', { success: true, accountId });

      return { accountId };
    } catch (error) {
      logger.error('[StripeService] Error creating connect account:', { error });

      await performanceService.endMeasurement('connect_account_create', {
        success: false,
        error: String(error),
      });

      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a Stripe Connect onboarding Account Link (server-side via backend API)
   */
  async createConnectAccountLink(
    accountId: string,
    authToken?: string
  ): Promise<string> {
    performanceService.startMeasurement('connect_account_link', 'payment_process', { accountId });

    try {
      await this.initialize();

      if (!accountId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'accountId is required' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/create-account-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ accountId }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('connect_account_link', {
          success: false,
          status: response.status,
        });
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to create account link' };
      }

      const data = (await response.json()) as StripeConnectAccountLinkResponse & { accountLink?: { url?: string } };
      const url = data.url || data?.accountLink?.url;

      if (!url) {
        throw { type: 'api_error', code: 'invalid_response', message: 'Missing url in response' };
      }

      await performanceService.endMeasurement('connect_account_link', { success: true });

      return url;
    } catch (error) {
      logger.error('[StripeService] Error creating connect account link:', { error });

      await performanceService.endMeasurement('connect_account_link', {
        success: false,
        error: String(error),
      });

      throw this.handleStripeError(error);
    }
  }

  /**
   * Create an escrow PaymentIntent on the backend with manual capture and record the escrow
   * Returns the escrowId plus PaymentIntent identifiers and client secret for confirmation
   */
  async createEscrow(
    params: {
      bountyId: string;
      amount: number; // dollars
      posterId: string;
      hunterId: string;
      currency?: string;
    },
    authToken?: string
  ): Promise<StripeEscrowCreateResponse> {
    const { bountyId, amount, posterId, hunterId, currency = 'usd' } = params;

    performanceService.startMeasurement('escrow_create', 'payment_process', {
      bountyId,
      amount,
    });

    try {
      await this.initialize();

      if (!bountyId || !posterId || !hunterId || !amount || amount <= 0) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'Invalid escrow parameters' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/escrows`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          bountyId,
          amountCents: Math.round(amount * 100),
          posterId,
          hunterId,
          currency,
        }),
      });

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_create', { success: false, status: response.status });
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to create escrow' };
      }

      const data = (await response.json()) as Partial<StripeEscrowCreateResponse> & {
        escrow?: { id?: string };
        clientSecret?: string;
      };

      const escrowId = data.escrowId || data.escrow?.id;

      // Prefer explicit string values; avoid casting undefined to string.
      const paymentIntentClientSecret: string | undefined =
        (typeof data.paymentIntentClientSecret === 'string' && data.paymentIntentClientSecret.trim() !== '')
          ? data.paymentIntentClientSecret
          : (typeof data.clientSecret === 'string' && data.clientSecret.trim() !== '')
            ? data.clientSecret
            : undefined;

      const paymentIntentId = data.paymentIntentId || (paymentIntentClientSecret ? paymentIntentClientSecret.split('_secret_')[0] : undefined);
      const status = (data.status as StripePaymentIntent['status']) || 'requires_payment_method';

      if (!escrowId || !paymentIntentClientSecret || !paymentIntentId) {
        throw { type: 'api_error', code: 'invalid_response', message: 'Missing escrowId or client secret' };
      }

      await performanceService.endMeasurement('escrow_create', {
        success: true,
        escrowId,
        paymentIntentId,
      });

      return { escrowId, paymentIntentClientSecret, paymentIntentId, status };
    } catch (error) {
      logger.error('[StripeService] Error creating escrow:', { error });
      await performanceService.endMeasurement('escrow_create', { success: false, error: String(error) });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Release an escrow by capturing the PaymentIntent and transferring to hunter
   */
  async releaseEscrow(
    escrowId: string,
    authToken?: string
  ): Promise<StripeEscrowReleaseResponse> {
    performanceService.startMeasurement('escrow_release', 'payment_process', { escrowId });

    try {
      await this.initialize();

      if (!escrowId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'escrowId is required' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/escrows/${encodeURIComponent(escrowId)}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_release', { success: false, status: response.status });
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to release escrow' };
      }

      const data = (await response.json()) as StripeEscrowReleaseResponse & { transfer?: { id?: string }, paymentIntent?: { id?: string } };

      const transferId = data.transferId || data.transfer?.id;
      const paymentIntentId = data.paymentIntentId || data.paymentIntent?.id;

      await performanceService.endMeasurement('escrow_release', { success: true, transferId, paymentIntentId });

      return { transferId, paymentIntentId, status: data.status };
    } catch (error) {
      logger.error('[StripeService] Error releasing escrow:', { error });
      await performanceService.endMeasurement('escrow_release', { success: false, error: String(error) });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Refund an escrow: server cancels/refunds the PaymentIntent, returning funds to poster
   */
  async refundEscrow(
    escrowId: string,
    authToken?: string
  ): Promise<StripeEscrowRefundResponse> {
    performanceService.startMeasurement('escrow_refund', 'payment_process', { escrowId });

    try {
      await this.initialize();

      if (!escrowId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'escrowId is required' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/escrows/${encodeURIComponent(escrowId)}/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      if (!response.ok) {
        await performanceService.endMeasurement('escrow_refund', { success: false, status: response.status });
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to refund escrow' };
      }

      const data = (await response.json()) as StripeEscrowRefundResponse & { paymentIntent?: { id?: string } };

      const paymentIntentId = data.paymentIntentId || data.paymentIntent?.id;

      await performanceService.endMeasurement('escrow_refund', { success: true, paymentIntentId });

      return { paymentIntentId, refundAmount: data.refundAmount, status: data.status };
    } catch (error) {
      logger.error('[StripeService] Error refunding escrow:', { error });
      await performanceService.endMeasurement('escrow_refund', { success: false, error: String(error) });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Handle 3D Secure / next actions for a PaymentIntent client secret using the native SDK.
   * Returns the updated PaymentIntent status when available.
   */
  async handleNextAction(
    clientSecret: string
  ): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_next_action', 'payment_process', {});

    try {
      await this.initialize();

      if (!clientSecret) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'clientSecret is required' };
      }

      if (!this.stripeSDK?.handleNextAction) {
        // Fallback: assume succeeded for dev environments
        const fallback: StripePaymentIntent = {
          id: clientSecret.split('_secret_')[0],
          client_secret: clientSecret,
          amount: 0,
          currency: 'usd',
          status: 'succeeded',
        };
        await performanceService.endMeasurement('payment_next_action', { success: true, status: fallback.status });
        return fallback;
      }

      const { paymentIntent, error } = await this.stripeSDK.handleNextAction(clientSecret);

      if (error) {
        await performanceService.endMeasurement('payment_next_action', { success: false, error: String(error) });
        throw this.handleStripeError(error);
      }

      if (paymentIntent) {
        const mapped: StripePaymentIntent = {
          id: paymentIntent.id,
          client_secret: clientSecret,
          amount: paymentIntent.amount ?? 0,
          currency: paymentIntent.currency ?? 'usd',
          status: this.mapPaymentIntentStatus(paymentIntent.status),
        };
        await performanceService.endMeasurement('payment_next_action', { success: true, status: mapped.status });
        return mapped;
      }

      // No intent returned
      await performanceService.endMeasurement('payment_next_action', { success: false });
      throw { type: 'api_error', message: 'No payment intent returned from handleNextAction' };
    } catch (error) {
      logger.error('[StripeService] Error handling next action:', { error });
      await performanceService.endMeasurement('payment_next_action', { success: false, error: String(error) });
      throw this.handleStripeError(error);
    }
  }

  /**
   * Verify a Stripe Connect account status via backend (details_submitted/capabilities)
   */
  async verifyConnectAccount(
    accountId: string,
    authToken?: string
  ): Promise<StripeConnectVerificationResponse> {
    try {
      await this.initialize();

      if (!accountId) {
        throw { type: 'validation_error', code: 'invalid_params', message: 'accountId is required' };
      }

      const response = await fetch(`${API_BASE_URL}/payments/connect/accounts/${encodeURIComponent(accountId)}/verify`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });

      if (!response.ok) {
        throw { type: 'api_error', code: response.status.toString(), message: 'Failed to verify account' };
      }

      const data = (await response.json()) as StripeConnectVerificationResponse & { account?: { details_submitted?: boolean; capabilities?: any } };
      const detailsSubmitted = data.detailsSubmitted ?? data.account?.details_submitted ?? false;
      const capabilities = data.capabilities ?? data.account?.capabilities ?? {};
      return { detailsSubmitted, capabilities };
    } catch (error) {
      logger.error('[StripeService] Error verifying connect account:', { error });
      throw this.handleStripeError(error);
    }
  }

  private detectCardBrand(cardNumber: string): string {
    const cleanNumber = cardNumber.replace(/\s/g, '');
    
    if (cleanNumber.startsWith('4')) return 'visa';
    if (cleanNumber.startsWith('5') || cleanNumber.startsWith('2')) return 'mastercard';
    if (cleanNumber.startsWith('3')) return 'amex';
    if (cleanNumber.startsWith('6')) return 'discover';
    
    return 'unknown';
  }

  private handleStripeError(error: any): Error & { type?: string; code?: string; decline_code?: string } {
    // If already a proper error object with Stripe properties, preserve them
    if (error?.type) {
      const stripeError = new Error(error.message || 'Payment error occurred') as Error & { 
        type?: string; 
        code?: string; 
        decline_code?: string 
      };
      stripeError.type = error.type;
      // For card errors, decline_code is more specific than code
      // Prefer decline_code when available for better error messaging
      stripeError.code = error.decline_code || error.code;
      stripeError.decline_code = error.decline_code;
      return stripeError;
    }

    // Map specific error types to user-friendly messages
    if (error?.type === 'card_error' || error?.decline_code) {
      // For card errors, decline_code is more specific
      const declineCode = error.decline_code || error.code;
      const declineMessages: Record<string, string> = {
        'insufficient_funds': 'Your card has insufficient funds.',
        'card_declined': 'Your card was declined.',
        'expired_card': 'Your card has expired.',
        'incorrect_cvc': 'The CVC code is incorrect.',
        'processing_error': 'An error occurred while processing your card.',
        'incorrect_number': 'The card number is incorrect.',
        'authentication_required': 'Authentication is required. Please try again.',
        'card_not_supported': 'This card type is not supported.',
        'currency_not_supported': 'This currency is not supported by your card.',
        'duplicate_transaction': 'A duplicate transaction was detected.',
        'fraudulent': 'This transaction has been flagged as potentially fraudulent.',
        'generic_decline': 'Your card was declined. Please contact your bank.',
        'lost_card': 'This card has been reported lost.',
        'stolen_card': 'This card has been reported stolen.',
        'do_not_honor': 'Your bank declined this transaction. Please contact your bank.',
      };
      
      const message = declineMessages[declineCode] || error.message || 'Your card was declined.';
      const stripeError = new Error(message) as Error & { type?: string; code?: string; decline_code?: string };
      stripeError.type = 'card_error';
      stripeError.code = declineCode;
      stripeError.decline_code = declineCode;
      return stripeError;
    }

    if (error?.type === 'validation_error' || error?.type === 'StripeValidationError') {
      const stripeError = new Error('Invalid payment information provided') as Error & { type?: string };
      stripeError.type = 'validation_error';
      return stripeError;
    }

    if (error?.type === 'api_error' || error?.type === 'StripeAPIError') {
      // Preserve the original message when it contains specific API error details
      // (e.g. "Payment methods request failed (405): Method not allowed") so callers
      // can surface a meaningful message rather than a generic fallback.
      const defaultMessage = 'Payment service temporarily unavailable. Please try again.';
      const message = error.message && error.message !== defaultMessage
        ? error.message
        : defaultMessage;
      const stripeError = new Error(message) as Error & { type?: string; code?: string };
      stripeError.type = 'api_error';
      stripeError.code = error.code;
      return stripeError;
    }

    if (error?.type === 'rate_limit_error') {
      const stripeError = new Error('Too many requests. Please wait a moment and try again.') as Error & { type?: string };
      stripeError.type = 'rate_limit_error';
      return stripeError;
    }

    if (error?.type === 'authentication_error') {
      const stripeError = new Error('Payment authentication failed. Please contact support.') as Error & { type?: string };
      stripeError.type = 'authentication_error';
      return stripeError;
    }

    // Handle network errors
    if (error?.message?.includes('network') || error?.message?.includes('fetch')) {
      const stripeError = new Error('Unable to connect to payment service. Check your connection and try again.') as Error & { type?: string };
      stripeError.type = 'network_error';
      return stripeError;
    }

    // Default error
    return new Error(error?.message || 'Payment processing failed. Please try again.');
  }

  // Utility method to format card display
  formatCardDisplay(paymentMethod: StripePaymentMethod): string {
    const brand = paymentMethod.card.brand.toUpperCase();
    const last4 = paymentMethod.card.last4;
    return `${brand} •••• •••• •••• ${last4}`;
  }

  // Utility method to validate card number (basic Luhn algorithm)
  validateCardNumber(cardNumber: string): boolean {
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
   * Create a SetupIntent for saving a payment method without charging
   * This is the recommended approach for PCI compliance when saving cards
   */
  async createSetupIntent(authToken?: string): Promise<StripeSetupIntent> {
    performanceService.startMeasurement('setup_intent_create', 'payment_process', {});

    try {
      await this.initialize();

      const { clientSecret, setupIntentId } = await invokePayments<{ clientSecret: string; setupIntentId: string }>(
        'payments/create-setup-intent',
        {
          body: { usage: 'off_session' } as Record<string, unknown>,
          ...(authToken ? { accessToken: authToken } : {}),
        }
      );

      const setupIntent: StripeSetupIntent = {
        id: setupIntentId,
        client_secret: clientSecret,
        status: 'requires_payment_method',
      };

      await analyticsService.trackEvent('setup_intent_created', {
        setupIntentId: setupIntent.id,
      });

      await performanceService.endMeasurement('setup_intent_create', {
        success: true,
      });

      return setupIntent;
    } catch (error) {
      logger.error('[StripeService] Error creating setup intent:', { error });

      await analyticsService.trackEvent('setup_intent_failed', {
        error: String(error),
      });

      await performanceService.endMeasurement('setup_intent_create', {
        success: false,
        error: String(error),
      });

      throw this.handleStripeError(error);
    }
  }

  /**
   * Confirm a SetupIntent using the Payment Sheet
   * This saves the payment method for future use
   */
  async confirmSetupIntent(clientSecret: string): Promise<{
    success: boolean;
    paymentMethodId?: string;
    error?: StripeError;
  }> {
    try {
      await this.initialize();

      if (!this.stripeSDK?.initPaymentSheet || !this.stripeSDK?.presentPaymentSheet) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: 'not_supported',
            message: 'Payment setup is not available. Please use the card form.',
          },
        };
      }

      // Initialize payment sheet for setup
      const { DEEP_LINK_SCHEME } = await import('../config/app');
      const { error: initError } = await this.stripeSDK.initPaymentSheet({
        setupIntentClientSecret: clientSecret,
        merchantDisplayName: 'BountyExpo',
        style: 'automatic',
        applePay: {
          merchantCountryCode: 'US',
        },
        googlePay: {
          merchantCountryCode: 'US',
          testEnv: !this.publishableKey.startsWith('pk_live'),
        },
        returnURL: `${DEEP_LINK_SCHEME}://setup-complete`,
      });

      if (initError) {
        return {
          success: false,
          error: {
            type: 'api_error',
            code: initError.code,
            message: initError.message,
          },
        };
      }

      // Present the payment sheet
      const { error: presentError } = await this.stripeSDK.presentPaymentSheet();

      if (presentError) {
        if (presentError.code === 'Canceled') {
          return {
            success: false,
            error: {
              type: 'card_error',
              code: 'canceled',
              message: 'Setup was cancelled',
            },
          };
        }

        return {
          success: false,
          error: {
            type: presentError.type || 'card_error',
            code: presentError.code,
            message: presentError.message,
          },
        };
      }

      // Extract setup intent ID from client secret to get payment method
      const setupIntentId = clientSecret.split('_secret_')[0];
      
      await analyticsService.trackEvent('setup_intent_confirmed', {
        setupIntentId,
      });

      return { success: true };
    } catch (error) {
      logger.error('[StripeService] Error confirming setup intent:', { error });
      return {
        success: false,
        error: this.handleStripeError(error) as StripeError,
      };
    }
  }

  /**
   * Create a payment intent with idempotency and duplicate protection
   * This is the secure way to create payments
   */
  async createPaymentIntentSecure(
    amount: number,
    currency: string = 'usd',
    authToken?: string,
    options?: {
      userId?: string;
      purpose?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<StripePaymentIntent> {
    const { userId = 'anonymous', purpose = 'payment' } = options || {};

    // Generate idempotency key for duplicate protection
    const idempotencyKey = generateIdempotencyKey(userId, amount, purpose);

    // Check for duplicate submission
    if (checkDuplicatePayment(idempotencyKey)) {
      const duplicateError = {
        type: 'idempotency_error',
        code: 'duplicate_transaction',
        message: 'This payment is already being processed. Please wait.',
      };
      throw duplicateError;
    }

    // Record the payment attempt
    recordPaymentAttempt(idempotencyKey);

    try {
      // Use retry wrapper for transient errors
      const result = await withPaymentRetry(
        async () => {
          return await this.createPaymentIntent(amount, currency, authToken);
        },
        {
          maxRetries: 3,
          baseDelayMs: 1000,
          maxDelayMs: 5000,
        }
      );

      // Payment successful, complete the attempt tracking
      completePaymentAttempt(idempotencyKey);
      
      return result;
    } catch (error) {
      // Parse and log the error
      const paymentError = parsePaymentError(error);
      await logPaymentError(paymentError, {
        amount,
        currency,
        userId,
        stage: 'initiate',
      });

      // Complete the attempt tracking (allows retry after error)
      completePaymentAttempt(idempotencyKey);

      throw error;
    }
  }

  /**
   * Confirm payment with enhanced error handling and logging
   */
  async confirmPaymentSecure(
    paymentIntentClientSecret: string,
    paymentMethodId: string,
    authToken?: string,
    options?: {
      userId?: string;
    }
  ): Promise<StripePaymentIntent> {
    const { userId } = options || {};

    try {
      const result = await withPaymentRetry(
        async () => {
          return await this.confirmPayment(paymentIntentClientSecret, paymentMethodId, authToken);
        },
        {
          maxRetries: 2, // Fewer retries for confirmation
          baseDelayMs: 2000,
          maxDelayMs: 5000,
        }
      );

      return result;
    } catch (error) {
      // Parse and log the error
      const paymentError = parsePaymentError(error);
      await logPaymentError(paymentError, {
        paymentIntentId: paymentIntentClientSecret.split('_secret_')[0],
        userId,
        stage: 'confirm',
      });

      throw error;
    }
  }

  /**
   * Check if Apple Pay is supported on this device
   * @returns Promise<boolean> indicating whether Apple Pay is available
   */
  async isApplePaySupported(): Promise<boolean> {
    try {
      // Apple Pay is only available on iOS
      const { Platform } = await import('react-native');
      if (Platform.OS !== 'ios') {
        return false;
      }

      await this.initialize();

      // Check if the SDK is available and has Apple Pay support
      if (!this.stripeSDK) {
        return false;
      }

      // Try to access isApplePaySupported from the SDK
      // The method might be at different locations depending on SDK version
      const isApplePaySupportedFn = 
        this.stripeSDK.isApplePaySupported || 
        this.stripeSDK.ApplePay?.isApplePaySupported;

      if (typeof isApplePaySupportedFn === 'function') {
        return await isApplePaySupportedFn();
      }

      return false;
    } catch (error) {
      logger.error('[StripeService] Error checking Apple Pay support:', { error });
      return false;
    }
  }

  /**
   * Present Apple Pay payment sheet
   * @param amount Amount in dollars (e.g., 10.50)
   * @param description Description for the payment (default: "Add Money to Wallet")
   * @param cartItems Optional custom cart items for Apple Pay sheet
   * @returns Promise with success status and error details
   */
  async presentApplePay(
    amount: number,
    description: string = 'Add Money to Wallet',
    cartItems?: { label: string; amount: string; type?: 'final' | 'pending' }[]
  ): Promise<{
    success: boolean;
    error?: string;
    errorCode?: string;
  }> {
    try {
      // Check platform first - Apple Pay is iOS only
      const { Platform } = await import('react-native');
      if (Platform.OS !== 'ios') {
        return {
          success: false,
          error: 'Apple Pay is only available on iOS',
          errorCode: 'platform_not_supported',
        };
      }

      // Validate amount - enforce Stripe's minimum charge amount
      if (amount < 0.5) {
        return {
          success: false,
          error: 'Amount must be at least $0.50',
          errorCode: 'invalid_amount',
        };
      }

      // If custom cartItems are provided, validate that their total matches the amount
      if (cartItems && cartItems.length > 0) {
        const totalFromCart = cartItems.reduce((sum, item) => {
          const itemAmount = Number(item.amount);
          return Number.isFinite(itemAmount) ? sum + itemAmount : sum;
        }, 0);

        const totalFromCartInCents = Math.round(totalFromCart * 100);
        const amountInCents = Math.round(amount * 100);

        if (
          Number.isFinite(totalFromCartInCents) &&
          Number.isFinite(amountInCents) &&
          totalFromCartInCents !== amountInCents
        ) {
          logger.warning('[StripeService] Apple Pay amount mismatch:', { amount, totalFromCart });
          return {
            success: false,
            error: 'Payment amount does not match cart total',
            errorCode: 'amount_mismatch',
          };
        }
      }

      await this.initialize();

      if (!this.stripeSDK) {
        return {
          success: false,
          error: 'Stripe SDK not available',
          errorCode: 'sdk_unavailable',
        };
      }

      // Get the presentApplePay function from SDK
      const presentApplePayFn = 
        this.stripeSDK.presentApplePay || 
        this.stripeSDK.ApplePay?.presentApplePay;

      if (typeof presentApplePayFn !== 'function') {
        return {
          success: false,
          error: 'Apple Pay not available in this SDK version',
          errorCode: 'apple_pay_unavailable',
        };
      }

      // Prepare cart items
      const items = cartItems || [
        {
          label: description,
          amount: amount.toFixed(2),
          type: 'final' as const,
        },
      ];

      // Present the Apple Pay sheet
      const { error: presentError } = await presentApplePayFn({
        cartItems: items,
        country: 'US',
        currency: 'USD',
        requiredShippingAddressFields: [],
        requiredBillingContactFields: ['postalAddress'],
      });

      if (presentError) {
        logger.error('[StripeService] Apple Pay presentation error:', { error: presentError });

        // Handle user cancellation separately
        const cancelCodes = ['Canceled', 'canceled', 'USER_CANCELLED', 'user_cancelled'];
        if (presentError.code && cancelCodes.includes(presentError.code)) {
          return {
            success: false,
            error: 'Payment cancelled by user',
            errorCode: 'cancelled',
          };
        }

        return {
          success: false,
          error: presentError.message || 'Failed to present Apple Pay',
          errorCode: presentError.code,
        };
      }

      // If we get here, the payment was presented successfully
      // Note: The actual payment confirmation should be handled separately
      // using confirmApplePayPayment with the client secret
      return {
        success: true,
      };
    } catch (error) {
      logger.error('[StripeService] Error presenting Apple Pay:', { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorCode: 'unknown_error',
      };
    }
  }

  /**
   * Get the native SDK instance for advanced use cases
   */
  getStripeSDK(): any {
    return this.stripeSDK;
  }

  /**
   * Check if the native SDK is available
   */
  isSDKAvailable(): boolean {
    return !!this.stripeSDK;
  }

  /**
   * Detect the mode of a Stripe key (test or live)
   * @param key Stripe publishable key (pk_test_... or pk_live_...) or secret key (sk_test_... or sk_live_...)
   * @returns 'test' | 'live' | 'unknown'
   */
  getKeyMode(key: string): 'test' | 'live' | 'unknown' {
    if (!key) return 'unknown';
    if (key.startsWith('pk_test_') || key.startsWith('sk_test_')) return 'test';
    if (key.startsWith('pk_live_') || key.startsWith('sk_live_')) return 'live';
    return 'unknown';
  }

  /**
   * Get the mode of the configured publishable key
   */
  getPublishableKeyMode(): 'test' | 'live' | 'unknown' {
    return this.getKeyMode(this.publishableKey);
  }

  /**
   * Parse a Stripe error to detect mode mismatch issues
   * @param error Error from Stripe API
   * @returns User-friendly error message if mode mismatch is detected, otherwise original message
   */
  parseStripeError(error: any): string {
    if (!error) return 'An unknown error occurred';
    
    const errorMessage = error.message || error.toString();
    
    // Handle network and timeout errors with user-friendly messages
    // Distinguish our own infra timeouts (TIMEOUT code) from a browser/OS-level
    // TimeoutError so we don't blame the user's connection when the real cause
    // is an Edge Function that isn't deployed or a paused Supabase project.
    if ((error as any)?.code === 'TIMEOUT' || (error as any)?.type === 'network_error' && errorMessage.includes('timed out')) {
      return 'Payment service is temporarily unavailable. Please try again later.';
    }

    if (error.name === 'TimeoutError' || errorMessage.includes('timed out') || errorMessage.includes('timeout')) {
      return 'Connection timed out. Please check your internet connection and try again.';
    }
    
    if (error.name === 'AbortError') {
      // Don't show the generic "Aborted" message
      return 'Connection interrupted. Please check your internet connection and try again.';
    }
    
    if (error.name === 'NetworkError' || errorMessage.includes('Network') || errorMessage.includes('fetch failed')) {
      return 'Unable to connect. Please check your internet connection.';
    }
    
    // Detect test/live mode mismatch
    if (errorMessage.includes('No such setupintent') || errorMessage.includes('No such paymentintent')) {
      if (errorMessage.includes('live mode') && errorMessage.includes('test mode key')) {
        return 'Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.';
      }
      if (errorMessage.includes('test mode') && errorMessage.includes('live mode key')) {
        return 'Payment configuration error: Your payment keys are in different modes. Please contact support or check your environment configuration.';
      }
    }
    
    // Return original message if no special case detected
    return errorMessage;
  }
}

// Export singleton instance
export const stripeService = new StripeService();