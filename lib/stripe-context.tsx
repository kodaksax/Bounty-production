import React, { createContext, useContext, useEffect, useState } from 'react';
// Fixed import path: stripe-context.tsx sits in lib/, so services is a sibling folder under lib/
import { API_BASE_URL } from 'lib/config/api';
import { CreatePaymentMethodData, StripePaymentMethod, stripeService } from './services/stripe-service';

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
      
      const methods = await stripeService.listPaymentMethods();
      setPaymentMethods(methods);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load payment methods';
      setError(errorMessage);
      console.error('Error loading payment methods:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const removePaymentMethod = async (paymentMethodId: string) => {
    try {
      setIsLoading(true);
      clearError();
      
      await stripeService.detachPaymentMethod(paymentMethodId);
      
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

  // Initialize on mount
  useEffect(() => {
    initialize();
  }, []);

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
    clearError,
  };

  return (
    <StripeContext.Provider value={contextValue}>
      {children}
    </StripeContext.Provider>
  );
};