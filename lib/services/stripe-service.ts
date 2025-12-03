
// Stripe API types
export interface StripePaymentMethod {
  id: string;
  type: 'card';
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  created: number;
}

export interface StripePaymentIntent {
  id: string;
  client_secret: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'canceled' | 'succeeded';
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

import { API_BASE_URL } from '../config/api';
import { analyticsService } from './analytics-service';
import { performanceService } from './performance-service';

class StripeService {
  private publishableKey: string = '';
  private isInitialized: boolean = false;
  private stripeSDK: any = null;

  constructor() {
    // Read from Expo public env (must be prefixed EXPO_PUBLIC_ to reach client bundle)
    const key = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    if (!key) {
      console.warn('[StripeService] Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY env variable. Payments disabled.');
      this.publishableKey = '';
    } else {
      this.publishableKey = key;
    }
  }

  async initialize(): Promise<void> {
    try {
      if (this.isInitialized) return;
      
      // Initialize the Stripe React Native SDK if available
      try {
        const stripeModule: any = await import('@stripe/stripe-react-native');
        if (stripeModule.initStripe && this.publishableKey) {
          await stripeModule.initStripe({
            publishableKey: this.publishableKey,
            merchantIdentifier: 'merchant.com.bountyexpo',
            urlScheme: 'bountyexpo',
          });
          this.stripeSDK = stripeModule;
          console.log('[StripeService] SDK initialized successfully');
        }
      } catch (sdkError) {
        console.warn('[StripeService] Unable to initialize SDK (expected in non-native environments):', sdkError);
      }
      
      this.isInitialized = true;
      console.log('[StripeService] Initialized with publishable key prefix:', this.publishableKey ? this.publishableKey.slice(0, 10) + '…' : 'NONE');
    } catch (error) {
      console.error('[StripeService] Failed to initialize:', error);
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
      
      // Try to use the native Stripe SDK if available
      if (this.stripeSDK?.createPaymentMethod) {
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
      const paymentMethod: StripePaymentMethod = {
        id: `pm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'card',
        card: {
          brand: this.detectCardBrand(cardData.cardNumber),
          last4: cardData.cardNumber.replace(/\s/g, '').slice(-4),
          exp_month: parseInt(cardData.expiryDate.split('/')[0]),
          exp_year: parseInt('20' + cardData.expiryDate.split('/')[1]),
        },
        created: Math.floor(Date.now() / 1000),
      };

      // Simulate network delay for fallback
      await new Promise(resolve => setTimeout(resolve, 500));
      
      return paymentMethod;
    } catch (error) {
      console.error('[StripeService] Error creating payment method:', error);
      throw this.handleStripeError(error);
    }
  }

  /**
   * Create a PaymentIntent via the backend API
   * This is the production-ready implementation that calls your backend
   */
  async createPaymentIntent(amount: number, currency: string = 'usd', authToken?: string): Promise<StripePaymentIntent> {
    performanceService.startMeasurement('payment_initiate', 'payment_process', {
      amount,
      currency,
    });

    try {
      await this.initialize();
      
      // Call backend API to create PaymentIntent
      const response = await fetch(`${API_BASE_URL}/payments/create-payment-intent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({
          amountCents: Math.round(amount * 100),
          currency,
          metadata: {
            purpose: 'wallet_deposit',
          },
        }),
      });

      if (!response.ok) {
        // Do not expose backend error details to the client
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to create payment intent',
        };
      }

      const { clientSecret, paymentIntentId } = await response.json();
      
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
      console.error('[StripeService] Error creating payment intent:', error);

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
   */
  async confirmPayment(paymentIntentClientSecret: string, paymentMethodId: string): Promise<StripePaymentIntent> {
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
        console.log('[StripeService] 3D Secure authentication required');
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
      console.error('[StripeService] Error confirming payment:', error);

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

      // Fetch payment methods from backend
      const response = await fetch(`${API_BASE_URL}/payments/methods`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        // If endpoint doesn't exist yet, return empty array
        if (response.status === 404) {
          return [];
        }
        console.warn('[StripeService] Failed to fetch payment methods:', response.status);
        return [];
      }

      const data = await response.json();
      return (data.paymentMethods || []).map((pm: any) => ({
        id: pm.id,
        type: 'card' as const,
        card: {
          brand: pm.card?.brand || pm.card_brand || 'unknown',
          last4: pm.card?.last4 || pm.card_last4 || '****',
          exp_month: pm.card?.exp_month || pm.card_exp_month || 0,
          exp_year: pm.card?.exp_year || pm.card_exp_year || 0,
        },
        created: pm.created || Math.floor(Date.now() / 1000),
      }));
    } catch (error) {
      console.error('[StripeService] Error fetching payment methods:', error);
      // Return empty array instead of throwing to prevent UI breakage
      return [];
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

      const response = await fetch(`${API_BASE_URL}/payments/methods/${paymentMethodId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw {
          type: 'api_error',
          code: response.status.toString(),
          message: 'Failed to remove payment method',
        };
      }
      
      console.log('[StripeService] Payment method detached:', paymentMethodId);
    } catch (error) {
      console.error('[StripeService] Error detaching payment method:', error);
      throw this.handleStripeError(error);
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
        console.warn('[StripeService] Payment sheet not available in this environment');
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
        returnURL: 'bountyexpo://payment-complete',
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
      console.error('[StripeService] Error presenting payment sheet:', error);
      return {
        success: false,
        error: this.handleStripeError(error) as StripeError,
      };
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
      const stripeError = new Error('Payment service temporarily unavailable. Please try again.') as Error & { type?: string };
      stripeError.type = 'api_error';
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
}

// Export singleton instance
export const stripeService = new StripeService();