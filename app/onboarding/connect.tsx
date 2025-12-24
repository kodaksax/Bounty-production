import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';
import ConnectOnboardingButton from '../../components/ConnectOnboardingButton';
import { showToast } from '../../lib/utils/toast';
import { stripeService } from '../../lib/services/stripe-service';
import { DEEP_LINK_PREFIX } from '../../lib/config/app';

export default function ConnectOnboardingScreen() {
  const params = useLocalSearchParams<{ userId?: string; email?: string; authToken?: string }>();
  const userId = params.userId as string | undefined;
  const email = params.email as string | undefined;
  const authToken = params.authToken as string | undefined;

  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [verified, setVerified] = useState<boolean | undefined>(undefined);
  const [verifying, setVerifying] = useState<boolean>(false);

  useEffect(() => {
    const onUrl = (event: { url: string }) => {
      if (!event?.url) return;
      // Expect deep link like: <scheme>://connect-onboarding-return
      const url = event.url.toLowerCase();
      if (url.startsWith((DEEP_LINK_PREFIX + 'connect-onboarding-return').toLowerCase())) {
        showToast('success', 'Returned from Stripe onboarding.');
        if (accountId) {
          setVerifying(true);
          stripeService
            .verifyConnectAccount(accountId, authToken)
            .then((res) => setVerified(res.detailsSubmitted))
            .catch((err) => {
              console.error('[Onboarding] Verification error:', err);
              setVerified(false);
            })
            .finally(() => setVerifying(false));
        }
      }
    };

    const sub = Linking.addEventListener('url', onUrl);

    // Handle cold start deep link
    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial && initial.toLowerCase().startsWith((DEEP_LINK_PREFIX + 'connect-onboarding-return').toLowerCase())) {
        showToast('success', 'Returned from Stripe onboarding.');
        if (accountId) {
          setVerifying(true);
          try {
            const res = await stripeService.verifyConnectAccount(accountId, authToken);
            setVerified(res.detailsSubmitted);
          } catch (err) {
            console.error('[Onboarding] Verification error:', err);
            setVerified(false);
          } finally {
            setVerifying(false);
          }
        }
      }
    })();

    return () => {
      sub?.remove?.();
    };
  }, [accountId, authToken]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Payouts Onboarding</Text>
      {verified === true && (
        <View style={[styles.banner, { backgroundColor: '#d1fae5' }]}> {/* emerald-100 */}
          <Text style={[styles.bannerText, { color: '#065f46' }]}> {/* emerald-800 */}
            Your account is verified for payouts.
          </Text>
        </View>
      )}
      {verified === false && (
        <View style={[styles.banner, { backgroundColor: '#fffbeb' }]}> {/* amber-50 */}
          <Text style={[styles.bannerText, { color: '#92400e' }]}> {/* amber-800 */}
            Onboarding incomplete. Please finish steps in Stripe.
          </Text>
        </View>
      )}
      {verifying && (
        <View style={[styles.banner, { backgroundColor: '#e5e7eb' }]}> {/* gray-200 */}
          <Text style={[styles.bannerText, { color: '#374151' }]}> {/* gray-700 */}
            Verifying your account status...
          </Text>
        </View>
      )}
      {!userId || !email ? (
        <Text style={styles.info}>Missing parameters. Navigate with userId and email.</Text>
      ) : (
        <ConnectOnboardingButton
          userId={userId}
          email={email}
          authToken={authToken}
          onSuccess={(acctId) => {
            setAccountId(acctId);
            showToast('info', 'Opening onboarding in browser...');
          }}
          onError={(err) => showToast('error', err?.message || 'Onboarding failed')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  info: { color: '#6b7280', marginBottom: 12 },
  banner: { padding: 10, borderRadius: 8, marginBottom: 12 },
  bannerText: { fontWeight: '600' },
});
