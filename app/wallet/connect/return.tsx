/**
 * Stripe Connect Onboarding Return Screen
 *
 * Opened automatically when Stripe redirects back to
 *   https://bountyfinder.app/wallet/connect/return
 * via iOS Universal Links or the Android intent filter defined in app.json.
 *
 * Also reachable via the custom scheme fallback:
 *   bountyexpo-workspace://wallet/connect/return
 */

import { MaterialIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../../components/ui/branding-logo';
import { useAuthContext } from '../../../hooks/use-auth-context';
import { API_BASE_URL } from '../../../lib/config/api';
import { markInitialNavigationDone } from '../../initial-navigation/initialNavigation';

type VerifyStatus = 'loading' | 'success' | 'pending' | 'error';

export default function ConnectReturnScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, isLoading: authLoading } = useAuthContext();

  const [status, setStatus] = useState<VerifyStatus>('loading');

  const verifyOnboarding = useCallback(async () => {
    const token = session?.access_token;
    if (!token) {
      setStatus('error');
      return;
    }

    try {
      setStatus('loading');
      const res = await fetch(`${API_BASE_URL}/connect/verify-onboarding`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Verification failed: ${res.status}`);
      }

      const data: { onboarded?: boolean; chargesEnabled?: boolean; payoutsEnabled?: boolean } =
        await res.json();
      const isOnboarded = !!(data.onboarded ?? (data.chargesEnabled && data.payoutsEnabled));
      setStatus(isOnboarded ? 'success' : 'pending');
    } catch (err) {
      console.error('[ConnectReturn] Verification error:', err);
      setStatus('error');
    }
  }, [session?.access_token]);

  // Wait for auth to finish hydrating before calling the API.
  // This prevents a false 'error' state when session is transiently undefined.
  useEffect(() => {
    if (authLoading) return;
    verifyOnboarding();
  }, [authLoading, verifyOnboarding]);

  const handleGoToWallet = () => {
    try {
      markInitialNavigationDone();
    } catch {
      /* ignore */
    }
    router.replace('/tabs/wallet-screen' as Href);
  };

  const handleRetry = () => {
    verifyOnboarding();
  };

  const renderContent = () => {
    switch (status) {
      case 'loading':
        return (
          <View style={styles.centerContent}>
            <ActivityIndicator size="large" color="#a7f3d0" />
            <Text style={styles.title}>Verifying Account</Text>
            <Text style={styles.description}>Checking your Stripe account status…</Text>
          </View>
        );

      case 'success':
        return (
          <View style={styles.centerContent}>
            <View style={styles.successCircle}>
              <MaterialIcons name="check-circle" size={64} color="#052e1b" />
            </View>
            <Text style={styles.title}>Account Verified!</Text>
            <Text style={styles.description}>
              Your account is set up and ready to receive payouts. Earnings from completed bounties
              will be transferred to your bank.
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleGoToWallet}>
              <Text style={styles.primaryButtonText}>Go to Wallet</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
            </TouchableOpacity>
          </View>
        );

      case 'pending':
        return (
          <View style={styles.centerContent}>
            <View style={styles.pendingCircle}>
              <MaterialIcons name="hourglass-empty" size={64} color="#92400e" />
            </View>
            <Text style={styles.title}>Verification Pending</Text>
            <Text style={styles.description}>
              {
                "Stripe is still reviewing your information. This usually takes a few minutes. You'll be able to withdraw once your account is approved."
              }
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleGoToWallet}>
              <Text style={styles.primaryButtonText}>Go to Wallet</Text>
              <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleRetry}>
              <MaterialIcons name="refresh" size={20} color="#a7f3d0" />
              <Text style={styles.secondaryButtonText}>Check Again</Text>
            </TouchableOpacity>
          </View>
        );

      case 'error':
        return (
          <View style={styles.centerContent}>
            <View style={styles.errorCircle}>
              <MaterialIcons name="error-outline" size={64} color="#7f1d1d" />
            </View>
            <Text style={styles.title}>Verification Failed</Text>
            <Text style={styles.description}>
              {"We couldn't verify your account status. Please try again or check your wallet."}
            </Text>
            <TouchableOpacity style={styles.primaryButton} onPress={handleRetry}>
              <Text style={styles.primaryButtonText}>Try Again</Text>
              <MaterialIcons name="refresh" size={20} color="#052e1b" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={handleGoToWallet}>
              <MaterialIcons name="account-balance-wallet" size={20} color="#a7f3d0" />
              <Text style={styles.secondaryButtonText}>Go to Wallet</Text>
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.brandingHeader}>
        <BrandingLogo size="large" />
      </View>
      <View style={styles.content}>{renderContent()}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669',
    paddingHorizontal: 24,
  },
  brandingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerContent: {
    width: '100%',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 16,
    textAlign: 'center',
  },
  description: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#a7f3d0',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 24,
  },
  pendingCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fde68a',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 24,
  },
  errorCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#fecaca',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 6,
    marginBottom: 24,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#a7f3d0',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 999,
    gap: 8,
    marginBottom: 12,
    width: '100%',
  },
  primaryButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(5,46,27,0.4)',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 999,
    gap: 8,
    borderWidth: 2,
    borderColor: '#a7f3d0',
    width: '100%',
  },
  secondaryButtonText: {
    color: '#a7f3d0',
    fontSize: 16,
    fontWeight: '600',
  },
});
