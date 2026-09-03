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
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AcceptFundingGateProps {
  gate: AcceptFundingGateState;
}

export function AcceptFundingGate({ gate }: AcceptFundingGateProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

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
      <ScrollView contentContainerStyle={styles.content}>
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

      <View style={styles.actions}>
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

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    content: { padding: 24, paddingTop: 40, gap: 16 },
    eyebrow: {
      color: theme.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    title: { color: theme.text, fontSize: 28, fontWeight: '800' },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: 28,
      alignItems: 'center',
      marginTop: 8,
    },
    amount: { color: theme.text, fontSize: 44, fontWeight: '800' },
    amountCaption: { color: theme.textSecondary, fontSize: 13, marginTop: 4 },
    body: { color: theme.textSecondary, fontSize: 15, lineHeight: 22 },
    rowGroup: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 4,
      marginTop: 4,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: 12,
    },
    rowLabel: { color: theme.textSecondary, fontSize: 14 },
    rowValue: { color: theme.text, fontSize: 14, fontWeight: '600' },
    actions: { padding: 24, gap: 12 },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 14,
      paddingVertical: 16,
      alignItems: 'center',
    },
    primaryButtonText: { color: ON_PRIMARY_TEXT, fontSize: 16, fontWeight: '700' },
    secondaryButton: { paddingVertical: 14, alignItems: 'center' },
    secondaryButtonText: { color: theme.textSecondary, fontSize: 15, fontWeight: '600' },
  });

export default AcceptFundingGate;
