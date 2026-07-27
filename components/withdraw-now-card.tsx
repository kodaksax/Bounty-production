/**
 * Connect-native "Withdraw Now" — Phase 5.
 *
 * Shows what the user can actually withdraw right now (their Stripe Connect
 * available balance) and initiates a standard payout straight to their bank,
 * so they never have to wait on Stripe's automatic payout schedule.
 *
 * Every figure here comes from Stripe via useWalletBalanceDisplay. Nothing on
 * this screen is derived from profiles.balance.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useConnectPayout } from '../hooks/use-connect-payout';
import { useWalletBalanceDisplay } from '../hooks/use-wallet-balance-display';
import { useHapticFeedback } from '../lib/haptic-feedback';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { formatCurrencyCents } from '../lib/utils';

export interface WithdrawNowCardProps {
  /** Called after a payout is initiated so the parent can refresh balances. */
  onWithdrawComplete?: () => void;
}

/** Stripe reports arrival as epoch seconds; render it as a plain date. */
function formatArrival(arrivalDate: number | null): string {
  if (!arrivalDate) return '1-2 business days';
  try {
    return new Date(arrivalDate * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '1-2 business days';
  }
}

export function WithdrawNowCard({ onWithdrawComplete }: WithdrawNowCardProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { triggerHaptic } = useHapticFeedback();

  const balance = useWalletBalanceDisplay();
  const payout = useConnectPayout();
  const [hasRequested, setHasRequested] = useState(false);

  const availableCents = balance.amountCents;
  const canWithdraw =
    !balance.isLoading &&
    !balance.error &&
    balance.hasConnectAccount &&
    balance.payoutsEnabled &&
    availableCents > 0;

  const handleWithdraw = async () => {
    triggerHaptic('medium');
    setHasRequested(true);
    const result = await payout.withdraw({
      amountCents: availableCents,
      method: 'standard',
    });
    if (result) {
      // Stripe is authoritative — re-read rather than assuming the new balance.
      balance.refresh({ force: true });
      onWithdrawComplete?.();
    }
  };

  const handleRetry = () => {
    triggerHaptic('light');
    handleWithdraw();
  };

  // --- Loading -------------------------------------------------------------
  if (balance.isLoading) {
    return (
      <View style={s.card} accessibilityLabel="Loading available balance">
        <Text style={s.label}>AVAILABLE TO WITHDRAW</Text>
        <View style={s.amountSkeleton} />
        <View style={s.buttonSkeleton} />
      </View>
    );
  }

  // --- Completed -----------------------------------------------------------
  if (payout.phase === 'completed' && payout.result) {
    const r = payout.result;
    return (
      <View style={s.card}>
        <View style={s.statusRow}>
          <MaterialIcons name="check-circle" size={22} color={theme.success} />
          <Text style={s.statusTitle}>
            {r.duplicate ? 'Already on its way' : 'Withdrawal sent'}
          </Text>
        </View>
        <Text style={s.amountSent}>{formatCurrencyCents(r.amountCents, r.currency)}</Text>
        <Text style={s.helperText}>
          Estimated arrival: {formatArrival(r.arrivalDate)}
        </Text>
        {!!r.payoutId && (
          <Text style={s.referenceText} numberOfLines={1}>
            Reference: {r.payoutId}
          </Text>
        )}
        <TouchableOpacity
          style={s.secondaryButton}
          onPress={() => {
            payout.reset();
            setHasRequested(false);
          }}
          accessibilityRole="button"
          accessibilityLabel="Done"
        >
          <Text style={s.secondaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // --- Failed --------------------------------------------------------------
  if (payout.phase === 'failed' && payout.error) {
    return (
      <View style={s.card}>
        <View style={s.statusRow}>
          <MaterialIcons name="error-outline" size={22} color={theme.error} />
          <Text style={[s.statusTitle, { color: theme.error }]}>Withdrawal failed</Text>
        </View>
        <Text style={s.helperText}>{payout.error.message}</Text>
        <View style={s.actionRow}>
          {payout.error.retryable && (
            <TouchableOpacity
              style={s.primaryButton}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityLabel="Retry withdrawal"
            >
              <Text style={s.primaryButtonText}>Retry</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.secondaryButton}
            onPress={() => {
              payout.reset();
              setHasRequested(false);
            }}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          >
            <Text style={s.secondaryButtonText}>Dismiss</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- Balance unavailable -------------------------------------------------
  if (balance.error) {
    return (
      <View style={s.card}>
        <Text style={s.label}>AVAILABLE TO WITHDRAW</Text>
        <Text style={s.helperText}>
          We couldn&apos;t load your balance from Stripe, so withdrawals are paused.
        </Text>
        <TouchableOpacity
          style={s.primaryButton}
          onPress={() => balance.refresh({ force: true })}
          disabled={balance.isRefreshing}
          accessibilityRole="button"
          accessibilityLabel="Retry loading balance"
        >
          {balance.isRefreshing ? (
            <ActivityIndicator color="#ffffff" size="small" />
          ) : (
            <Text style={s.primaryButtonText}>Retry</Text>
          )}
        </TouchableOpacity>
      </View>
    );
  }

  // --- Not set up for payouts ----------------------------------------------
  if (!balance.hasConnectAccount || !balance.payoutsEnabled) {
    return (
      <View style={s.card}>
        <Text style={s.label}>AVAILABLE TO WITHDRAW</Text>
        <Text style={s.amount}>{formatCurrencyCents(0, balance.currency)}</Text>
        <Text style={s.helperText}>
          Finish setting up payouts before you can withdraw your earnings.
        </Text>
      </View>
    );
  }

  // --- No funds ------------------------------------------------------------
  if (availableCents <= 0) {
    return (
      <View style={s.card}>
        <Text style={s.label}>AVAILABLE TO WITHDRAW</Text>
        <Text style={s.amount}>{formatCurrencyCents(0, balance.currency)}</Text>
        {balance.pendingCents > 0 ? (
          <Text style={s.helperText}>
            {formatCurrencyCents(balance.pendingCents, balance.currency)} is still clearing and
            will become available shortly.
          </Text>
        ) : (
          <Text style={s.helperText}>
            You don&apos;t have any funds to withdraw yet. Complete a bounty to start earning.
          </Text>
        )}
      </View>
    );
  }

  // --- Ready / Processing --------------------------------------------------
  return (
    <View style={s.card}>
      <Text style={s.label}>AVAILABLE TO WITHDRAW</Text>
      <Text style={s.amount} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {formatCurrencyCents(availableCents, balance.currency)}
      </Text>

      {balance.pendingCents > 0 && (
        <Text style={s.helperText}>
          {formatCurrencyCents(balance.pendingCents, balance.currency)} still clearing
        </Text>
      )}

      <Text style={s.arrivalText}>Estimated arrival: 1-2 business days</Text>

      <TouchableOpacity
        style={[s.primaryButton, (payout.isProcessing || !canWithdraw) && s.buttonDisabled]}
        onPress={handleWithdraw}
        disabled={payout.isProcessing || !canWithdraw || hasRequested}
        accessibilityRole="button"
        accessibilityLabel={`Withdraw ${formatCurrencyCents(availableCents, balance.currency)} now`}
        accessibilityState={{ disabled: payout.isProcessing || !canWithdraw }}
      >
        {payout.isProcessing ? (
          <View style={s.processingRow}>
            <ActivityIndicator color="#ffffff" size="small" />
            <Text style={s.primaryButtonText}>Processing…</Text>
          </View>
        ) : (
          <Text style={s.primaryButtonText}>Withdraw Now</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      padding: 20,
      borderWidth: 1,
      borderColor: t.border,
      gap: 6,
    },
    label: {
      color: t.primaryLight,
      fontSize: 12,
      fontWeight: 'bold',
      textTransform: 'uppercase',
    },
    amount: {
      color: t.text,
      fontSize: 32,
      fontWeight: 'bold',
    },
    amountSent: {
      color: t.text,
      fontSize: 26,
      fontWeight: 'bold',
    },
    amountSkeleton: {
      width: 140,
      height: 32,
      borderRadius: 6,
      backgroundColor: t.border,
      marginVertical: 4,
    },
    buttonSkeleton: {
      height: 48,
      borderRadius: 12,
      backgroundColor: t.border,
      marginTop: 12,
    },
    helperText: {
      color: t.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    arrivalText: {
      color: t.textSecondary,
      fontSize: 13,
      marginTop: 2,
      marginBottom: 8,
    },
    referenceText: {
      color: t.textSecondary,
      fontSize: 11,
      marginTop: 2,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 2,
    },
    statusTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: '700',
    },
    actionRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 12,
    },
    primaryButton: {
      backgroundColor: t.primary,
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 48,
      flexGrow: 1,
    },
    primaryButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      borderRadius: 12,
      paddingVertical: 14,
      paddingHorizontal: 20,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
      minHeight: 48,
      borderWidth: 1,
      borderColor: t.border,
      flexGrow: 1,
    },
    secondaryButtonText: {
      color: t.text,
      fontSize: 16,
      fontWeight: '600',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    processingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
  });
}
