/**
 * The screen the poster sees between tapping "Select" on a hunter and the
 * acceptance being attempted.
 *
 * Three stages, driven entirely by useAcceptFunding — this component holds no
 * logic of its own, exactly like app/screens/CreateBounty/PublishFundingGate:
 *
 *   confirm      — "You'll be charged $X to secure this bounty."
 *   insufficient — the existing InsufficientBalanceScreen, relabelled for the
 *                  accept context
 *   topup        — the existing AddMoneyScreen, pre-filled with the shortfall
 *
 * The last two are the SAME components the posting flow uses. Reusing them is
 * the point: this experiment moves when a poster funds, not how, so the
 * funding UI they meet should be the one they'd have met at post time.
 */

import { AddMoneyScreen } from 'components/add-money-screen';
import { InsufficientBalanceScreen } from 'components/insufficient-balance-screen';
import type { AcceptFundingGate as AcceptFundingGateState } from 'hooks/useAcceptFunding';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import { getBottomNavContentGap, getBottomNavOccludedHeight } from 'lib/constants/navigation';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AcceptFundingGateProps {
  gate: AcceptFundingGateState;
}

const clamp = (value: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, value)));

/**
 * Confirm-stage spacing derived from the viewport rather than fixed points,
 * mirroring add-money-screen's `getScreenMetrics`. The same summary has to fit
 * a 320pt SE and a 430pt Pro Max: at fixed 24/40pt padding with a 44pt amount
 * the card pushed the action buttons off the bottom of a short screen, while a
 * tall one wasted the extra room.
 */
function getGateMetrics(width: number, height: number) {
  return {
    horizontalPadding: clamp(width * 0.06, 16, 28),
    topPadding: clamp(height * 0.03, 16, 40),
    sectionGap: clamp(height * 0.019, 12, 18),
    cardPaddingVertical: clamp(height * 0.032, 18, 30),
    titleFontSize: clamp(Math.min(width * 0.072, height * 0.034), 22, 30),
    amountFontSize: clamp(Math.min(width * 0.115, height * 0.054), 32, 46),
    buttonPaddingVertical: clamp(height * 0.021, 14, 20),
  };
}

type GateMetrics = ReturnType<typeof getGateMetrics>;

export function AcceptFundingGate({ gate }: AcceptFundingGateProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const metrics = useMemo(() => getGateMetrics(windowWidth, windowHeight), [windowWidth, windowHeight]);
  const styles = useMemo(() => makeStyles(theme, metrics), [theme, metrics]);

  // The floating BottomNav is position:absolute and overlays this gate, so the
  // action footer must clear the bar's *occluded* height — the bar box plus the
  // crosshair that floats above its top edge — as well as the device safe area.
  // Same derivation as insufficient-balance-screen and add-money-screen, which
  // this component falls through to at its other two stages.
  const footerClearance =
    getBottomNavOccludedHeight(insets.bottom, windowWidth) + getBottomNavContentGap(windowHeight);

  const amount = gate.requirement?.amountRequired ?? 0;
  const shortfall = gate.requirement?.shortfall ?? 0;
  const balance = gate.requirement?.posterBalance ?? 0;

  if (gate.stage === 'topup') {
    return (
      <AddMoneyScreen
        initialAmount={shortfall.toFixed(2)}
        headerLabel="ADD FUNDS TO CONTINUE"
        primaryCtaLabel={value => `Add $${value.toFixed(2)} & Continue`}
        onBack={gate.onBackFromTopUp}
        onAddMoney={gate.onTopUpComplete}
      />
    );
  }

  if (gate.stage === 'insufficient') {
    return (
      <InsufficientBalanceScreen
        walletBalance={balance}
        bountyAmount={amount}
        onAddFunds={gate.onAddFunds}
        onEditAmount={gate.onCancel}
        onCancel={gate.onCancel}
        title="Add Funds to Accept"
        subtitle="Add funds to hold this bounty in escrow before selecting this hunter."
        editAmountLabel="Back to Applicants"
        editAmountAccessibilityLabel="Back to applicants"
      />
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + metrics.topPadding }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>SECURE THIS BOUNTY</Text>
        <Text style={styles.title}>Select {gate.hunterName}</Text>

        <View style={styles.card}>
          <Text style={styles.amount}>${amount.toFixed(2)}</Text>
          <Text style={styles.amountCaption}>charged now</Text>
        </View>

        <Text style={styles.body}>
          Your payment is held safely until the job is completed. If it doesn&apos;t work out, you
          can cancel and get it back.
        </Text>

        <View style={styles.rowGroup}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Wallet balance</Text>
            <Text style={styles.rowValue}>${balance.toFixed(2)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>After this bounty</Text>
            <Text style={styles.rowValue}>${Math.max(0, balance - amount).toFixed(2)}</Text>
          </View>
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: footerClearance }]}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Confirm and pay ${amount.toFixed(2)} dollars`}
          style={styles.primaryButton}
          onPress={gate.onConfirm}
        >
          <Text style={styles.primaryButtonText}>Confirm &amp; Pay ${amount.toFixed(2)}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back without selecting a hunter"
          style={styles.secondaryButton}
          onPress={gate.onCancel}
        >
          <Text style={styles.secondaryButtonText}>Not yet</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/** Matches the on-primary convention used across onboarding/wallet CTAs. */
const ON_PRIMARY_TEXT = '#052e1b';

const makeStyles = (theme: AppTheme, metrics: GateMetrics) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    // flexGrow so short content still fills the screen, and the ScrollView so
    // the summary scrolls rather than clipping when the text or the device
    // leaves it taller than the room above the footer.
    content: {
      flexGrow: 1,
      paddingHorizontal: metrics.horizontalPadding,
      paddingBottom: metrics.sectionGap,
      gap: metrics.sectionGap,
    },
    eyebrow: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    title: { color: theme.text, fontSize: metrics.titleFontSize, fontWeight: '800' },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: metrics.cardPaddingVertical,
      alignItems: 'center',
    },
    amount: { color: theme.text, fontSize: metrics.amountFontSize, fontWeight: '800' },
    amountCaption: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
    body: { color: theme.textSecondary, fontSize: 15, lineHeight: 22 },
    rowGroup: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
    },
    rowLabel: { color: theme.textSecondary, fontSize: 14 },
    rowValue: { color: theme.text, fontSize: 14, fontWeight: '600' },
    actions: {
      paddingHorizontal: metrics.horizontalPadding,
      paddingTop: metrics.sectionGap,
      gap: 12,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 14,
      paddingVertical: metrics.buttonPaddingVertical,
      alignItems: 'center',
    },
    primaryButtonText: { color: ON_PRIMARY_TEXT, fontSize: 16, fontWeight: '700' },
    secondaryButton: { paddingVertical: 14, alignItems: 'center' },
    secondaryButtonText: { color: theme.textSecondary, fontSize: 15, fontWeight: '600' },
  });

export default AcceptFundingGate;
