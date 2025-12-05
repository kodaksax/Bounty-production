/**
 * Connect Onboarding Wrapper
 * 
 * Wraps Stripe Connect onboarding flow with:
 * - Status tracking
 * - Better error handling
 * - Progress indicators
 * - Deep link support
 * 
 * Note: This uses the Connect Account Link approach since the 
 * Connect Embedded Components are primarily for web.
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { API_BASE_URL } from '../lib/config/api';

export interface ConnectOnboardingWrapperProps {
  /** User's auth token */
  authToken: string;
  /** Callback when onboarding is complete */
  onComplete: (accountId: string) => void;
  /** Callback when onboarding fails */
  onError: (error: ConnectOnboardingError) => void;
  /** Callback when user cancels */
  onCancel?: () => void;
  /** Return URL after onboarding */
  returnUrl?: string;
  /** Refresh URL for expired links */
  refreshUrl?: string;
}

export interface ConnectOnboardingError {
  code: string;
  message: string;
  requiresSupport: boolean;
}

export interface ConnectAccountStatus {
  hasAccount: boolean;
  accountId?: string;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  requiresAction: boolean;
  currentlyDue: string[];
}

/**
 * ConnectOnboardingWrapper Component
 * 
 * Handles the Stripe Connect onboarding flow for bank account setup.
 * This is required for users who want to receive payouts.
 */
