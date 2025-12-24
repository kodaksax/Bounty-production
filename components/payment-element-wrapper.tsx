/**
 * Payment Element Wrapper
 * 
 * Wraps Stripe's Payment Element for React Native with:
 * - Apple Pay and Google Pay support
 * - Better PCI compliance
 * - Consistent theming
 * - Error handling
 * 
 * Note: This component uses @stripe/stripe-react-native for native mobile apps.
 * For web, we would use @stripe/react-stripe-js with PaymentElement.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { stripeService } from '../lib/services/stripe-service';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { DEEP_LINK_SCHEME } from '../lib/config/app';

// Types for the payment element wrapper
export interface PaymentElementWrapperProps {
  /** Client secret from the backend PaymentIntent or SetupIntent */
  clientSecret: string;
  /** Whether this is for saving a card (SetupIntent) or making a payment (PaymentIntent) */
  mode: 'payment' | 'setup';
  /** Amount to display (in dollars) - only for payment mode */
  amount?: number;
  /** Currency code */
  currency?: string;
  /** Callback when payment is successful */
  onSuccess: (result: PaymentResult) => void;
  /** Callback when payment fails */
  onError: (error: PaymentElementError) => void;
  /** Callback when user cancels */
  onCancel?: () => void;
  /** Whether to show Apple Pay button (iOS only) */
  showApplePay?: boolean;
  /** Whether to show Google Pay button (Android only) */
  showGooglePay?: boolean;
  /** Custom button text */
  buttonText?: string;
  /** Whether payment is being processed */
  isProcessing?: boolean;
  /** Merchant display name for the payment sheet */
  merchantDisplayName?: string;
}

export interface PaymentResult {
  paymentIntentId?: string;
  setupIntentId?: string;
  paymentMethodId?: string;
  status: 'succeeded' | 'requires_action' | 'processing';
}

export interface PaymentElementError {
  code: string;
  message: string;
  type: 'card_error' | 'validation_error' | 'api_error' | 'canceled';
}

/**
 * PaymentElementWrapper Component
 * 
 * Uses the native Stripe SDK PaymentSheet which is the recommended approach
 * for PCI compliance. The PaymentSheet handles:
 * - Card input with validation
 * - 3D Secure authentication
 * - Apple Pay / Google Pay
 * - Saved payment methods
 */
