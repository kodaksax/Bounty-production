import Constants from 'expo-constants';
import { API_BASE_URL } from 'lib/config/api';
import { analyticsService } from 'lib/services/analytics-service';
import { stripeSdk } from 'lib/services/stripe-sdk';
import { supabase } from 'lib/supabase';
import { logger } from 'lib/utils/error-logger';
import { Platform } from 'react-native';

/** Non-sensitive diagnostic snapshot attached to Apple Pay telemetry — never includes keys/tokens. */
function getDiagnosticContext(): Record<string, string | number | boolean | undefined> {
  return {
    platform: Platform.OS,
    appVersion: Constants.nativeAppVersion || Constants.expoConfig?.version || 'unknown',
    bundleIdentifier: (Constants.expoConfig as any)?.ios?.bundleIdentifier || 'unknown',
    // Whether initStripe() itself ran without throwing — does not by itself
    // confirm Apple Pay is usable, only that the native module loaded.
    sdkAvailable: stripeSdk.isSDKAvailable(),
    sdkInitError: stripeSdk.getApplePayInitError() ?? undefined,
  };
}

export interface ApplePayPaymentRequest {
  amount: number; // in dollars
  description: string;
  bountyId?: string;
  attemptId?: string;
}

export interface ApplePayResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
  errorCode?: string;
}

/**
 * Window that collapses rapid re-taps of the same deposit into one Stripe
 * idempotency key. A confirm failure makes the user tap Pay again within
 * seconds (a duplicate $1.00 charge 17 seconds apart is the case that
 * motivated this), so the key must stay stable across that retry loop.
 * Kept short (60s) so legitimate back-to-back deposits are not blocked.
 */
const IDEMPOTENCY_WINDOW_MS = 60 * 1000;

/** PaymentIntent statuses that mean the charge will never complete. */
const TERMINAL_FAILURE_STATUSES = new Set(['requires_payment_method', 'canceled']);

/** Bounded status poll used after an indeterminate confirm error. */
const STATUS_POLL_MAX_ATTEMPTS = 4;
const STATUS_POLL_DELAY_MS = 1000;

