import React, { createContext, useContext, useEffect, useState } from 'react';
// Fixed import path: stripe-context.tsx sits in lib/, so services is a sibling folder under lib/
import { API_BASE_URL } from 'lib/config/api';
import { CreatePaymentMethodData, StripePaymentMethod, StripeSetupIntent, stripeService } from './services/stripe-service';
import { useAuthContext } from '../hooks/use-auth-context';

export async function createPaymentIntent(amount: number) {
  const res = await fetch(`${API_BASE_URL}/api/payments/create-payment-intent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount })
  });
  if (!res.ok) throw new Error('Failed to create payment intent');
  return res.json(); // { clientSecret }
}
interface StripeContextType {
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
  paymentMethods: StripePaymentMethod[];
  
  // Actions
  initialize: () => Promise<void>;
  createPaymentMethod: (cardData: CreatePaymentMethodData) => Promise<StripePaymentMethod>;
  loadPaymentMethods: () => Promise<void>;
  removePaymentMethod: (paymentMethodId: string) => Promise<void>;
  processPayment: (amount: number, paymentMethodId?: string) => Promise<{ success: boolean; error?: string }>;
  processPaymentSecure: (amount: number, options?: { userId?: string; purpose?: string }) => Promise<{ success: boolean; error?: string }>;
  createSetupIntent: () => Promise<StripeSetupIntent | null>;
  clearError: () => void;
}

const StripeContext = createContext<StripeContextType | undefined>(undefined);

export const useStripe = () => {
  const context = useContext(StripeContext);
  if (!context) {
    throw new Error('useStripe must be used within a StripeProvider');
  }
  return context;
};

interface StripeProviderProps {
  children: React.ReactNode;
}

export const StripeProvider: React.FC<StripeProviderProps> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<StripePaymentMethod[]>([]);
  const { session } = useAuthContext();

  const clearError = () => setError(null);

  const initialize = async () => {
    if (isInitialized) return;
    
    try {
      setIsLoading(true);
      await stripeService.initialize();
      setIsInitialized(true);
      
      // Load initial payment methods
      await loadPaymentMethods();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize payment service';
      setError(errorMessage);
      console.error('Stripe initialization error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const createPaymentMethod = async (cardData: CreatePaymentMethodData): Promise<StripePaymentMethod> => {
    try {
      setIsLoading(true);
      clearError();
      
      const paymentMethod = await stripeService.createPaymentMethod(cardData);
      
      // Add to local state
      setPaymentMethods(prev => [paymentMethod, ...prev]);
      
      return paymentMethod;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add payment method';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loadPaymentMethods = async () => {
    try {
      setIsLoading(true);
      clearError();

      const methods = await stripeService.listPaymentMethods(session?.access_token);
      setPaymentMethods(methods);
    } catch (err: any) {
      // Improve error messaging for network issues
      let errorMessage = 'Failed to load payment methods';
      
      if (err?.message) {
        if (err.message.includes('timed out') || err.message.includes('timeout')) {
          errorMessage = 'Connection timed out. Please check your internet connection and try again.';
        } else if (err.message.includes('Network') || err.message.includes('fetch')) {
          errorMessage = 'Unable to connect. Please check your internet connection.';
        } else if (err.type === 'api_error') {
          errorMessage = 'Payment service temporarily unavailable. Please try again.';
        } else {
          errorMessage = err.message;
        }
      }
      
      setError(errorMessage);
      console.error('Error loading payment methods:', err);
      // Rethrow so callers (who may implement retry logic) can detect failures
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const removePaymentMethod = async (paymentMethodId: string) => {
    try {
      setIsLoading(true);
      clearError();

      await stripeService.detachPaymentMethod(paymentMethodId, session?.access_token || undefined);
      
      // Remove from local state
      setPaymentMethods(prev => prev.filter(pm => pm.id !== paymentMethodId));
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to remove payment method';
      setError(errorMessage);
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const processPayment = async (amount: number, paymentMethodId?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);
      clearError();

      // Create payment intent
      const paymentIntent = await stripeService.createPaymentIntent(amount);
      
      // Use provided payment method or default to first available
      const pmId = paymentMethodId || paymentMethods[0]?.id;
      
      if (!pmId) {
        throw new Error('No payment method available. Please add a payment method first.');
      }

      // Confirm payment
      const confirmedIntent = await stripeService.confirmPayment(paymentIntent.client_secret, pmId);
      
      if (confirmedIntent.status === 'succeeded') {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'Payment was not completed. Please try again.' 
        };
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Payment processing failed';
      setError(errorMessage);
      return { 
        success: false, 
        error: errorMessage 
      };
    } finally {
      setIsLoading(false);
    }
  };

  const processPaymentSecure = async (
    amount: number, 
    options?: { userId?: string; purpose?: string }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setIsLoading(true);
      clearError();

      // Create payment intent with duplicate protection
      const paymentIntent = await stripeService.createPaymentIntentSecure(
        amount, 
        'usd', 
        undefined, 
        options
      );
      
      // Use default payment method
      const pmId = paymentMethods[0]?.id;
      
      if (!pmId) {
        throw new Error('No payment method available. Please add a payment method first.');
      }

      // Confirm payment with enhanced error handling
      const confirmedIntent = await stripeService.confirmPaymentSecure(
        paymentIntent.client_secret, 
        pmId, 
        undefined,
        { userId: options?.userId }
      );
      
      if (confirmedIntent.status === 'succeeded') {
        return { success: true };
      } else {
        return { 
          success: false, 
          error: 'Payment was not completed. Please try again.' 
        };
      }
    } catch (err: any) {
      const errorMessage = err instanceof Error ? err.message : 'Payment processing failed';
      setError(errorMessage);
      return { 
        success: false, 
        error: errorMessage 
      };
    } finally {
      setIsLoading(false);
    }
  };

  const createSetupIntent = async (): Promise<StripeSetupIntent | null> => {
    try {
      setIsLoading(true);
      clearError();
      return await stripeService.createSetupIntent(session?.access_token || undefined);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create setup intent';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Track the last access token for which we loaded payment methods
  const lastLoadedAccessTokenRef = React.useRef<string | null>(null);

  // Initialize on mount
  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload payment methods when auth token becomes available/changes,
  // avoid redundant calls for repeated token refreshes and debounce slightly.
  useEffect(() => {
    const currentToken = session?.access_token || null;

    if (!isInitialized || !currentToken) return;

    // Skip if we've already loaded payment methods for this token
    if (lastLoadedAccessTokenRef.current === currentToken) return;

    lastLoadedAccessTokenRef.current = currentToken;

    // Longer debounce (1 second) to avoid rapid re-fetches during auth flows
    const timeoutId = setTimeout(() => {
      loadPaymentMethods().catch(err => {
        // loadPaymentMethods already sets error; swallow here to avoid unhandled rejection
        console.error('Failed to reload payment methods on token change:', err);
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [isInitialized, session?.access_token]);

  const contextValue: StripeContextType = {
    isInitialized,
    isLoading,
    error,
    paymentMethods,
    initialize,
    createPaymentMethod,
    loadPaymentMethods,
    removePaymentMethod,
    processPayment,
    processPaymentSecure,
    createSetupIntent,
    clearError,
  };

  return (
    <StripeContext.Provider value={contextValue}>
      {children}
    </StripeContext.Provider>
  );
};