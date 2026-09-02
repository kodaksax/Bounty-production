// app/(admin)/index.tsx - Admin Dashboard (operational overview)
//
// This screen used to be a 12-item horizontal carousel of undifferentiated
// icon tiles followed by two stat lists. Reaching "Disputes" meant swiping
// past six unrelated destinations, nothing indicated which areas needed
// attention, and the escrow figure was hardcoded to $0.00. It is now an
// operational overview: an "needs attention" band that only appears when a
// queue is non-empty, real headline numbers, and destinations grouped by the
// job being done.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminLoading,
  AdminMetricTile,
  AdminPanel,
  AdminScreen,
  AdminSection,
  formatMoney,
  withAlpha,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdminMetrics } from '../../hooks/useAdminMetrics';
import { useAdminPreferences } from '../../lib/admin/adminPreferences';
import { moderationClient } from '../../lib/admin/moderationClient';
import { ROUTES } from '../../lib/routes';
import type { AdminMetrics } from '../../lib/types-admin';

type IconName = keyof typeof MaterialIcons.glyphMap;

interface NavEntry {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  route: string;
}

interface NavGroup {
  title: string;
  entries: NavEntry[];
}

/**
 * Information architecture for the console, grouped by operational
 * responsibility rather than by the order the screens happened to be built in.
 */
const NAV_GROUPS: NavGroup[] = [
  {
    title: 'Overview',
    entries: [
      {
        id: 'command-center',
        title: 'Command Center',
        description: 'Live marketplace flow, money integrity and the event feed',
        icon: 'insights',
        route: ROUTES.ADMIN.COMMAND_CENTER,
      },
      {
        id: 'anomalies',
        title: 'Financial Integrity',
        description: 'Completions, releases and payouts that do not reconcile',
        icon: 'rule',
        route: ROUTES.ADMIN.ANOMALIES,
      },
    ],
  },
  {
    title: 'Marketplace',
    entries: [
      {
        id: 'bounties',
        title: 'Bounties',
        description: 'Search, filter and moderate every posted bounty',
        icon: 'work',
        route: ROUTES.ADMIN.BOUNTIES,
      },
      {
        id: 'users',
        title: 'Users',
        description: 'Accounts, verification state and moderation actions',
        icon: 'people',
        route: ROUTES.ADMIN.USERS,
      },
      {
        id: 'blocked',
        title: 'Blocked Users',
        description: 'Block relationships between accounts',
        icon: 'block',
        route: ROUTES.ADMIN.BLOCKED_USERS,
      },
    ],
  },
  {
    title: 'Money',
    entries: [
      {
        id: 'transactions',
        title: 'Transactions',
        description: 'The wallet ledger: escrow, releases, refunds, payouts',
        icon: 'account-balance',
        route: ROUTES.ADMIN.TRANSACTIONS,
      },
      {
        id: 'withdrawal-recovery',
        title: 'Withdrawal Recovery',
        description: 'Retry or manually settle stuck payouts',
        icon: 'build-circle',
        route: ROUTES.ADMIN.WITHDRAWAL_RECOVERY,
      },
      {
        id: 'balance-reconciliation',
        title: 'Balance Reconciliation',
        description: 'Compare ledger balances against Stripe',
        icon: 'sync-alt',
        route: ROUTES.ADMIN.BALANCE_RECONCILIATION,
      },
    ],
  },
  {
    title: 'Trust & Safety',
    entries: [
      {
        id: 'moderation',
        title: 'Moderation Queue',
        description: 'Flagged listings: promotional / spam detection and takedown',
        icon: 'shield',
        route: ROUTES.ADMIN.MODERATION,
      },
      {
        id: 'disputes',
        title: 'Disputes',
        description: 'Bounty disputes awaiting a decision',
        icon: 'gavel',
        route: ROUTES.ADMIN.DISPUTES,
      },
      {
        id: 'reports',
        title: 'Reports',
        description: 'User-submitted reports queue',
        icon: 'report',
        route: ROUTES.ADMIN.REPORTS,
      },
    ],
  },
  {
    title: 'Insight',
    entries: [
      {
        id: 'analytics',
        title: 'Analytics',
        description: 'Activity, conversion and revenue trends',
        icon: 'analytics',
        route: ROUTES.ADMIN.ANALYTICS,
      },
      {
        id: 'audit',
        title: 'Audit Log',
        description: 'Every recorded admin and system action',
        icon: 'history',
        route: ROUTES.ADMIN.AUDIT_LOGS,
      },
    ],
  },
  {
    title: 'Console',
    entries: [
      {
        id: 'settings',
        title: 'Settings',
        description: 'Console preferences and security',
        icon: 'settings',
        route: ROUTES.ADMIN.SETTINGS.INDEX,
      },
      {
        id: 'support',
        title: 'Support',
        description: 'Operator help and product feedback',
        icon: 'help',
        route: ROUTES.ADMIN.SUPPORT.INDEX,
      },
    ],
  },
];

