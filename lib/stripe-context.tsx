import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuthContext } from '../hooks/use-auth-context';
import { CreatePaymentMethodData, StripePaymentMethod, StripeSetupIntent, stripeService } from './services/stripe-service';
import { logger } from './utils/error-logger';
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
  const { session, isLoading: isAuthLoading, isAuthStale, attemptRefresh } = useAuthContext();

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
      logger.error('Stripe initialization error:', { error: err });
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
      consecutiveJwtFailuresRef.current = 0; // reset on success
      setPaymentMethods(methods);
    } catch (err: unknown) {
      // 401 "Invalid JWT" is a transient auth state that occurs when a stale
      // session from a different Supabase project is in storage (e.g. switching
      // between environments). Suppress the visible error and attempt a token
      // refresh — auth will auto-recover by re-issuing or signing the user out.
      const errObj = err as Record<string, unknown>;
      const isInvalidJwt =
        String(errObj?.message ?? '').includes('Invalid JWT') &&
        (String(errObj?.message ?? '').includes('(401)') || errObj?.code === '401');
      if (isInvalidJwt) {
        consecutiveJwtFailuresRef.current += 1;
        // If a refresh already happened and we still get a 401 the JWT is
        // structurally invalid (wrong Supabase project, missing secrets, etc.).
        // Stop the retry loop and surface a clear, actionable error.
        if (consecutiveJwtFailuresRef.current > 1) {
          logger.warning('[StripeContext] Repeated Invalid JWT after refresh — check Supabase project config.', { error: err });
          setError('Session error loading payment methods. Please sign out and sign in again.');
          return;
        }
        console.warn('[StripeContext] Transient Invalid JWT — requesting token refresh.');
        if (attemptRefresh) {
          await Promise.resolve(attemptRefresh()).catch((refreshError) => {
            console.warn(
              '[StripeContext] Auth refresh attempt after Invalid JWT failed:',
              refreshError
            );
          });
        }
        return;
      }
      // Improve error messaging for network issues using centralized utility
      const errorMessage = getNetworkErrorMessage(err);
      setError(errorMessage);
      logger.error('Error loading payment methods:', { error: err });
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
  // Count consecutive Invalid JWT failures. If the same problem recurs after
  // a token refresh it means the JWT is structurally incompatible (e.g. wrong
  // Supabase project). We stop suppressing after the first failed refresh
  // attempt and surface an actionable error instead of looping.
  const consecutiveJwtFailuresRef = React.useRef<number>(0);

  // Initialize on mount
  useEffect(() => {
    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Also skip when the auth session is marked as stale by the auth context
  // (see useAuthContext / auth provider for the authoritative contract) to avoid
  // redundant calls for repeated token refreshes and debounce slightly.
  useEffect(() => {
    const currentToken = session?.access_token || null;

    // Wait until the service is ready, there is a token, and auth has finished
    // its initial load (prevents fetching with a stale cached/expired token).
    // Also skip when the session is stale (network/refresh failures) to avoid
    // sending an expired or wrong-project token to the edge function.
    if (!isInitialized || !currentToken || isAuthLoading || isAuthStale) return;

    // Skip if the JWT token is already expired — the auth provider will refresh
    // it and the TOKEN_REFRESHED event will update session.access_token, which
    // triggers this effect again with a valid token.  This prevents the 401
    // "Invalid JWT" warning that occurs when a cached expired token is loaded
    // from storage before the automatic refresh completes.
    try {
      const [, payload] = currentToken.split('.');
      const { exp } = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
      // Treat tokens expiring within 90 seconds as expired to match Supabase's
      // own EXPIRY_MARGIN_MS (90 000 ms) and avoid clock-skew / race-condition
      // rejections by the Supabase Edge Function gateway.
      if (typeof exp === 'number' && exp * 1000 < Date.now() + 90_000) return;
    } catch {
      // Malformed JWT — skip and wait for auth refresh
      return;
    }

    // Skip if we've already loaded payment methods for this token
    if (lastLoadedAccessTokenRef.current === currentToken) return;

    lastLoadedAccessTokenRef.current = currentToken;
    // A new token means a fresh auth cycle — reset the failure counter so a
    // legitimately refreshed token gets a clean attempt.
    consecutiveJwtFailuresRef.current = 0;

    // Longer debounce (1 second) to avoid rapid re-fetches during auth flows
    const timeoutId = setTimeout(() => {
      loadPaymentMethods().catch(err => {
        // loadPaymentMethods already sets error; swallow here to avoid unhandled rejection
        logger.error('Failed to reload payment methods on token change:', { error: err });
      });
    }, 1000);

    return () => clearTimeout(timeoutId);
  }, [isInitialized, session?.access_token, isAuthLoading, isAuthStale]);

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