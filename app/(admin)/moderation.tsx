// app/(admin)/moderation.tsx — Bounty Moderation Queue
//
// Proactive queue for promotional / spam listings: what detection flagged,
// plus everything an operator needs to judge it (poster, amount, age,
// applications, application velocity, account age, related listings, reason
// flagged). Separate from app/(admin)/reports.tsx, which is the user-report
// queue. Every read/write goes through the admin_moderation_* RPCs, each of
// which re-checks the admin role server-side.
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminFilterChips,
  AdminListFooter,
  AdminLoading,
  AdminPanel,
  AdminScreen,
  formatMoney,
  formatRelative,
  withAlpha,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useModerationQueue } from '../../hooks/useModerationQueue';
import { severityTone, signalLabel, stateLabel } from '../../lib/admin/moderationClient';
import { ROUTES } from '../../lib/routes';
import { analyticsService } from '../../lib/services/analytics-service';
import {
  MODERATION_STATES,
  type AdminModerationAlert,
  type AdminModerationQueueRow,
  type AdminModerationState,
} from '../../lib/types-admin';

const FILTER_OPTIONS = ['all', ...MODERATION_STATES] as const;
type FilterOption = (typeof FILTER_OPTIONS)[number];

function stateTone(state: AdminModerationState): 'warning' | 'error' | 'success' | 'neutral' | 'info' {
  switch (state) {
    case 'flagged':
      return 'warning';
    case 'under_review':
      return 'info';
    case 'hidden':
    case 'removed':
      return 'error';
    case 'approved':
      return 'success';
    default:
      return 'neutral';
  }
}