/** Queues that mean "an operator has to do something", in priority order. */
function attentionItems(metrics: AdminMetrics, router: ReturnType<typeof useRouter>) {
  return [
    {
      id: 'disputes',
      count: metrics.openDisputes,
      label: 'open dispute',
      icon: 'gavel' as IconName,
      tone: 'error' as const,
      onPress: () => router.push(ROUTES.ADMIN.DISPUTES as never),
    },
    {
      id: 'failed-tx',
      count: metrics.failedTransactions,
      label: 'failed transaction',
      icon: 'error-outline' as IconName,
      tone: 'error' as const,
      onPress: () => router.push(ROUTES.ADMIN.WITHDRAWAL_RECOVERY as never),
    },
    {
      id: 'reports',
      count: metrics.pendingReports,
      label: 'pending report',
      icon: 'report' as IconName,
      tone: 'warning' as const,
      onPress: () => router.push(ROUTES.ADMIN.REPORTS as never),
    },
    {
      id: 'withdrawals',
      count: metrics.pendingWithdrawals,
      label: 'pending withdrawal',
      icon: 'payments' as IconName,
      tone: 'warning' as const,
      onPress: () => router.push(ROUTES.ADMIN.TRANSACTIONS as never),
    },
  ].filter((item) => item.count > 0);
}

