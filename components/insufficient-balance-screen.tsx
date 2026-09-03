import { MaterialIcons } from '@expo/vector-icons';
import { Button } from 'components/ui/button';
import { useEffect, useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  getBottomNavContentGap,
  getBottomNavOccludedHeight,
} from '../lib/constants/navigation';
import { hapticFeedback } from '../lib/haptic-feedback';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { getAmountNeeded } from '../lib/utils/bounty-validation';

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
  /** Optional context-specific title for non-posting flows. */
  title?: string;
  /** Optional context-specific subtitle for non-posting flows. */
  subtitle?: string;
  /** Optional context-specific secondary action label. */
  editAmountLabel?: string;
  /** Optional context-specific accessibility label for the secondary action. */
  editAmountAccessibilityLabel?: string;
}

/**
 * Shown instead of a hard error when a poster's wallet balance can't cover
 * the bounty they're about to publish — the natural next step in the
 * posting flow rather than a dead end (see CreateBountyFlow's submit gate).
 *
 * Deliberately compact: the breakdown card + CTA are meant to be visible
 * together without scrolling on common iPhone heights, so `onAddFunds` reads
 * as the obvious next tap rather than something to hunt for below the fold.
 */
export function InsufficientBalanceScreen({
  walletBalance,
  bountyAmount,
  onAddFunds,
  onEditAmount,
  onCancel,
  title = 'Add Funds to Post',
  subtitle = "Your wallet needs a bit more — funds stay in escrow until the job's done.",
  editAmountLabel = 'Edit Amount',
  editAmountAccessibilityLabel = 'Edit Bounty Amount',
}: InsufficientBalanceScreenProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  // Everything below the CTA has to clear the floating BottomNav, which
  // overhangs its own bar (see getBottomNavOccludedHeight). Derived from the
  // live viewport + insets, so it tracks the device instead of assuming one.
  const footerClearance =
    getBottomNavOccludedHeight(insets.bottom, windowWidth) + getBottomNavContentGap(windowHeight);
  const needed = getAmountNeeded(bountyAmount, walletBalance);

  useEffect(() => {
    hapticFeedback.warning();
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + 16 }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeIn.duration(200)} style={styles.hero}>
          <View style={styles.iconCircle}>
            <MaterialIcons name="account-balance-wallet" size={26} color={theme.primary} />
          </View>

          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.subtitle}>
            {subtitle}
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(60).duration(220)} style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Bounty Amount</Text>
            <Text style={styles.rowValue}>${bountyAmount.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Current Balance</Text>
            <Text style={styles.rowValue}>${walletBalance.toFixed(2)}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Text style={[styles.rowLabel, styles.neededLabel]}>Amount Needed</Text>
            <Text style={styles.neededValue}>${needed.toFixed(2)}</Text>
          </View>
        </Animated.View>
      </ScrollView>

      {/* The floating BottomNav is position:absolute and overlays this screen
          (both hosts render the funding gate full-bleed), so the footer has to
          reserve the bar's full occluded height itself. insets.bottom alone put
          the CTA under the bar; the bar box alone still left the centered
          "Edit Amount | Cancel" row under the crosshair, which is lifted clear
          of the bar and sits dead center — exactly where that row is. */}
      <Animated.View
        entering={FadeInDown.delay(100).duration(220)}
        style={[styles.footer, { paddingBottom: footerClearance }]}
      >
        <Button
          variant="default"
          size="lg"
          onPress={onAddFunds}
          accessibilityLabel={`Add $${needed.toFixed(2)} and continue`}
          style={styles.primaryButton}
        >
          {`Add $${needed.toFixed(2)} & Continue`}
        </Button>

        <View style={styles.secondaryRow}>
          <TouchableOpacity
            onPress={onEditAmount}
            accessibilityRole="button"
            accessibilityLabel={editAmountAccessibilityLabel}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.secondaryLink}
          >
            <Text style={styles.secondaryLinkText}>{editAmountLabel}</Text>
          </TouchableOpacity>
          <View style={styles.secondaryDivider} />
          <TouchableOpacity
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            style={styles.secondaryLink}
          >
            <Text style={[styles.secondaryLinkText, styles.cancelText]}>Cancel</Text>
          </TouchableOpacity>
        </View>
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
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 12,
    },
    hero: {
      alignItems: 'center',
    },
    iconCircle: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.22)' : 'rgba(5,150,105,0.10)',
    },
    title: {
      fontSize: 21,
      fontWeight: '800',
      letterSpacing: -0.3,
      color: theme.text,
      textAlign: 'center',
      marginBottom: 5,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 19,
      color: theme.textSecondary,
      textAlign: 'center',
      paddingHorizontal: 12,
    },
    card: {
      marginTop: 18,
      borderRadius: 16,
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 14,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    rowLabel: {
      fontSize: 14,
      color: theme.textSecondary,
    },
    rowValue: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.text,
    },
    divider: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: 4,
    },
    neededLabel: {
      fontWeight: '600',
      color: theme.text,
    },
    neededValue: {
      fontSize: 18,
      fontWeight: '800',
      color: theme.primary,
    },
    footer: {
      paddingHorizontal: 24,
      paddingTop: 10,
      gap: 8,
    },
    primaryButton: {
      width: '100%',
    },
    secondaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLink: {
      minHeight: 36,
      paddingVertical: 6,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryLinkText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.primary,
    },
    cancelText: {
      color: theme.textSecondary,
    },
    secondaryDivider: {
      width: 1,
      height: 14,
      backgroundColor: theme.border,
    },
  });
}