export function ConnectOnboardingWrapper({
  authToken,
  onComplete,
  onError,
  onCancel,
  returnUrl = 'bountyexpo://wallet/connect/return',
  refreshUrl = 'bountyexpo://wallet/connect/refresh',
}: ConnectOnboardingWrapperProps) {
  const [status, setStatus] = useState<ConnectAccountStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStartingOnboarding, setIsStartingOnboarding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check current Connect account status
  const checkAccountStatus = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to verify account status');
      }

      const data = await response.json();

      const accountStatus: ConnectAccountStatus = {
        hasAccount: !!data.accountId,
        accountId: data.accountId,
        detailsSubmitted: data.onboarded ?? false,
        chargesEnabled: data.chargesEnabled ?? false,
        payoutsEnabled: data.payoutsEnabled ?? false,
        requiresAction: data.requiresAction ?? false,
        currentlyDue: data.currentlyDue ?? [],
      };

      setStatus(accountStatus);

      // If fully onboarded, notify parent
      if (accountStatus.payoutsEnabled && accountStatus.accountId) {
        onComplete(accountStatus.accountId);
      }
    } catch (err: any) {
      console.error('[ConnectOnboardingWrapper] Status check error:', err);
      setError(err.message || 'Failed to check account status');
    } finally {
      setIsLoading(false);
    }
  }, [authToken, onComplete]);

  // Check status on mount
  useEffect(() => {
    checkAccountStatus();
  }, [checkAccountStatus]);

  // Handle deep link returns
  useEffect(() => {
    const handleDeepLink = async (event: { url: string }) => {
      const { url } = event;
      
      if (url.includes('connect/return') || url.includes('connect/refresh')) {
        // User returned from onboarding, recheck status
        await checkAccountStatus();
      }
    };

    // Add listener for deep links
    const subscription = Linking.addEventListener('url', handleDeepLink);

    return () => {
      subscription?.remove();
    };
  }, [checkAccountStatus]);

  // Start the onboarding flow
  const startOnboarding = useCallback(async () => {
    try {
      setIsStartingOnboarding(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/connect/create-account-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          returnUrl,
          refreshUrl,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create onboarding link');
      }

      const { url, accountId } = await response.json();

      // Check if we can open the URL
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        throw new Error('Cannot open onboarding URL');
      }

      // Open the Stripe Connect onboarding URL
      await Linking.openURL(url);

      // Show a message that they need to complete onboarding
      Alert.alert(
        'Complete Setup',
        'Please complete your account setup in the browser. Return to the app when finished.',
        [{ text: 'OK' }]
      );
    } catch (err: any) {
      console.error('[ConnectOnboardingWrapper] Onboarding start error:', err);

      let errorMessage = err.message || 'Failed to start onboarding';
      let requiresSupport = false;

      // Check for specific error conditions
      if (err.message?.includes('account already exists')) {
        errorMessage = 'You already have a connected account. Please contact support to update your details.';
        requiresSupport = true;
      } else if (err.message?.includes('not configured')) {
        errorMessage = 'Stripe Connect is not available. Please contact support.';
        requiresSupport = true;
      }

      setError(errorMessage);
      onError({
        code: 'onboarding_failed',
        message: errorMessage,
        requiresSupport,
      });
    } finally {
      setIsStartingOnboarding(false);
    }
  }, [authToken, returnUrl, refreshUrl, onError]);

  // Continue incomplete onboarding
  const continueOnboarding = useCallback(async () => {
    // Same as startOnboarding - will create a new link for the existing account
    await startOnboarding();
  }, [startOnboarding]);

  // Get status display
  const getStatusDisplay = () => {
    if (!status) return null;

    if (status.payoutsEnabled) {
      return {
        icon: 'check-circle' as const,
        color: '#059669',
        text: 'Account verified and ready for payouts',
      };
    }

    if (status.hasAccount && status.requiresAction) {
      return {
        icon: 'warning' as const,
        color: '#f59e0b',
        text: 'Additional information required',
      };
    }

    if (status.hasAccount && !status.detailsSubmitted) {
      return {
        icon: 'schedule' as const,
        color: '#6b7280',
        text: 'Setup in progress',
      };
    }

    if (status.hasAccount && status.detailsSubmitted && !status.payoutsEnabled) {
      return {
        icon: 'hourglass-empty' as const,
        color: '#6b7280',
        text: 'Verification pending',
      };
    }

    return {
      icon: 'account-balance' as const,
      color: '#6b7280',
      text: 'Connect your bank account to receive payouts',
    };
  };

  // Loading state
  if (isLoading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#059669" />
        <Text style={styles.loadingText}>Checking account status...</Text>
      </View>
    );
  }

  const statusDisplay = getStatusDisplay();

  return (
    <View style={styles.container}>
      {/* Status Display */}
      {statusDisplay && (
        <View style={styles.statusContainer}>
          <MaterialIcons
            name={statusDisplay.icon}
            size={48}
            color={statusDisplay.color}
          />
          <Text style={[styles.statusText, { color: statusDisplay.color }]}>
            {statusDisplay.text}
          </Text>
        </View>
      )}

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={24} color="#dc2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Action Button */}
      {!status?.payoutsEnabled && (
        <TouchableOpacity
          style={[
            styles.actionButton,
            isStartingOnboarding && styles.actionButtonDisabled,
          ]}
          onPress={status?.hasAccount ? continueOnboarding : startOnboarding}
          disabled={isStartingOnboarding}
          accessibilityRole="button"
          accessibilityLabel={
            status?.hasAccount ? 'Continue account setup' : 'Connect bank account'
          }
        >
          {isStartingOnboarding ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <MaterialIcons
              name={status?.hasAccount ? 'edit' : 'account-balance'}
              size={24}
              color="#ffffff"
              style={styles.buttonIcon}
            />
          )}
          <Text style={styles.actionButtonText}>
            {isStartingOnboarding
              ? 'Opening...'
              : status?.hasAccount
              ? 'Continue Setup'
              : 'Connect Bank Account'}
          </Text>
        </TouchableOpacity>
      )}

      {/* Refresh Button */}
      {status?.hasAccount && !status?.payoutsEnabled && (
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={checkAccountStatus}
          accessibilityRole="button"
          accessibilityLabel="Refresh account status"
        >
          <MaterialIcons name="refresh" size={20} color="#059669" />
          <Text style={styles.refreshButtonText}>Refresh Status</Text>
        </TouchableOpacity>
      )}

      {/* Cancel Button */}
      {onCancel && (
        <TouchableOpacity
          style={styles.cancelButton}
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Cancel"
        >
          <Text style={styles.cancelButtonText}>Cancel</Text>
        </TouchableOpacity>
      )}

      {/* Information Section */}
      <View style={styles.infoContainer}>
        <Text style={styles.infoTitle}>Why connect a bank account?</Text>
        <View style={styles.infoItem}>
          <MaterialIcons name="check" size={16} color="#059669" />
          <Text style={styles.infoText}>Receive earnings from completed bounties</Text>
        </View>
        <View style={styles.infoItem}>
          <MaterialIcons name="check" size={16} color="#059669" />
          <Text style={styles.infoText}>Fast withdrawals in 1-2 business days</Text>
        </View>
        <View style={styles.infoItem}>
          <MaterialIcons name="check" size={16} color="#059669" />
          <Text style={styles.infoText}>Secure transfers powered by Stripe</Text>
        </View>
      </View>

      {/* Currently Due Items */}
      {status?.currentlyDue && status.currentlyDue.length > 0 && (
        <View style={styles.dueContainer}>
          <Text style={styles.dueTitle}>Items needed to complete setup:</Text>
          {status.currentlyDue.map((item, index) => (
            <View key={index} style={styles.dueItem}>
              <MaterialIcons name="circle" size={8} color="#f59e0b" />
              <Text style={styles.dueText}>{formatDueItem(item)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/**
 * Format due item codes into user-friendly text
 */
function formatDueItem(item: string): string {
  const itemMap: Record<string, string> = {
    'individual.verification.document': 'Identity verification document',
    'individual.verification.additional_document': 'Additional identity document',
    'business_profile.mcc': 'Business category',
    'business_profile.url': 'Business website',
    'external_account': 'Bank account details',
    'tos_acceptance': 'Terms of service acceptance',
    'individual.dob.day': 'Date of birth',
    'individual.dob.month': 'Date of birth',
    'individual.dob.year': 'Date of birth',
    'individual.address.line1': 'Address',
    'individual.address.city': 'City',
    'individual.address.state': 'State',
    'individual.address.postal_code': 'Postal code',
    'individual.ssn_last_4': 'Last 4 digits of SSN',
    'individual.id_number': 'Tax ID number',
    'individual.first_name': 'First name',
    'individual.last_name': 'Last name',
    'individual.email': 'Email address',
    'individual.phone': 'Phone number',
  };

  return itemMap[item] || item.replace(/_/g, ' ').replace(/\./g, ' - ');
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
    textAlign: 'center',
  },
  statusContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  statusText: {
    marginTop: 12,
    fontSize: 16,
    textAlign: 'center',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  errorText: {
    flex: 1,
    color: '#dc2626',
    fontSize: 14,
    marginLeft: 8,
  },
  actionButton: {
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
  actionButtonDisabled: {
    backgroundColor: '#9ca3af',
    opacity: 0.7,
  },
  buttonIcon: {
    marginRight: 8,
  },
  actionButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
  },
  refreshButtonText: {
    color: '#059669',
    fontSize: 14,
    marginLeft: 4,
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
  infoContainer: {
    marginTop: 24,
    padding: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 12,
  },
  infoTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: '#6b7280',
    marginLeft: 8,
  },
  dueContainer: {
    marginTop: 16,
    padding: 16,
    backgroundColor: '#fffbeb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fcd34d',
  },
  dueTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#92400e',
    marginBottom: 8,
  },
  dueItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  dueText: {
    fontSize: 13,
    color: '#92400e',
    marginLeft: 8,
  },
});

export default ConnectOnboardingWrapper;