export default function AdminDashboard() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { metrics, isLoading, error, refetch } = useAdminMetrics();
  const { preferences } = useAdminPreferences();

  // Auto-refresh is an operator preference (Settings -> Console preferences).
  // 0 disables it. The ref keeps the interval from being torn down and rebuilt
  // on every render just because `refetch` changed identity.
  const refetchRef = useRef(refetch);
  refetchRef.current = refetch;
  useEffect(() => {
    const seconds = preferences.autoRefreshSeconds;
    if (!seconds) return;
    const timer = setInterval(() => void refetchRef.current(), seconds * 1000);
    return () => clearInterval(timer);
  }, [preferences.autoRefreshSeconds]);

  // Moderation queue depth is fetched independently of the shared metrics
  // contract so the dashboard degrades silently if the moderation migration
  // is not applied yet.
  const [moderation, setModeration] = useState<{ openQueue: number; alerts: number }>({
    openQueue: 0,
    alerts: 0,
  });
  useEffect(() => {
    let cancelled = false;
    moderationClient
      .fetchMetrics()
      .then((m) => {
        if (!cancelled) setModeration({ openQueue: m.openQueue, alerts: m.unacknowledgedAlerts });
      })
      .catch(() => {
        if (!cancelled) setModeration({ openQueue: 0, alerts: 0 });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const attention = useMemo(() => {
    const base = metrics ? attentionItems(metrics, router) : [];
    const modItems = [
      moderation.alerts > 0 && {
        id: 'moderation-alerts',
        count: moderation.alerts,
        label: 'moderation alert',
        icon: 'notifications-active' as IconName,
        tone: 'error' as const,
        onPress: () => router.push(ROUTES.ADMIN.MODERATION as never),
      },
      moderation.openQueue > 0 && {
        id: 'moderation-queue',
        count: moderation.openQueue,
        label: 'listing to review',
        icon: 'shield' as IconName,
        tone: 'warning' as const,
        onPress: () => router.push(ROUTES.ADMIN.MODERATION as never),
      },
    ].filter(Boolean) as typeof base;
    return [...modItems, ...base];
  }, [metrics, moderation, router]);

  const go = useCallback((route: string) => router.push(route as never), [router]);

  // Hard failure with nothing to show — the only case that takes over the screen.
  if (error && !metrics) {
    return (
      <AdminScreen>
        <AdminHeader title="Dashboard" />
        <AdminError
          title="Couldn't load the dashboard"
          message="The platform metrics could not be read. This usually means the session expired or the database is unreachable."
          detail={error}
          onRetry={refetch}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader title="Dashboard" />
      {/* A refresh that fails while data is already on screen degrades to a
          banner rather than replacing good rows with an error page. */}
      {error && metrics ? <AdminErrorBanner message={error} onRetry={refetch} /> : null}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}
        refreshControl={
          <RefreshControl refreshing={isLoading && !!metrics} onRefresh={refetch} tintColor={theme.primary} />
        }
      >
        {isLoading && !metrics ? (
          <AdminLoading label="Loading platform metrics…" />
        ) : metrics ? (
          <>
            {/* ── Needs attention ─────────────────────────────────────── */}
            {attention.length > 0 ? (
              <AdminSection title="Needs attention">
                {attention.map((item) => {
                  const color = item.tone === 'error' ? theme.error : theme.warning;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      onPress={item.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.count} ${item.label}${item.count === 1 ? '' : 's'}`}
                      style={[
                        styles.attentionRow,
                        {
                          backgroundColor: withAlpha(color, 0.12),
                          borderColor: withAlpha(color, 0.35),
                          borderRadius: theme.radius.lg,
                          padding: theme.spacing.lg,
                          marginBottom: theme.spacing.sm,
                        },
                      ]}
                    >
                      <MaterialIcons name={item.icon} size={22} color={color} />
                      <Text style={[styles.attentionText, { color: theme.text }]}>
                        <Text style={{ fontWeight: '700' }}>{item.count}</Text>{' '}
                        {item.label}
                        {item.count === 1 ? '' : 's'} waiting
                      </Text>
                      <MaterialIcons name="chevron-right" size={22} color={color} />
                    </TouchableOpacity>
                  );
                })}
              </AdminSection>
            ) : (
              <AdminSection title="Needs attention">
                <AdminPanel>
                  <View style={styles.allClear}>
                    <MaterialIcons name="check-circle-outline" size={20} color={theme.success} />
                    <Text style={{ color: theme.textSecondary, fontSize: 14, flex: 1 }}>
                      No disputes, reports, failed transactions or pending withdrawals.
                    </Text>
                  </View>
                </AdminPanel>
              </AdminSection>
            )}

            {/* ── Headline numbers ────────────────────────────────────── */}
            <AdminSection title="Marketplace">
              <View style={styles.tiles}>
                <AdminMetricTile
                  label="Bounties"
                  value={metrics.totalBounties}
                  icon="work"
                  hint={`${metrics.openBounties} open · ${metrics.inProgressBounties} in progress`}
                  onPress={() => go(ROUTES.ADMIN.BOUNTIES)}
                />
                <AdminMetricTile
                  label="Users"
                  value={metrics.totalUsers}
                  icon="people"
                  onPress={() => go(ROUTES.ADMIN.USERS)}
                />
                <AdminMetricTile
                  label="Completed"
                  value={metrics.completedBounties}
                  icon="check-circle"
                  tone="success"
                />
                <AdminMetricTile
                  label="Open applications"
                  value={metrics.pendingRequests}
                  icon="how-to-reg"
                  hint="Awaiting a poster's decision"
                />
              </View>
            </AdminSection>

            <AdminSection title="Money">
              <View style={styles.tiles}>
                {/* Was hardcoded to 0. Both figures are now derived from the
                    completed wallet ledger. */}
                <AdminMetricTile
                  label="Escrow held"
                  value={formatMoney(metrics.heldEscrowVolume)}
                  icon="lock"
                  tone="warning"
                  hint="Currently held for users"
                />
                <AdminMetricTile
                  label="Escrow lifetime"
                  value={formatMoney(metrics.totalEscrowVolume)}
                  icon="savings"
                  hint="All time funded"
                />
                <AdminMetricTile
                  label="Transactions"
                  value={metrics.totalTransactions}
                  icon="receipt-long"
                  onPress={() => go(ROUTES.ADMIN.TRANSACTIONS)}
                />
                <AdminMetricTile
                  label="Failed"
                  value={metrics.failedTransactions}
                  icon="error-outline"
                  tone={metrics.failedTransactions > 0 ? 'error' : 'neutral'}
                  onPress={() => go(ROUTES.ADMIN.WITHDRAWAL_RECOVERY)}
                />
              </View>
            </AdminSection>

            {/* Bounty status breakdown. The old dashboard listed four of the
                seven statuses, so the per-status rows never summed to the
                total and cancelled/deleted bounties were invisible. */}
            <AdminSection title="Bounty status breakdown">
              <AdminPanel>
                <StatusLine label="Open" value={metrics.openBounties} total={metrics.totalBounties} />
                <StatusLine label="In progress" value={metrics.inProgressBounties} total={metrics.totalBounties} />
                <StatusLine label="Completed" value={metrics.completedBounties} total={metrics.totalBounties} />
                <StatusLine label="Archived" value={metrics.archivedBounties} total={metrics.totalBounties} />
                <StatusLine label="Cancelled" value={metrics.cancelledBounties} total={metrics.totalBounties} />
                <StatusLine label="Deleted" value={metrics.deletedBounties} total={metrics.totalBounties} last />
              </AdminPanel>
            </AdminSection>

            {/* ── Destinations, grouped by responsibility ─────────────── */}
            {NAV_GROUPS.map((group) => (
              <AdminSection key={group.title} title={group.title}>
                <AdminPanel style={{ paddingVertical: 0 }}>
                  {group.entries.map((entry, index) => (
                    <TouchableOpacity
                      key={entry.id}
                      onPress={() => go(entry.route)}
                      accessibilityRole="link"
                      accessibilityLabel={entry.title}
                      style={[
                        styles.navRow,
                        {
                          paddingVertical: theme.spacing.lg,
                          borderBottomWidth:
                            index === group.entries.length - 1 ? 0 : StyleSheet.hairlineWidth,
                          borderBottomColor: theme.border,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.navIcon,
                          { backgroundColor: withAlpha(theme.primary, 0.12), borderRadius: theme.radius.md },
                        ]}
                      >
                        <MaterialIcons name={entry.icon} size={20} color={theme.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
                          {entry.title}
                        </Text>
                        <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                          {entry.description}
                        </Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </AdminPanel>
              </AdminSection>
            ))}
          </>
        ) : (
          <AdminEmpty
            icon="query-stats"
            title="No metrics yet"
            description="Nothing has been recorded on the platform so far."
            actionLabel="Refresh"
            onAction={refetch}
          />
        )}
      </ScrollView>
    </AdminScreen>
  );
}

function StatusLine({
  label,
  value,
  total,
  last,
}: {
  label: string;
  value: number;
  total: number;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <View
      style={[
        styles.statusLine,
        {
          paddingVertical: theme.spacing.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <Text style={{ fontSize: 14, color: theme.textSecondary, width: 110 }}>{label}</Text>
      <View style={[styles.bar, { backgroundColor: theme.surfaceSecondary, borderRadius: theme.radius.full }]}>
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            backgroundColor: theme.primary,
            borderRadius: theme.radius.full,
          }}
        />
      </View>
      <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text, width: 52, textAlign: 'right' }}>
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
  },
  attentionText: { flex: 1, fontSize: 15 },
  allClear: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bar: {
    flex: 1,
    height: 6,
    overflow: 'hidden',
  },
});
