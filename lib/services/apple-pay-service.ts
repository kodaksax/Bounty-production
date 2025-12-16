import { API_BASE_URL } from 'lib/config/api';
import { supabase } from 'lib/supabase';
import { Platform } from 'react-native';

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
      // Dynamically import Apple Pay helpers from the Stripe native SDK at runtime.
      // Some versions of the SDK don't expose these symbols in types, so use dynamic import
      // to avoid TypeScript/module resolution issues at build-time.
      // Use `any` to avoid depending on the static TypeScript types from the installed SDK.
      const stripe: any = await import('@stripe/stripe-react-native');
      const isApplePaySupported = stripe?.isApplePaySupported ?? stripe?.ApplePay?.isApplePaySupported;
      if (typeof isApplePaySupported === 'function') {
        return await isApplePaySupported();
      }
      return false;
    } catch (error) {
      console.error('Error checking Apple Pay availability:', error);
      return false;
    }
  }

  /**
   * Process payment with Apple Pay
   */
  async processPayment(request: ApplePayPaymentRequest, authToken?: string): Promise<ApplePayResult> {
    try {
      // Step 1: Create PaymentIntent on backend
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
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create payment intent');
      }

      const { clientSecret, paymentIntentId } = await response.json();

      // Step 2: Present Apple Pay sheet
      const stripe: any = await import('@stripe/stripe-react-native');
      const presentApplePay = stripe?.presentApplePay ?? stripe?.ApplePay?.presentApplePay;
      if (typeof presentApplePay !== 'function') {
        throw new Error('presentApplePay is not available in the installed Stripe SDK');
      }

      const { error: presentError } = await presentApplePay({
        cartItems: [
          {
            label: request.description,
            amount: request.amount.toFixed(2),
            type: 'final',
          },
        ],
        country: 'US',
        currency: 'USD',
        requiredShippingAddressFields: [],
        requiredBillingContactFields: ['postalAddress'],
      });

      if (presentError) {
        console.error('Apple Pay presentation error:', presentError);
        
        // Handle user cancellation separately
        // The SDK may return different casing for cancellation codes; handle common variants.
        const cancelCodes = ['Canceled', 'canceled', 'USER_CANCELLED', 'user_cancelled'];
        if (presentError && cancelCodes.includes(presentError.code)) {
          return {
            success: false,
            error: 'Payment cancelled by user',
            errorCode: 'cancelled',
          };
        }

        return {
          success: false,
          error: presentError.message,
          errorCode: presentError.code,
        };
      }

      // Step 3: Confirm payment with the client secret
      const confirmModule: any = await import('@stripe/stripe-react-native');
      const confirmApplePayPayment = confirmModule?.confirmApplePayPayment ?? confirmModule?.ApplePay?.confirmApplePayPayment;
      if (typeof confirmApplePayPayment !== 'function') {
        throw new Error('confirmApplePayPayment is not available in the installed Stripe SDK');
      }

      const { error: confirmError } = await confirmApplePayPayment(clientSecret);

      if (confirmError) {
        console.error('Apple Pay confirmation error:', confirmError);
        return {
          success: false,
          error: confirmError.message,
          errorCode: confirmError.code,
        };
      }

      // Step 4: Verify payment on backend
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

      const confirmResult = await confirmResponse.json();

      if (confirmResult.success) {
        return {
          success: true,
          paymentIntentId,
        };
      } else {
        return {
          success: false,
          error: confirmResult.error || 'Payment confirmation failed',
        };
      }

    } catch (error) {
      console.error('Apple Pay payment error:', error);
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