export default function AdminModerationScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const {
    rows,
    alerts,
    metrics,
    total,
    stateFilter,
    setStateFilter,
    isLoading,
    isRefreshing,
    error,
    alertsError,
    refetch,
    acknowledgeAlert,
  } = useModerationQueue('flagged');

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const onOpenAlert = useCallback(
    (alert: AdminModerationAlert) => {
      analyticsService.trackEvent('moderation_alert_viewed', {
        threshold: alert.thresholdKey,
        severity: alert.severity,
      });
      if (alert.bountyId) {
        router.push(ROUTES.ADMIN.MODERATION_DETAIL(alert.bountyId) as never);
      }
    },
    [router]
  );

  const header = useMemo(
    () => (
      <View>
        {metrics ? (
          <View style={styles.metricStrip}>
            <MetricPill label="In queue" value={metrics.openQueue} tone="warning" theme={theme} />
            <MetricPill
              label="Legit demand"
              value={metrics.legitimateDemand}
              tone="success"
              theme={theme}
            />
            <MetricPill
              label="Suspicious demand"
              value={metrics.suspiciousDemand}
              tone="error"
              theme={theme}
            />
          </View>
        ) : null}

        {alerts.length > 0 ? (
          <View style={styles.alertBand}>
            <View style={styles.alertBandHead}>
              <MaterialIcons name="notifications-active" size={16} color={theme.error} />
              <Text style={[styles.alertBandTitle, { color: theme.text }]}>
                {alerts.length} founder alert{alerts.length === 1 ? '' : 's'}
              </Text>
            </View>
            {alerts.slice(0, 5).map((alert) => (
              <View
                key={alert.id}
                style={[
                  styles.alertRow,
                  { backgroundColor: withAlpha(theme.error, 0.08), borderColor: withAlpha(theme.error, 0.25) },
                ]}
              >
                <TouchableOpacity
                  style={styles.alertRowMain}
                  onPress={() => onOpenAlert(alert)}
                  accessibilityRole="button"
                  accessibilityLabel={alert.summary}
                >
                  <Text style={[styles.alertText, { color: theme.text }]} numberOfLines={2}>
                    {alert.summary}
                  </Text>
                  <Text style={[styles.alertMeta, { color: theme.textSecondary }]}>
                    {alert.thresholdKey} · {formatRelative(alert.createdAt)}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => acknowledgeAlert(alert.id)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Acknowledge alert"
                >
                  <MaterialIcons name="check-circle-outline" size={22} color={theme.textSecondary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}

        {alertsError ? (
          <Text style={[styles.inlineWarn, { color: theme.warning }]}>
            Alerts unavailable: {alertsError}
          </Text>
        ) : null}

        <AdminFilterChips<FilterOption>
          options={FILTER_OPTIONS}
          value={stateFilter === 'all' ? 'all' : (stateFilter as FilterOption)}
          onChange={(next) => setStateFilter(next === 'all' ? 'all' : (next as AdminModerationState))}
          labelFor={(o) => (o === 'all' ? 'All' : stateLabel(o as AdminModerationState))}
        />
      </View>
    ),
    [metrics, alerts, alertsError, stateFilter, theme, onOpenAlert, acknowledgeAlert, setStateFilter]
  );

  if (error && rows.length === 0 && !isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="Moderation Queue" backFallback={ROUTES.ADMIN.INDEX} />
        <AdminError
          title="Couldn't load the moderation queue"
          message="The queue could not be read. The moderation migration may not be applied yet, or the session expired."
          detail={error}
          onRetry={refetch}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader
        title="Moderation Queue"
        subtitle={total > 0 ? `${total.toLocaleString()} in view` : undefined}
        backFallback={ROUTES.ADMIN.INDEX}
      />
      {error && rows.length > 0 ? <AdminErrorBanner message={error} onRetry={refetch} /> : null}

      {isLoading && rows.length === 0 ? (
        <AdminLoading label="Loading moderation queue…" />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.bountyId}
          ListHeaderComponent={header}
          renderItem={({ item }) => (
            <QueueRow
              row={item}
              onPress={() => router.push(ROUTES.ADMIN.MODERATION_DETAIL(item.bountyId) as never)}
              theme={theme}
            />
          )}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={refetch} tintColor={theme.primary} />
          }
          ListEmptyComponent={
            <AdminEmpty
              icon="verified-user"
              title={stateFilter === 'flagged' ? 'Nothing flagged' : 'No listings in this state'}
              description={
                stateFilter === 'flagged'
                  ? 'Detection has not flagged any listings for review.'
                  : 'Try another state filter.'
              }
            />
          }
          ListFooterComponent={
            rows.length > 0 ? (
              <AdminListFooter
                shown={rows.length}
                total={total}
                hasMore={false}
                isLoadingMore={false}
                onLoadMore={() => {}}
                noun="listings"
              />
            ) : null
          }
        />
      )}
    </AdminScreen>
  );
}

function MetricPill({
  label,
  value,
  tone,
  theme,
}: {
  label: string;
  value: number;
  tone: 'warning' | 'success' | 'error';
  theme: ReturnType<typeof useAppTheme>['theme'];
}) {
  const color = tone === 'warning' ? theme.warning : tone === 'success' ? theme.success : theme.error;
  return (
    <View style={[styles.metricPill, { borderColor: theme.border, backgroundColor: theme.surface }]}>
      <Text style={[styles.metricValue, { color: theme.text }]}>{value.toLocaleString()}</Text>
      <Text style={[styles.metricLabel, { color }]}>{label}</Text>
    </View>
  );
}

function QueueRow({
  row,
  onPress,
  theme,
}: {
  row: AdminModerationQueueRow;
  onPress: () => void;
  theme: ReturnType<typeof useAppTheme>['theme'];
}) {
  const velocityHot = row.applicationVelocity >= 5;
  const topSignals = row.signals.slice(0, 3);
  const extraSignals = row.signals.length - topSignals.length;

  return (
    <AdminPanel onPress={onPress}>
      <View style={styles.rowHead}>
        <Text style={[styles.rowTitle, { color: theme.text }]} numberOfLines={1}>
          {row.title || 'Untitled bounty'}
        </Text>
        <AdminBadge label={stateLabel(row.state)} tone={stateTone(row.state)} />
      </View>

      <View style={styles.rowMetaLine}>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
          {row.isForHonor ? 'Honor' : formatMoney(row.amount)} · {formatRelative(row.createdAt)}
        </Text>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
          score {row.signalScore.toFixed(1)}
        </Text>
      </View>

      <View style={styles.rowMetaLine}>
        <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
          {row.posterUsername ? `@${row.posterUsername}` : 'unknown poster'}
          {row.posterAccountAgeDays != null ? ` · ${row.posterAccountAgeDays}d old` : ''}
          {row.posterRiskLevel && row.posterRiskLevel !== 'low' ? ` · risk ${row.posterRiskLevel}` : ''}
          {row.posterAccountStatus !== 'active' ? ` · ${row.posterAccountStatus}` : ''}
        </Text>
      </View>

      <View style={styles.statRow}>
        <Stat label="apps" value={row.applications} theme={theme} />
        <Stat
          label="peak/30m"
          value={row.applicationVelocity}
          theme={theme}
          tone={velocityHot ? 'error' : undefined}
        />
        <Stat label="related 7d" value={row.relatedListings} theme={theme} />
      </View>

      {topSignals.length > 0 ? (
        <View style={styles.signalWrap}>
          {topSignals.map((s) => {
            const c =
              severityTone(s.severity) === 'error'
                ? theme.error
                : severityTone(s.severity) === 'warning'
                  ? theme.warning
                  : theme.textSecondary;
            return (
              <View
                key={s.type}
                style={[styles.signalChip, { borderColor: withAlpha(c, 0.4), backgroundColor: withAlpha(c, 0.12) }]}
              >
                <Text style={[styles.signalChipText, { color: c }]}>{signalLabel(s.type)}</Text>
              </View>
            );
          })}
          {extraSignals > 0 ? (
            <Text style={[styles.moreSignals, { color: theme.textSecondary }]}>+{extraSignals}</Text>
          ) : null}
        </View>
      ) : null}

      {row.flaggedReason ? (
        <Text style={[styles.flaggedReason, { color: theme.textSecondary }]} numberOfLines={2}>
          {row.autoFlagged ? '🤖 ' : ''}
          {row.flaggedReason}
        </Text>
      ) : null}
    </AdminPanel>
  );
}

function Stat({
  label,
  value,
  theme,
  tone,
}: {
  label: string;
  value: number;
  theme: ReturnType<typeof useAppTheme>['theme'];
  tone?: 'error';
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone === 'error' ? theme.error : theme.text }]}>
        {value.toLocaleString()}
      </Text>
      <Text style={[styles.statLabel, { color: theme.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metricStrip: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  metricPill: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  metricValue: { fontSize: 18, fontWeight: '700' },
  metricLabel: { fontSize: 11, fontWeight: '600', marginTop: 2, textAlign: 'center' },

  alertBand: { marginBottom: 12, gap: 6 },
  alertBandHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  alertBandTitle: { fontSize: 13, fontWeight: '700' },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
  },
  alertRowMain: { flex: 1 },
  alertText: { fontSize: 13, fontWeight: '600' },
  alertMeta: { fontSize: 11, marginTop: 2 },
  inlineWarn: { fontSize: 12, marginBottom: 8 },

  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { flex: 1, fontSize: 15, fontWeight: '700' },
  rowMetaLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
    gap: 8,
  },
  rowMeta: { fontSize: 12, flexShrink: 1 },

  statRow: { flexDirection: 'row', gap: 18, marginTop: 10 },
  stat: { alignItems: 'flex-start' },
  statValue: { fontSize: 15, fontWeight: '700' },
  statLabel: { fontSize: 10, marginTop: 1 },

  signalWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  signalChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  signalChipText: { fontSize: 11, fontWeight: '600' },
  moreSignals: { fontSize: 11, fontWeight: '600' },

  flaggedReason: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
});