class ApplePayService {
  /**
   * Check if Apple Pay is available on this device
   */
  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== 'ios') {
      return false;
    }

    try {
      // Imported lazily (not statically) so web bundles never pull in the native
      // module — metro/webpack alias this specifier to stripe-mock.web.js for
      // platform === 'web' only, so on iOS this is the real SDK.
      // Deliberately NOT typed as `any`: the previous version guessed at
      // `isApplePaySupported`, which this SDK does not export, and the `any`
      // hid that from the compiler until it failed at runtime.
      const { isPlatformPaySupported } = await import('@stripe/stripe-react-native');
      // initStripe() must have run with a merchantIdentifier before the native
      // layer will report Apple Pay as usable. StripeProvider does this at app
      // mount, but await it explicitly rather than depending on mount ordering —
      // initialize() is memoized, so this is a no-op once done. Every sibling
      // service (payment-methods, connect) follows the same convention.
      await stripeSdk.initialize();
      const supported = await isPlatformPaySupported();
      if (!supported) {
        // Device-capable-but-unsupported is expected on iPads/simulators; log
        // at warning (not error) so this doesn't page anyone, but keep it
        // visible for correlating against a spike in tap-time failures.
        logger.warning('[ApplePay] isPlatformPaySupported() returned false', getDiagnosticContext());
      }
      return supported;
    } catch (error) {
      logger.error('[ApplePay] Error checking Apple Pay availability', {
        error: error instanceof Error ? error.message : String(error),
        ...getDiagnosticContext(),
      });
      return false;
    }
  }

  /**
   * Build the Stripe idempotency key for a deposit attempt.
   *
   * The key is derived from the user, the amount, and either a client-supplied
   * attemptId or a short time bucket — NOT from Date.now(). A per-timestamp key
   * gave every tap a new key and therefore a brand-new PaymentIntent, so a
   * second tap after a confirm error created a second charge. With this key,
   * re-taps of the same deposit inside one attempt/window share a key, so Stripe
   * returns the first PaymentIntent instead of charging again.
   *
   * The user scope prevents two people on the same device (or a missing user
   * id) from ever sharing a key. Without a user id we fall back to a unique
   * per-call key: no dedup, but no cross-user collision either.
   */
  private generateIdempotencyKey(request: ApplePayPaymentRequest, userId?: string): string {
    const amountKey = Math.round(request.amount * 100);
    if (!userId) {
      return `apple_pay_${amountKey}_${Date.now()}`;
    }
    if (request.attemptId) {
      const safeAttemptId = request.attemptId.replace(/[^a-zA-Z0-9_-]/g, '');
      return `apple_pay_${userId}_${amountKey}_${safeAttemptId}`;
    }
    const bucket = Math.floor(Date.now() / IDEMPOTENCY_WINDOW_MS);
    return `apple_pay_${userId}_${amountKey}_${bucket}`;
  }

  /**
   * Ask the backend for the current PaymentIntent status. Returns true only
   * once the charge has succeeded, false while it is still pending, and the
   * terminal status so the caller can stop polling a dead intent.
   */
  private async fetchIntentStatus(
    paymentIntentId: string,
    token: string,
    bountyId?: string
  ): Promise<{ succeeded: boolean; status?: string }> {
    const response = await fetch(`${API_BASE_URL}/apple-pay/confirm`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ paymentIntentId, bountyId }),
    });

    if (!response.ok) {
      throw new Error('Failed to read payment status');
    }

    const result = await response.json();
    return { succeeded: result.success === true, status: result.status };
  }

  /**
   * Poll the intent status after an indeterminate confirm error. A non-cancel
   * error from the native confirm call does NOT prove the charge failed — the
   * PaymentIntent may already be `succeeded` (for example when the key was
   * reused and the first tap already went through). Returns true if the charge
   * completed, so the caller never reports a false failure that invites a
   * duplicate charge.
   */
  private async pollIntentSucceeded(
    paymentIntentId: string,
    token: string,
    bountyId?: string
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= STATUS_POLL_MAX_ATTEMPTS; attempt++) {
      try {
        const { succeeded, status } = await this.fetchIntentStatus(paymentIntentId, token, bountyId);
        if (succeeded) {
          return true;
        }
        if (status && TERMINAL_FAILURE_STATUSES.has(status)) {
          return false;
        }
      } catch (error) {
        console.warn(`[ApplePay] Status poll attempt ${attempt}/${STATUS_POLL_MAX_ATTEMPTS} failed:`, error);
      }

      if (attempt < STATUS_POLL_MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, STATUS_POLL_DELAY_MS * attempt));
      }
    }
    return false;
  }

  /**
   * Retry helper for network requests
   */
  private async retryRequest<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    delayMs: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.warn(`[ApplePay] Attempt ${attempt}/${maxRetries} failed:`, error);
        
        // Don't retry on certain errors
        if (error instanceof Error) {
          const errorMessage = error.message.toLowerCase();
          if (errorMessage.includes('unauthorized') || 
              errorMessage.includes('invalid') || 
              errorMessage.includes('cancelled')) {
            throw error;
          }
        }
        
        // Wait before retrying (exponential backoff)
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
        }
      }
    }
    
    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Process payment with Apple Pay
   */
  async processPayment(request: ApplePayPaymentRequest, authToken?: string): Promise<ApplePayResult> {
    try {
      await analyticsService.trackEvent('payment_initiated', {
        method: 'apple_pay',
        amount: request.amount,
        ...getDiagnosticContext(),
      });
    } catch {
      /* analytics is best-effort */
    }

    try {
      const { token, userId } = await getAuthContext(authToken);
      const idempotencyKey = this.generateIdempotencyKey(request, userId);

      // Step 1: Create PaymentIntent on backend (with retry)
      const { clientSecret, paymentIntentId } = await this.retryRequest(async () => {
        const endpoint = `${API_BASE_URL}/apple-pay/payment-intent`
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            amountCents: Math.round(request.amount * 100),
            bountyId: request.bountyId,
            description: request.description,
            idempotencyKey,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create payment intent');
        }

        return await response.json();
      }, 3, 1000);

      // Step 2: Present the Apple Pay sheet AND confirm the PaymentIntent.
      // This is a single native call: confirmPlatformPayPayment presents the
      // sheet and confirms on authorization. It replaces the legacy two-step
      // presentApplePay() -> confirmApplePayPayment() pair, which Stripe removed
      // from this SDK entirely (see docs/payments/APPLE_PAY_PRODUCTION_FAILURE_REPORT.md).
      const { confirmPlatformPayPayment, PlatformPay, PlatformPayError } = await import(
        '@stripe/stripe-react-native'
      );
      // Same reason as in isAvailable(): without a merchantIdentifier registered
      // via initStripe(), PassKit rejects the sheet at the native layer with no
      // JS-visible error. Idempotent.
      await stripeSdk.initialize();

      const { error: confirmError } = await confirmPlatformPayPayment(clientSecret, {
        applePay: {
          merchantCountryCode: 'US',
          currencyCode: 'USD',
          cartItems: [
            {
              paymentType: PlatformPay.PaymentType.Immediate,
              label: request.description,
              amount: request.amount.toFixed(2),
            },
          ],
          // Shipping fields are intentionally omitted: requesting PostalAddress
          // for shipping obliges us to implement PlatformPayButton's
          // onShippingContactSelected callback, and this is not a shipped good.
          requiredBillingContactFields: [PlatformPay.ContactField.PostalAddress],
        },
      });

      let paymentSucceeded: boolean;
      let failureMessage: string | undefined;
      let failureCode: string | undefined;

      if (confirmError) {
        // Dismissing the sheet is a normal user action, not a fault — return
        // before logging at error level or emitting a payment_failed event, so
        // cancellations don't inflate the failure rate. The SDK reports this as
        // a single canonical enum value, so no case-variant list is needed.
        if (confirmError.code === PlatformPayError.Canceled) {
          return {
            success: false,
            error: 'Payment cancelled by user',
            errorCode: 'cancelled',
          };
        }

        // A non-cancel confirm error is INDETERMINATE, not a failure. The
        // charge may already have gone through — for example the idempotency
        // key was reused and the PaymentIntent is already `succeeded`, which
        // makes the native confirm call reject. Reporting failure here is what
        // invited the re-tap that double-charged, so poll the intent status
        // before deciding.
        logger.warning('[ApplePay] Confirm returned an error; polling intent status before failing', {
          errorCode: confirmError.code,
          ...getDiagnosticContext(),
        });
        paymentSucceeded = await this.pollIntentSucceeded(paymentIntentId, token, request.bountyId);
        failureMessage = confirmError.message;
        failureCode = confirmError.code;
      } else {
        // Step 3: Verify payment on backend (with retry)
        const confirmResult = await this.retryRequest(async () => {
          const confirmEndpoint = `${API_BASE_URL}/apple-pay/confirm`
          const confirmResponse = await fetch(confirmEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
              paymentIntentId,
              bountyId: request.bountyId,
            }),
          });

          if (!confirmResponse.ok) {
            throw new Error('Failed to confirm payment on backend');
          }

          return await confirmResponse.json();
        }, 3, 1000);

        paymentSucceeded = confirmResult.success === true;
        failureMessage = confirmResult.error;
      }

      if (paymentSucceeded) {
        try {
          await analyticsService.trackEvent('payment_completed', {
            method: 'apple_pay',
            amount: request.amount,
            ...getDiagnosticContext(),
          });
        } catch {
          /* analytics is best-effort */
        }
        return {
          success: true,
          paymentIntentId,
        };
      } else {
        logger.error('[ApplePay] Payment did not complete', {
          errorCode: failureCode,
          ...getDiagnosticContext(),
        });
        try {
          await analyticsService.trackEvent('payment_failed', {
            method: 'apple_pay',
            stage: confirmError ? 'confirm' : 'backend_confirm',
            errorCode: failureCode,
            ...getDiagnosticContext(),
          });
        } catch {
          /* analytics is best-effort */
        }
        return {
          success: false,
          error: failureMessage || 'Payment confirmation failed',
          errorCode: failureCode,
        };
      }

    } catch (error) {
      logger.error('[ApplePay] Payment error', {
        error: error instanceof Error ? error.message : String(error),
        ...getDiagnosticContext(),
      });
      try {
        await analyticsService.trackEvent('payment_error', {
          method: 'apple_pay',
          stage: 'unhandled',
          ...getDiagnosticContext(),
        });
      } catch {
        /* analytics is best-effort */
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Export singleton
export const applePayService = new ApplePayService();

// Read the auth token and user id from the Supabase session. The user id scopes
// the idempotency key so a reused key can never map one user's tap onto another
// user's PaymentIntent. A caller-supplied token still wins for the token itself.
async function getAuthContext(authToken?: string): Promise<{ token: string; userId?: string }> {
  try {
    // supabase.auth.getSession() returns { data: { session } }
    const { data } = await supabase.auth.getSession();
    const session = (data as any)?.session ?? (data as any);
    return {
      token: authToken || session?.access_token || '',
      userId: session?.user?.id,
    };
  } catch (err) {
    console.error('[ApplePay] failed to read auth context from supabase storage', err);
    return { token: authToken || '' };
  }
}

// Note: API_BASE_URL is provided by lib/config/api