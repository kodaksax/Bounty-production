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
  /**
   * @deprecated Use processPaymentSecure() to ensure idempotent payment intent creation.
   */
  processPayment: (amount: number, paymentMethodId?: string) => Promise<{ success: boolean; paymentIntentId?: string; error?: string }>;
  processPaymentSecure: (
    amount: number,
    options?: { userId?: string; purpose?: string; paymentMethodId?: string }
  ) => Promise<{ success: boolean; paymentIntentId?: string; error?: string }>;
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

  const clearError = () => {
    setError(null);
    // Reset the consecutive-401 counter so that a user-initiated retry (e.g.
    // opening PaymentMethodsModal, pressing Retry) gets a fresh attempt.
    // This is safe because clearError() is only called from explicit UI actions,
    // not from the automatic token-change effect that could cause a refresh loop.
    consecutiveJwtFailuresRef.current = 0;
  };

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
    // Bail early once the session is confirmed permanently invalid (> 2
    // consecutive 401s even after the service-layer internal retry with a fresh
    // token). Without this guard clearError() would wipe the displayed error
    // on every call, triggering another doomed network round-trip.
    // NOTE: consecutiveJwtFailuresRef is reset by clearError() (called from
    // PaymentMethodsModal on open and on manual retry) so the user can always
    // explicitly retry without signing out.
    if (consecutiveJwtFailuresRef.current > 2) return;

    try {
      setIsLoading(true);
      // Clear the displayed error but do NOT reset the 401 counter here.
      // clearError() resets consecutiveJwtFailuresRef which would make the
      // "more than 2 consecutive 401s" guard unreachable — every call would
      // reset the counter to 0 before the guard check on the next call.
      // The counter is intentionally only reset on success (below) or by
      // explicit user actions that call clearError() (e.g. opening the
      // PaymentMethodsModal, pressing Retry).
      setError(null);

      const methods = await stripeService.listPaymentMethods(session?.access_token);
      consecutiveJwtFailuresRef.current = 0; // reset on success
      setPaymentMethods(methods);
    } catch (err: unknown) {
      // Any 401 ("Invalid JWT" from the Supabase gateway, or "Authentication
      // required" from the edge function's auth.getUser() check) that reaches
      // here means the service layer already attempted one internal retry with
      // a freshly-fetched session token and it still failed.  The session is
      // genuinely expired or revoked.
      const errObj = err as Record<string, unknown>;
      const is401AuthError =
        errObj?.code === '401' ||
        String(errObj?.message ?? '').includes('(401)');
      if (is401AuthError) {
        consecutiveJwtFailuresRef.current += 1;
        if (consecutiveJwtFailuresRef.current > 2) {
          // Three 401 failures even across token refreshes — the session is
          // permanently invalid. Surface an actionable error and stop retrying.
          logger.warning('[StripeContext] Repeated 401s — session may be permanently invalid.', { error: err });
          setError('Session error loading payment methods. Please sign out and sign in again.');
        } else {
          console.warn('[StripeContext] 401 loading payment methods — will retry on next token refresh.');
        }
        // Always throw on 401 so callers with retry logic (e.g.
        // refreshPaymentMethodsWithRetry) know the call failed and can
        // retry instead of silently treating it as success.
        throw err;
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

  /**
   * @deprecated Use processPaymentSecure() directly.
   */
  const processPayment = async (
    amount: number,
    paymentMethodId?: string
  ): Promise<{ success: boolean; paymentIntentId?: string; error?: string }> => {
    return processPaymentSecure(amount, {
      paymentMethodId,
      userId: session?.user?.id,
    });
  };

  const processPaymentSecure = async (
    amount: number, 
    options?: { userId?: string; purpose?: string; paymentMethodId?: string }
  ): Promise<{ success: boolean; paymentIntentId?: string; error?: string }> => {
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
      
      // Use provided payment method or default payment method
      const pmId = options?.paymentMethodId || paymentMethods[0]?.id;
      
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
        return { success: true, paymentIntentId: paymentIntent.id };
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
    // Do NOT reset consecutiveJwtFailuresRef here. The counter tracks total
    // 401 failures across all tokens in this mount cycle and is only cleared
    // inside the try-block on a successful load. Resetting it on every new
    // token would allow the infinite-loop pattern:
    //   401 → (something refreshes) → new token → counter reset → 401 → loop.

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
