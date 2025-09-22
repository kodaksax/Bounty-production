import { initStripe, useStripe, useConfirmPayment, PaymentSheet } from '@stripe/stripe-react-native';
import { logger } from 'lib/utils/error-logger';

// Stripe Configuration
const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_your_key_here';

// Initialize Stripe
export const initializeStripe = async () => {
  try {
    await initStripe({
      publishableKey: STRIPE_PUBLISHABLE_KEY,
      merchantIdentifier: 'merchant.com.bountyexpo', // Replace with your merchant ID
    });
    return { success: true, error: null };
  } catch (error) {
    logger.error('Failed to initialize Stripe', { error });
    return { success: false, error: error as Error };
  }
};

export interface PaymentMethodData {
  id: string;
  type: 'card';
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  billing_details?: {
    name?: string;
    email?: string;
  };
  created: number;
}

export interface PaymentIntentData {
  client_secret: string;
  amount: number;
  currency: string;
  status: string;
}

/**
 * Service for handling Stripe payment operations
 */
export const stripeService = {
  /**
   * Create a setup intent for saving payment methods
   */
  async createSetupIntent(customerId?: string): Promise<{ setupIntent: any | null; error: Error | null }> {
    try {
      // Replace with your backend API endpoint
      const API_URL = 'https://your-hostinger-domain.com/api/stripe/setup-intent';
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if required
        },
        body: JSON.stringify({ customerId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to create setup intent');
      }

      const setupIntent = await response.json();
      return { setupIntent, error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error creating setup intent', { error });
      return { setupIntent: null, error };
    }
  },

  /**
   * Create a payment intent for processing payments
   */
  async createPaymentIntent(
    amount: number,
    currency = 'usd',
    customerId?: string,
    paymentMethodId?: string
  ): Promise<{ paymentIntent: PaymentIntentData | null; error: Error | null }> {
    try {
      // Replace with your backend API endpoint
      const API_URL = 'https://your-hostinger-domain.com/api/stripe/payment-intent';
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if required
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100), // Convert to cents
          currency,
          customerId,
          paymentMethodId,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to create payment intent');
      }

      const paymentIntent = await response.json();
      return { paymentIntent, error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error creating payment intent', { error });
      return { paymentIntent: null, error };
    }
  },

  /**
   * Get customer's saved payment methods
   */
  async getPaymentMethods(customerId: string): Promise<{ paymentMethods: PaymentMethodData[]; error: Error | null }> {
    try {
      // Replace with your backend API endpoint
      const API_URL = `https://your-hostinger-domain.com/api/stripe/payment-methods?customerId=${customerId}`;
      
      const response = await fetch(API_URL, {
        headers: {
          // Add authentication headers if required
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to fetch payment methods');
      }

      const data = await response.json();
      return { paymentMethods: data.paymentMethods || [], error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error fetching payment methods', { error });
      return { paymentMethods: [], error };
    }
  },

  /**
   * Delete a payment method
   */
  async deletePaymentMethod(paymentMethodId: string): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Replace with your backend API endpoint
      const API_URL = `https://your-hostinger-domain.com/api/stripe/payment-methods/${paymentMethodId}`;
      
      const response = await fetch(API_URL, {
        method: 'DELETE',
        headers: {
          // Add authentication headers if required
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to delete payment method');
      }

      return { success: true, error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error deleting payment method', { error });
      return { success: false, error };
    }
  },

  /**
   * Set default payment method for a customer
   */
  async setDefaultPaymentMethod(
    customerId: string, 
    paymentMethodId: string
  ): Promise<{ success: boolean; error: Error | null }> {
    try {
      // Replace with your backend API endpoint
      const API_URL = 'https://your-hostinger-domain.com/api/stripe/default-payment-method';
      
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Add authentication headers if required
        },
        body: JSON.stringify({ customerId, paymentMethodId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || 'Failed to set default payment method');
      }

      return { success: true, error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Unknown error');
      logger.error('Error setting default payment method', { error });
      return { success: false, error };
    }
  },
};

// Export hooks for easy use in components
export { useStripe, useConfirmPayment, PaymentSheet };