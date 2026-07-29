/**
 * Withdrawal history as Stripe reports it (Phase 6).
 *
 * Shows the real payout lifecycle — initiated, on its way, paid, failed —
 * along with the Stripe payout id and arrival estimate, so a user asking
 * "where is my money" can answer it from this screen instead of contacting
 * support. Where our own ledger disagrees with Stripe, that is surfaced
 * rather than hidden: a silent disagreement is how stuck withdrawals went
 * unnoticed before.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  payoutStatusLabel,
  usePayoutHistory,
  type PayoutHistoryEntry,
} from '../hooks/use-payout-history';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { formatCurrencyCents } from '../lib/utils';

export interface PayoutHistorySectionProps {
  enabled?: boolean;
  limit?: number;
}

function statusIcon(status: string): keyof typeof MaterialIcons.glyphMap {
  switch (status) {
    case 'paid':
      return 'check-circle';
    case 'failed':
      return 'error-outline';
    case 'canceled':
      return 'cancel';
    case 'in_transit':
      return 'local-shipping';
    default:
      return 'schedule';
  }
}

function formatEpochDate(epochSeconds: number | null): string | null {
  if (!epochSeconds) return null;
  try {
    return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return null;
  }
}

export function PayoutHistorySection({ enabled = true, limit = 25 }: PayoutHistorySectionProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const history = usePayoutHistory({ enabled, limit });

  const statusColor = (status: string): string => {
    if (status === 'paid') return theme.success;
    if (status === 'failed' || status === 'canceled') return theme.error;
    return theme.warning;
  };

  if (!enabled) return null;

  if (history.isLoading) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Withdrawals</Text>
        {[0, 1, 2].map(i => (
          <View key={i} style={s.skeletonRow} />
        ))}
      </View>
    );
  }

  if (history.error) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Withdrawals</Text>
        <View style={s.errorCard}>
          <Text style={s.mutedText}>{history.error}</Text>
          <TouchableOpacity
            onPress={() => history.refresh({ force: true })}
            accessibilityRole="button"
            accessibilityLabel="Retry loading withdrawal history"
          >
            <Text style={s.retryText}>{history.isRefreshing ? 'Retrying…' : 'Retry'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (!history.hasConnectAccount) return null;

  if (history.payouts.length === 0) {
    return (
      <View style={s.section}>
        <Text style={s.sectionTitle}>Withdrawals</Text>
        <Text style={s.mutedText}>No withdrawals yet.</Text>
      </View>
    );
  }

  const renderRow = (p: PayoutHistoryEntry) => {
    const color = statusColor(p.status);
    const arrival = formatEpochDate(p.arrivalDate);
    const isSettled = p.status === 'paid' || p.status === 'failed' || p.status === 'canceled';

    return (
      <View key={p.payoutId} style={s.row}>
        <MaterialIcons name={statusIcon(p.status)} size={20} color={color} />
        <View style={s.rowBody}>
          <View style={s.rowTop}>
            <Text style={s.rowLabel} numberOfLines={1}>
              {payoutStatusLabel(p.status, p.method)}
              {p.method === 'instant' ? ' · Instant' : ''}
            </Text>
            <Text style={s.rowAmount}>{formatCurrencyCents(p.amountCents, p.currency)}</Text>
          </View>

          {/* Arrival estimate only while it is still meaningful — showing an
              estimate next to an already-paid payout reads as confusing. */}
          {!isSettled && arrival && <Text style={s.rowMeta}>Estimated arrival: {arrival}</Text>}
          {p.status === 'paid' && arrival && <Text style={s.rowMeta}>Arrived {arrival}</Text>}

          {p.status === 'failed' && (
            <Text style={[s.rowMeta, { color: theme.error }]} numberOfLines={2}>
              {p.failureMessage ?? p.failureCode ?? 'This payout could not be completed.'}
            </Text>
          )}

          <Text style={s.rowId} numberOfLines={1}>
            {p.payoutId}
          </Text>

          {/* Reconciliation signal. Stripe is authoritative, so this reads as
              "our records are catching up", not "your money is wrong". */}
          {(p.reconciled === false || p.statusMatchesLedger === false) && (
            <Text style={s.driftText}>Our records are still syncing for this payout.</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.section}>
      <View style={s.headerRow}>
        <Text style={s.sectionTitle}>Withdrawals</Text>
        <Text style={s.sourceNote}>from Stripe</Text>
      </View>

      {history.payouts.map(renderRow)}

      {history.unreconciled.length > 0 && (
        <Text style={s.driftText}>
          {history.unreconciled.length} older withdrawal
          {history.unreconciled.length === 1 ? '' : 's'} not shown in this range.
        </Text>
      )}
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    section: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    sectionTitle: {
      color: t.text,
      fontSize: 16,
      fontWeight: '700',
    },
    sourceNote: {
      color: t.textSecondary,
      fontSize: 11,
    },
    row: {
      flexDirection: 'row',
      gap: 10,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    rowBody: {
      flex: 1,
      gap: 2,
    },
    rowTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 8,
    },
    rowLabel: {
      color: t.text,
      fontSize: 14,
      fontWeight: '600',
      flexShrink: 1,
    },
    rowAmount: {
      color: t.text,
      fontSize: 14,
      fontWeight: '700',
    },
    rowMeta: {
      color: t.textSecondary,
      fontSize: 12,
    },
    rowId: {
      color: t.textSecondary,
      fontSize: 10,
      opacity: 0.7,
    },
    driftText: {
      color: t.warning,
      fontSize: 11,
      marginTop: 2,
    },
    mutedText: {
      color: t.textSecondary,
      fontSize: 13,
    },
    errorCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
    },
    retryText: {
      color: t.primary,
      fontSize: 13,
      fontWeight: '700',
    },
    skeletonRow: {
      height: 48,
      borderRadius: 8,
      backgroundColor: t.border,
      marginBottom: 6,
    },
  });
}
