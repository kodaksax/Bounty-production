import { MaterialIcons } from '@expo/vector-icons';
import { Button } from 'components/ui/button';
import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticFeedback } from '../lib/haptic-feedback';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

interface InsufficientBalanceScreenProps {
  /** Current wallet balance in dollars. */
  walletBalance: number;
  /** The bounty amount the poster is trying to fund, in dollars. */
  bountyAmount: number;
  /** Continue into the wallet top-up flow. */
  onAddFunds: () => void;
  /** Return to the compensation step so the poster can lower the amount. */
  onEditAmount: () => void;
  /** Exit the posting flow. The draft is preserved regardless. */
  onCancel: () => void;
}

/**
 * Shown instead of a hard error when a poster's wallet balance can't cover
 * the bounty they're about to publish — the natural next step in the
 * posting flow rather than a dead end (see CreateBountyFlow's submit gate).
 */
export function InsufficientBalanceScreen({
  walletBalance,
  bountyAmount,
  onAddFunds,
  onEditAmount,
  onCancel,
}: InsufficientBalanceScreenProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const needed = Math.max(0, bountyAmount - walletBalance);

  useEffect(() => {
    hapticFeedback.warning();
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(260)} style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="account-balance-wallet" size={40} color={theme.primary} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            Insufficient Balance
          </Text>
          <Text style={styles.subtitle}>
            You need additional funds in your wallet before your bounty can be posted.
          </Text>
          <Text style={styles.subtitle}>
            Your payment will remain securely held in escrow until the bounty is completed.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(300)} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Wallet Balance</Text>
            <Text style={styles.rowValue}>${walletBalance.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Bounty Amount</Text>
            <Text style={styles.rowValue}>${bountyAmount.toFixed(2)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, styles.neededLabel]}>Needed</Text>
            <Text style={styles.neededValue}>${needed.toFixed(2)}</Text>
          </View>
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={FadeInDown.delay(140).duration(300)}
        style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}
      >
        <Button
          variant="default"
          size="lg"
          onPress={onAddFunds}
          accessibilityLabel="Add Funds"
          style={styles.primaryButton}
        >
          Add Funds
        </Button>
        <Button
          variant="outline"
          size="lg"
          onPress={onEditAmount}
          accessibilityLabel="Edit Bounty Amount"
          style={styles.secondaryButton}
        >
          Edit Bounty Amount
        </Button>
        <Button
          variant="ghost"
          onPress={onCancel}
          accessibilityLabel="Cancel"
          style={styles.cancelButton}
        >
          Cancel
        </Button>
      </Animated.View>
    </View>
  );
}

export default InsufficientBalanceScreen;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingBottom: 24,
    },
    hero: {
      alignItems: 'center',
    },
    iconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.10)',
    },
    title: {
      fontSize: 28,
      fontWeight: '800',
      letterSpacing: -0.5,
      color: theme.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    subtitle: {
      fontSize: 16,
      lineHeight: 23,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 10,
      paddingHorizontal: 8,
    },
    card: {
      marginTop: 28,
      borderRadius: 24,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 20,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 10,
    },
    rowLabel: {
      fontSize: 16,
      color: theme.textSecondary,
    },
    rowValue: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.text,
    },
    divider: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: 6,
    },
    neededLabel: {
      fontWeight: '600',
      color: theme.text,
    },
    neededValue: {
      fontSize: 22,
      fontWeight: '800',
      color: theme.primary,
    },
    footer: {
      paddingHorizontal: 24,
      paddingTop: 12,
      gap: 12,
    },
    primaryButton: {
      width: '100%',
    },
    secondaryButton: {
      width: '100%',
    },
    cancelButton: {
      width: '100%',
    },
  });
}
