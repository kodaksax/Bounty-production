// app/(admin)/anomalies.tsx — Financial integrity queue
//
// Everything admin_financial_anomalies() detects, grouped by class so an
// operator sees "12 withdrawals with no Stripe confirmation" rather than 12
// individually alarming rows.
//
// Read-only on purpose. Repairing a stuck payout stays on Withdrawal Recovery
// and Balance Reconciliation, where the money-moving flow and its audit trail
// already live. Adding a "fix it" button here would create a second,
// unaudited path to moving money.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminEmpty,
  AdminError,
  AdminFilterChips,
  AdminLoading,
  AdminPanel,
  AdminScreen,
  AdminSection,
  formatDateTime,
  formatMoney,
  shortId,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { commandCenterClient, compareSeverity } from '../../lib/admin/commandCenterClient';
import { ROUTES } from '../../lib/routes';
import type { AdminAnomaly, AdminAnomalySeverity } from '../../lib/types-admin';

const SEVERITY_FILTERS = ['all', 'critical', 'high', 'medium'] as const;
type SeverityFilter = (typeof SEVERITY_FILTERS)[number];

/**
 * Plain-language titles. The raw anomaly_type is still shown underneath so an
 * operator can grep the SQL for the rule that fired.
 */
const ANOMALY_TITLES: Record<string, string> = {
  completed_without_financial_record: 'Completed bounty with no financial record',
  completed_without_stripe_confirmation: 'Completed bounty Stripe never confirmed',
  financial_record_without_bounty: 'Financial record with no bounty',
  release_without_transfer: 'Release without the expected Stripe transfer',
  payout_success_without_stripe_confirmation: 'Payout marked successful without Stripe confirmation',
  stripe_payout_failure: 'Stripe payout failure',
  payout_pending_too_long: 'Payout pending too long',
  escrow_held_on_terminal_bounty: 'Escrow still held on a finished bounty',
  escrow_amount_mismatch: 'Escrow amount does not match the bounty',
  webhook_processing_failure: 'Webhook failed processing',
  webhook_unprocessed: 'Webhook never finished processing',
  duplicate_financial_record: 'Duplicate financial record',
};

function severityTone(severity: AdminAnomalySeverity) {
  return severity === 'critical' ? 'error' : severity === 'high' ? 'warning' : 'neutral';
}

export default function AdminAnomaliesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [anomalies, setAnomalies] = useState<AdminAnomaly[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [severity, setSeverity] = useState<SeverityFilter>('all');

  const load = useCallback(async (refreshing = false) => {
    if (refreshing) setIsRefreshing(true);
    else setIsLoading(true);
    try {
      setAnomalies(await commandCenterClient.fetchAnomalies(500));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load anomalies');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => (severity === 'all' ? anomalies : anomalies.filter((a) => a.severity === severity)),
    [anomalies, severity]
  );

  // Grouped by class, classes ordered by their worst finding.
  const groups = useMemo(() => {
    const byType = new Map<string, AdminAnomaly[]>();
    for (const anomaly of visible) {
      const list = byType.get(anomaly.anomalyType);
      if (list) list.push(anomaly);
      else byType.set(anomaly.anomalyType, [anomaly]);
    }
    return [...byType.entries()]
      .map(([type, items]) => ({
        type,
        items,
        worst: items.reduce<AdminAnomalySeverity>(
          (acc, item) => (compareSeverity(item.severity, acc) < 0 ? item.severity : acc),
          'low'
        ),
      }))
      .sort((a, b) => compareSeverity(a.worst, b.worst) || b.items.length - a.items.length);
  }, [visible]);

  if (error && anomalies.length === 0) {
    return (
      <AdminScreen>
        <AdminHeader title="Financial integrity" showBack backFallback={ROUTES.ADMIN.COMMAND_CENTER} />
        <AdminError
          title="Couldn't run anomaly detection"
          message="The detectors could not be executed. The event ledger migration may not have been applied to this environment yet."
          detail={error}
          onRetry={() => load()}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader
        title="Financial integrity"
        subtitle={`${anomalies.length.toLocaleString()} open finding${anomalies.length === 1 ? '' : 's'}`}
        showBack
        backFallback={ROUTES.ADMIN.COMMAND_CENTER}
      />
      <AdminFilterChips options={SEVERITY_FILTERS} value={severity} onChange={setSeverity} />

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={theme.primary} />
        }
      >
        {isLoading && anomalies.length === 0 ? (
          <AdminLoading label="Running anomaly detection…" />
        ) : groups.length === 0 ? (
          <AdminEmpty
            icon="verified"
            title="Nothing mismatched"
            description={
              severity === 'all'
                ? 'Every completed bounty, ledger row and payout reconciles.'
                : `No ${severity} findings. Try a different severity.`
            }
          />
        ) : (
          groups.map((group) => (
            <AdminSection
              key={group.type}
              title={`${ANOMALY_TITLES[group.type] ?? group.type.replace(/_/g, ' ')} · ${group.items.length}`}
            >
              <AdminPanel style={{ paddingVertical: 0 }}>
                {group.items.slice(0, 25).map((anomaly, index) => (
                  <AnomalyRow
                    key={`${anomaly.anomalyType}:${anomaly.entityId}`}
                    anomaly={anomaly}
                    last={index === Math.min(group.items.length, 25) - 1}
                    onPress={
                      anomaly.bountyId
                        ? () => router.push(ROUTES.ADMIN.BOUNTY_TIMELINE(anomaly.bountyId as string) as never)
                        : anomaly.entityType === 'wallet_transaction'
                          ? () => router.push(ROUTES.ADMIN.TRANSACTIONS as never)
                          : undefined
                    }
                  />
                ))}
              </AdminPanel>
              {group.items.length > 25 ? (
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: theme.spacing.md }}>
                  Showing the 25 most recent of {group.items.length.toLocaleString()}.
                </Text>
              ) : null}
            </AdminSection>
          ))
        )}
      </ScrollView>
    </AdminScreen>
  );
}

function AnomalyRow({
  anomaly,
  onPress,
  last,
}: {
  anomaly: AdminAnomaly;
  onPress?: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const content = (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.inline}>
          <AdminBadge label={anomaly.severity} tone={severityTone(anomaly.severity)} />
          {anomaly.amount != null ? (
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.text }}>
              {formatMoney(anomaly.amount)}
            </Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 14, color: theme.text, lineHeight: 19 }}>{anomaly.summary}</Text>
        <Text style={{ fontSize: 11, color: theme.textSecondary }}>
          {anomaly.entityType} · {shortId(anomaly.entityId)} · {formatDateTime(anomaly.detectedAt)}
        </Text>
      </View>
      {onPress ? <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} /> : null}
    </View>
  );

  if (!onPress) return content;
  return (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={anomaly.summary}>
      {content}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
