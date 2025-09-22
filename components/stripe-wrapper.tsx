import React, { ReactElement, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { initializeStripe, StripeProvider } from '../lib/services/stripe-service';

const STRIPE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_your_key_here';

interface StripeWrapperProps {
  children: ReactElement | ReactElement[];
}

export function StripeWrapper({ children }: StripeWrapperProps) {
  const [isStripeInitialized, setIsStripeInitialized] = useState(false);

  useEffect(() => {
    const init = async () => {
      const result = await initializeStripe();
      if (result.success) {
        setIsStripeInitialized(true);
      } else {
        console.warn('Failed to initialize Stripe:', result.error);
        // Still set to true to allow the app to continue without Stripe
        setIsStripeInitialized(true);
      }
    };
    
    init();
  }, []);

  if (!isStripeInitialized) {
    return null; // or a loading component
  }

  // On web, don't wrap with StripeProvider
  if (Platform.OS === 'web' || !StripeProvider) {
    return <>{children}</>;
  }

  return (
    <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>
      {children}
    </StripeProvider>
  );
}