export function PaymentElementWrapper({
  clientSecret,
  mode,
  amount,
  currency = 'usd',
  onSuccess,
  onError,
  onCancel,
  showApplePay = true,
  showGooglePay = true,
  buttonText,
  isProcessing: externalProcessing,
  merchantDisplayName = 'BountyExpo',
}: PaymentElementWrapperProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [stripeModule, setStripeModule] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPaymentSheetReady, setIsPaymentSheetReady] = useState(false);

  // Load the Stripe module dynamically
  useEffect(() => {
    let mounted = true;

    const loadStripe = async () => {
      try {
        const stripe = await import('@stripe/stripe-react-native');
        if (mounted) {
          setStripeModule(stripe);
        }
        // Ensure SDK is initialized with publishable key before using PaymentSheet
        try {
          await stripeService.initialize();
        } catch (e) {
          console.warn('[PaymentElementWrapper] Stripe SDK initialize failed (continuing):', e);
        }
      } catch (err) {
        console.error('[PaymentElementWrapper] Stripe SDK not available:', err);
        if (mounted) {
          setError('Payment service not available on this platform');
          setIsLoading(false);
        }
      }
    };

    loadStripe();

    return () => {
      mounted = false;
    };
  }, []);

  // Initialize Payment Sheet when we have the Stripe module and client secret
  useEffect(() => {
    if (!stripeModule || !clientSecret) return;

    const initializePaymentSheet = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const { initPaymentSheet } = stripeModule;

        // Configure the payment sheet
        const paymentSheetConfig: any = {
          merchantDisplayName,
          style: 'automatic', // Adapts to dark/light mode
          returnURL: `${DEEP_LINK_SCHEME}://payment-complete`,
          defaultBillingDetails: {},
        };

        // Configure based on mode (payment vs setup)
        if (mode === 'payment') {
          paymentSheetConfig.paymentIntentClientSecret = clientSecret;
        } else {
          paymentSheetConfig.setupIntentClientSecret = clientSecret;
        }

        // Configure Apple Pay (iOS)
        if (Platform.OS === 'ios' && showApplePay) {
          paymentSheetConfig.applePay = {
            merchantCountryCode: 'US',
          };
        }

        // Configure Google Pay (Android)
        if (Platform.OS === 'android' && showGooglePay) {
          // Determine test mode from publishable key if available, fallback to client secret pattern
          // The publishable key prefix (pk_test_ vs pk_live_) is the most reliable indicator
          // Default to test mode in non-production environments for safety
          const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '';
          const isTestMode = publishableKey.startsWith('pk_test_') ||
            (!publishableKey && clientSecret.includes('_test_')) ||
            (!publishableKey && process.env.NODE_ENV !== 'production');
          paymentSheetConfig.googlePay = {
            merchantCountryCode: 'US',
            testEnv: isTestMode,
          };
        }

        const { error: initError } = await initPaymentSheet(paymentSheetConfig);

        if (initError) {
          console.error('[PaymentElementWrapper] Init error:', initError);
          setError(initError.message || 'Failed to initialize payment');
          setIsPaymentSheetReady(false);
        } else {
          setIsPaymentSheetReady(true);
        }
      } catch (err: any) {
        console.error('[PaymentElementWrapper] Init exception:', err);
        setError(err.message || 'Failed to initialize payment');
      } finally {
        setIsLoading(false);
      }
    };

    initializePaymentSheet();
  }, [stripeModule, clientSecret, mode, merchantDisplayName, showApplePay, showGooglePay]);

  // Handle payment sheet presentation
  const handlePayment = useCallback(async () => {
    if (!stripeModule || !isPaymentSheetReady) return;

    setIsProcessing(true);
    setError(null);

    try {
      const { presentPaymentSheet } = stripeModule;
      const { error: presentError } = await presentPaymentSheet();

      if (presentError) {
        // Handle cancellation separately
        if (presentError.code === 'Canceled') {
          onCancel?.();
          return;
        }

        // Handle other errors
        const paymentError: PaymentElementError = {
          code: presentError.code || 'unknown',
          message: presentError.message || 'Payment failed',
          type: presentError.type === 'card_error' ? 'card_error' : 'api_error',
        };
        
        setError(presentError.message || 'Payment failed');
        onError(paymentError);
        return;
      }

      // Payment succeeded
      const result: PaymentResult = {
        paymentIntentId: mode === 'payment' ? clientSecret.split('_secret_')[0] : undefined,
        setupIntentId: mode === 'setup' ? clientSecret.split('_secret_')[0] : undefined,
        status: 'succeeded',
      };

      onSuccess(result);
    } catch (err: any) {
      console.error('[PaymentElementWrapper] Payment exception:', err);
      const paymentError: PaymentElementError = {
        code: err.code || 'unknown',
        message: err.message || 'An unexpected error occurred',
        type: 'api_error',
      };
      setError(err.message || 'Payment failed');
      onError(paymentError);
    } finally {
      setIsProcessing(false);
    }
  }, [stripeModule, isPaymentSheetReady, clientSecret, mode, onSuccess, onError, onCancel]);

  // Determine button text
  const getButtonText = () => {
    if (buttonText) return buttonText;
    if (isProcessing || externalProcessing) return 'Processing...';
    if (mode === 'setup') return 'Add Payment Method';
    if (amount) {
      const formattedAmount = amount.toLocaleString('en-US', {
        style: 'currency',
        currency: currency.toUpperCase(),
      });
      return `Pay ${formattedAmount}`;
    }
    return 'Pay Now';
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Preparing payment...</Text>
        </View>
      </View>
    );
  }

  // Error state when SDK is not available
  if (!stripeModule) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#dc2626" />
          <Text style={styles.errorTitle}>Payment Not Available</Text>
          <Text style={styles.errorText}>
            {error || 'Payment service is not available on this platform.'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Payment Sheet Info */}
      <View style={styles.infoContainer}>
        <MaterialIcons name="lock" size={20} color="#059669" />
        <Text style={styles.infoText}>
          Secure payment powered by Stripe
        </Text>
      </View>

      {/* Payment Method Icons */}
      <View style={styles.methodIconsContainer}>
        <MaterialIcons name="credit-card" size={32} color="#6b7280" />
        {Platform.OS === 'ios' && showApplePay && (
          <MaterialIcons name="apple" size={32} color="#000000" style={styles.methodIcon} />
        )}
        {Platform.OS === 'android' && showGooglePay && (
          <MaterialIcons name="g-mobiledata" size={32} color="#4285F4" style={styles.methodIcon} />
        )}
      </View>

      {/* Error Display */}
      {error && (
        <View style={styles.errorBanner}>
          <MaterialIcons name="error-outline" size={20} color="#dc2626" />
          <Text style={styles.errorBannerText}>{error}</Text>
        </View>
      )}

      {/* Payment Button */}
      <TouchableOpacity
        style={[
          styles.payButton,
          (!isPaymentSheetReady || isProcessing || externalProcessing) && styles.payButtonDisabled,
        ]}
        onPress={handlePayment}
        disabled={!isPaymentSheetReady || isProcessing || externalProcessing}
        accessibilityRole="button"
        accessibilityLabel={getButtonText()}
        accessibilityState={{ disabled: !isPaymentSheetReady || isProcessing || externalProcessing }}
      >
        {(isProcessing || externalProcessing) ? (
          <ActivityIndicator size="small" color="#ffffff" style={styles.buttonLoader} />
        ) : (
          <MaterialIcons name="payment" size={24} color="#ffffff" style={styles.buttonIcon} />
        )}
        <Text style={styles.payButtonText}>{getButtonText()}</Text>
      </TouchableOpacity>

      {/* Cancel Button */}
      {onCancel && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          disabled={isProcessing || externalProcessing}
          accessibilityRole="button"
          accessibilityLabel="Cancel payment"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}

      {/* Trust Indicators */}
      <View style={styles.trustContainer}>
        <View style={styles.trustItem}>
          <MaterialIcons name="verified" size={16} color="#059669" />
          <Text style={styles.trustText}>256-bit SSL Encryption</Text>
        </View>
        <View style={styles.trustItem}>
          <MaterialIcons name="shield" size={16} color="#059669" />
          <Text style={styles.trustText}>PCI DSS Compliant</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#dc2626',
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 24,
  },
  infoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  infoText: {
    fontSize: 14,
    color: '#059669',
    marginLeft: 8,
  },
  methodIconsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    paddingVertical: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
  },
  methodIcon: {
    marginLeft: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorBannerText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 14,
    marginLeft: 8,
  },
  payButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#059669',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  payButtonDisabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.7,
  },
  buttonIcon: {
    marginRight: 8,
  },
  buttonLoader: {
    marginRight: 8,
  },
  payButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  cancelButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  cancelButtonText: {
    color: '#6b7280',
    fontSize: 16,
  },
  trustContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    flexWrap: 'wrap',
    gap: 16,
  },
  trustItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trustText: {
    fontSize: 12,
    color: '#6b7280',
    marginLeft: 4,
  },
});

export default PaymentElementWrapper;
