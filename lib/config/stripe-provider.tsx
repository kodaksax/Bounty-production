/**
 * Stripe Provider Component
 * Provides Stripe configuration using environment variables
 */

import { StripeProvider as StripeProviderNative } from '@stripe/stripe-react-native';
import React from 'react';
import { STRIPE_CONFIG } from 'lib/config/app-config';

interface StripeProviderProps {
  children: React.ReactNode;
}

export function StripeProvider({ children }: StripeProviderProps) {
  // Validate Stripe configuration
  if (!STRIPE_CONFIG.publishableKey || STRIPE_CONFIG.publishableKey === 'pk_test_placeholder') {
    console.error('Stripe publishable key not properly configured. Check your environment variables.');
  }

  return (
    <StripeProviderNative
      publishableKey={STRIPE_CONFIG.publishableKey}
      merchantIdentifier={STRIPE_CONFIG.merchantIdentifier}
    >
      {children}
    </StripeProviderNative>
  );
}