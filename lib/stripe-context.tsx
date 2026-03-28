import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuthContext } from '../hooks/use-auth-context';
import { CreatePaymentMethodData, StripePaymentMethod, StripeSetupIntent, stripeService } from './services/stripe-service';
import { getNetworkErrorMessage } from './utils/network-connectivity';

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
  const { session, isLoading: isAuthLoading } = useAuthContext();

  const clearError = () => setError(null);

  const initialize = async () => {
    if (isInitialized) return;
    
    try {
      setIsLoading(true);
      await stripeService.initialize();
      setIsInitialized(true);
      // Payment methods are loaded by the token-change effect once auth resolves.
      // Do NOT call loadPaymentMethods() here — session.access_token may be an
      // expired cached token at mount time, which would cause a 401 "Invalid JWT".
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
    } catch (err: unknown) {
      // Improve error messaging for network issues using centralized utility
      const errorMessage = getNetworkErrorMessage(err);
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

      // Ensure user is authenticated before attempting to create a payment intent
      if (!session?.access_token) {
        const errorMessage = 'Not authenticated. Please sign in again.';
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }

      // Create payment intent - pass auth token to authenticate with backend
      const paymentIntent = await stripeService.createPaymentIntent(amount, 'usd', session.access_token);
      
      // Use provided payment method or default to first available
      const pmId = paymentMethodId || paymentMethods[0]?.id;
      
      if (!pmId) {
        throw new Error('No payment method available. Please add a payment method first.');
      }

      // Confirm payment - pass auth token so the backend /payments/confirm call is authenticated
      const confirmedIntent = await stripeService.confirmPayment(paymentIntent.client_secret, pmId, session.access_token);
      
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

      // Ensure user is authenticated before attempting to create a payment intent
      if (!session?.access_token) {
        const errorMessage = 'Not authenticated. Please sign in again.';
        setError(errorMessage);
        return { success: false, error: errorMessage };
      }

      // Create payment intent with duplicate protection - pass auth token to authenticate with backend
      const paymentIntent = await stripeService.createPaymentIntentSecure(
        amount, 
        'usd', 
        session.access_token, 
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

    // Wait until the service is ready, there is a token, and auth has finished
    // its initial load (prevents fetching with a stale cached/expired token).
    if (!isInitialized || !currentToken || isAuthLoading) return;

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
  }, [isInitialized, session?.access_token, isAuthLoading]);

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