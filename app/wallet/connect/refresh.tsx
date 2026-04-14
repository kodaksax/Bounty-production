/**
 * Stripe Connect Onboarding Refresh Screen
 *
 * Opened when Stripe redirects to the refresh_url because the account
 * link has expired:
 *   https://bountyfinder.app/wallet/connect/refresh
 *
 * Also reachable via custom scheme fallback:
 *   bountyexpo-workspace://wallet/connect/refresh
 *
 * Instructs the user to restart the onboarding flow.
 */

import { MaterialIcons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BrandingLogo } from '../../../components/ui/branding-logo';
import { markInitialNavigationDone } from '../../initial-navigation/initialNavigation';

export default function ConnectRefreshScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleRestartSetup = () => {
    try { markInitialNavigationDone(); } catch { /* ignore */ }
    // Navigate to the wallet/withdraw area where onboarding can be restarted
    router.replace('/tabs/wallet-screen' as Href);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.brandingHeader}>
        <BrandingLogo size="large" />
      </View>

      <View style={styles.content}>
        <View style={styles.iconCircle}>
          <MaterialIcons name="link-off" size={64} color="#92400e" />
        </View>

        <Text style={styles.title}>Onboarding Link Expired</Text>
        <Text style={styles.description}>
          Your Stripe onboarding link has expired. Please return to the app and start the setup again to get a fresh link.
        </Text>

        <View style={styles.infoBox}>
          <MaterialIcons name="info-outline" size={20} color="#a7f3d0" />
          <Text style={styles.infoText}>
            This happens automatically after the link's security window closes. It only takes a moment to get a new one.
          </Text>
        </View>

        <TouchableOpacity style={styles.primaryButton} onPress={handleRestartSetup}>
          <Text style={styles.primaryButtonText}>Return to Wallet</Text>
          <MaterialIcons name="arrow-forward" size={20} color="#052e1b" />
        </TouchableOpacity>
      </View>
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
  iconCircle: {
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
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(5,46,27,0.4)',
    borderRadius: 12,
    padding: 16,
    width: '100%',
    marginBottom: 32,
    borderWidth: 1,
    borderColor: 'rgba(167,243,208,0.3)',
    gap: 12,
  },
  infoText: {
    flex: 1,
    color: 'rgba(255,255,255,0.75)',
    fontSize: 14,
    lineHeight: 20,
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
    width: '100%',
  },
  primaryButtonText: {
    color: '#052e1b',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
