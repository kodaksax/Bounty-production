/**
 * PayoutFailedBanner
 *
 * Shown at the top of the Wallet screen when the hunter's most recent payout
 * has failed (profiles.payout_failed_at is set). Guides the user to update
 * their bank account details in the Stripe Express Dashboard and then polls
 * verify-onboarding to clear the flag once payouts are re-enabled.
 */

import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { API_BASE_URL } from '../../lib/config/api';
import { config } from '../../lib/config';
import { openUrlInBrowser } from '../../lib/utils/browser';
import { useWallet } from '../../lib/wallet-context';
import { useAuthContext } from '../../hooks/use-auth-context';

// Human-friendly messages for well-known Stripe failure codes.
// https://stripe.com/docs/api/payouts/object#payout_object-failure_code
const FAILURE_CODE_MESSAGES: Record<string, string> = {
  account_closed: 'Your bank account has been closed. Please add a new one.',
  account_frozen: 'Your bank account is frozen. Please contact your bank.',
  bank_account_restricted: 'Your bank account has restrictions that prevent payouts. Please contact your bank.',
  bank_ownership_changed: 'The bank account ownership has changed. Please reconnect your account.',
  could_not_process: 'Your bank was unable to process the payout. Please try again or update your details.',
  debit_not_authorized: 'Debits are not authorized for this account. Please check your bank settings.',
  declined: 'Your bank declined the payout. Please contact your bank for details.',
  incorrect_account_holder_name: 'The account holder name does not match. Please update your details.',
  incorrect_account_holder_address: 'The account holder address does not match. Please update your details.',
  incorrect_account_holder_tax_id: 'The tax ID associated with your account is incorrect. Please update your details.',
  insufficient_funds: 'Your Stripe balance was insufficient. This should resolve automatically.',
  invalid_account_number: 'The bank account number is invalid. Please update your details.',
  invalid_currency: 'The currency is not supported for your bank account.',
  no_account: 'The bank account could not be found. Please re-enter your details.',
  unsupported_card: 'Payouts to this card type are not supported.',
};

function getFailureMessage(failureCode: string | null, fallback?: string): string {
  if (failureCode && FAILURE_CODE_MESSAGES[failureCode]) {
    return FAILURE_CODE_MESSAGES[failureCode];
  }
  if (fallback) return fallback;
  if (failureCode) return `Payout failed (${failureCode}). Please update your payment details.`;
  return 'Your most recent payout could not be processed. Please update your payment details.';
}

export function PayoutFailedBanner() {
  const { payoutFailed, payoutFailureCode, refreshFromApi } = useWallet();
  const { session } = useAuthContext();
  const [isFixing, setIsFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);

  const handleFixPaymentDetails = useCallback(async () => {
    if (!session?.access_token) return;

    setIsFixing(true);
    setFixError(null);

    try {
      // Request an account_update link from the connect edge function
      const response = await fetch(`${API_BASE_URL}/connect/create-account-link`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
        body: JSON.stringify({ type: 'account_update' }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || 'Failed to create account update link');
      }

      const { url } = await response.json();
      if (!url) throw new Error('No URL returned from server');

      // Open the Stripe Express Dashboard in an in-app browser.
      // If the user cancels or the browser fails to open, surface the error and
      // do NOT proceed to verify-onboarding — there's nothing to verify yet.
      const browserResult = await openUrlInBrowser(url);
      if (!browserResult.success) {
        setFixError(browserResult.error || 'Could not open the browser. Please try again.');
        return;
      }

      // After the browser closes, re-verify onboarding. If payouts are now
      // enabled the server will clear payout_failed_at and the next balance
      // refresh will hide this banner.
      const verifyResponse = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
      });

      if (!verifyResponse.ok) {
        const verifyErr = await verifyResponse.json().catch(() => ({}));
        throw new Error(
          (verifyErr as { error?: string }).error || 'Failed to verify your account status.'
        );
      }

      const verifyData = await verifyResponse.json();

      // Refresh wallet balance so the context picks up the cleared flag
      await refreshFromApi(session.access_token);

      // If payouts still aren't enabled after the update session, let the user
      // know they may need to finish their Stripe details.
      if (!verifyData.payoutsEnabled) {
        setFixError('Your payment details were saved, but payouts are not yet enabled. Please ensure all required information is complete in Stripe.');
      }
    } catch (err: unknown) {
      console.error('[PayoutFailedBanner] Fix payment details error:', err);
      setFixError((err instanceof Error ? err.message : null) || 'Something went wrong. Please try again.');
    } finally {
      setIsFixing(false);
    }
  }, [session, refreshFromApi]);

  if (!payoutFailed) return null;

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name="error-outline" size={24} color="#ef4444" />
        </View>
        <View style={styles.textContainer}>
          <Text style={styles.title}>Payout Failed</Text>
          <Text style={styles.subtitle}>
            {getFailureMessage(payoutFailureCode)}
          </Text>
          {fixError ? (
            <Text style={styles.errorText}>{fixError}</Text>
          ) : null}
          <TouchableOpacity
            onPress={handleFixPaymentDetails}
            disabled={isFixing}
            style={styles.fixButton}
            accessibilityRole="button"
            accessibilityLabel="Fix payment details"
            accessibilityHint="Opens Stripe to update your bank account details"
          >
            {isFixing ? (
              <ActivityIndicator size="small" color="#ef4444" />
            ) : (
              <Text style={styles.fixButtonText}>Fix Payment Details →</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderLeftWidth: 4,
    borderLeftColor: '#ef4444',
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 8,
    alignItems: 'flex-start',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  iconContainer: {
    marginRight: 12,
    marginTop: 2,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.8)',
    lineHeight: 18,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 12,
    color: '#fca5a5',
    marginBottom: 6,
  },
  fixButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  fixButtonText: {
    fontSize: 13,
    color: '#ef4444',
    fontWeight: '600',
  },
});
