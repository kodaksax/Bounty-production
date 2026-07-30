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
}

export interface ApplePayResult {
  success: boolean;
  paymentIntentId?: string;
  error?: string;
  errorCode?: string;
}

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
   * Generate idempotency key for payment request
   */
  private generateIdempotencyKey(request: ApplePayPaymentRequest): string {
    const timestamp = Date.now();
    const amountKey = Math.round(request.amount * 100);
    return `apple_pay_${amountKey}_${timestamp}`;
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
      const idempotencyKey = this.generateIdempotencyKey(request);

      // Step 1: Create PaymentIntent on backend (with retry)
      const { clientSecret, paymentIntentId } = await this.retryRequest(async () => {
        const endpoint = `${API_BASE_URL}/apple-pay/payment-intent`
        const token = authToken || await getAuthToken()
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

        logger.error('[ApplePay] Confirmation error', { error: confirmError, ...getDiagnosticContext() });
        try {
          await analyticsService.trackEvent('payment_failed', {
            method: 'apple_pay',
            stage: 'confirm',
            errorCode: confirmError.code,
            ...getDiagnosticContext(),
          });
        } catch {
          /* analytics is best-effort */
        }
        return {
          success: false,
          error: confirmError.message,
          errorCode: confirmError.code,
        };
      }

      // Step 3: Verify payment on backend (with retry)
      const confirmResult = await this.retryRequest(async () => {
        const confirmEndpoint = `${API_BASE_URL}/apple-pay/confirm`
        const token = authToken || await getAuthToken()
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

      if (confirmResult.success) {
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
        try {
          await analyticsService.trackEvent('payment_failed', {
            method: 'apple_pay',
            stage: 'backend_confirm',
            ...getDiagnosticContext(),
          });
        } catch {
          /* analytics is best-effort */
        }
        return {
          success: false,
          error: confirmResult.error || 'Payment confirmation failed',
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

// Helper function to get auth token from Supabase session storage
async function getAuthToken(): Promise<string> {
  try {
    // supabase.auth.getSession() returns { data: { session } }
    const { data } = await supabase.auth.getSession();
    const session = (data as any)?.session ?? (data as any);
    return session?.access_token ?? '';
  } catch (err) {
    console.error('[ApplePay] failed to read auth token from supabase storage', err);
    return '';
  }
}

// Note: API_BASE_URL is provided by lib/config/api