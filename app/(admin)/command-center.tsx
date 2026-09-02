// app/(admin)/command-center.tsx — Founder Command Center
//
// The question this screen answers, in order: what is being posted, what is
// being applied for, what is being accepted, what is being completed, how much
// money is involved, whether the money ACTUALLY MOVED, whether payouts
// succeeded, whether anything is broken, and whether suspicious activity is
// rising.
//
// The existing /(admin) dashboard answers "what does the database contain".
// This one answers "what is happening, and is it real". They are different
// jobs, so this is a new screen rather than a rewrite of that one.
//
// The single design rule everywhere below: completed GMV (what the marketplace
// claims) and verified GMV (what Stripe confirms) are always shown together.
// Showing the first without the second is how an observability tool ends up
// lying to its founder.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminEventRow } from '../../components/admin/AdminEventRow';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminButton,
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminFilterChips,
  AdminLoading,
  AdminMetricTile,
  AdminPanel,
  AdminScreen,
  AdminSection,
  formatMoney,
  withAlpha,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import {
  COMMAND_CENTER_WINDOWS,
  useCommandCenter,
  type CommandCenterWindowId,
} from '../../hooks/useCommandCenter';
import { ROUTES } from '../../lib/routes';
import type { AdminAnomaly, AdminEventSource, AdminMarketplaceOverview } from '../../lib/types-admin';

const WINDOW_IDS = COMMAND_CENTER_WINDOWS.map((w) => w.id) as CommandCenterWindowId[];
const WINDOW_LABEL: Record<CommandCenterWindowId, string> = {
  '24h': 'Today',
  '7d': '7 days',
  '30d': '30 days',
};

/** Feed lenses. "Money only" is the one a founder reaches for under stress. */
const FEED_LENSES = ['all', 'money', 'marketplace', 'stripe'] as const;
type FeedLens = (typeof FEED_LENSES)[number];

const LENS_LABEL: Record<FeedLens, string> = {
  all: 'Everything',
  money: 'Money',
  marketplace: 'Marketplace',
  stripe: 'Stripe only',
};

const MONEY_EVENT_TYPES = [
  'payment.escrow_funded',
  'payment.released',
  'payment.refunded',
  'payment.deposit',
  'payment.dispute_loss',
  'payment.adjustment',
  'payout.pending',
  'payout.completed',
  'payout.failed',
  'payout.manually_paid',
  'stripe.payment_intent.succeeded',
  'stripe.payment_intent.payment_failed',
  'stripe.charge.succeeded',
  'stripe.charge.refunded',
  'stripe.transfer.created',
  'stripe.transfer.paid',
  'stripe.transfer.failed',
  'stripe.payout.created',
  'stripe.payout.paid',
  'stripe.payout.failed',
];

const MARKETPLACE_EVENT_TYPES = [
  'bounty.posted',
  'bounty.accepted',
  'bounty.in_progress',
  'bounty.completed',
  'bounty.cancelled',
  'application.submitted',
  'application.accepted',
  'application.rejected',
  'completion.submitted',
  'completion.approved',
  'completion.rejected',
];

function lensFilters(lens: FeedLens): { sources?: AdminEventSource[]; types?: string[] } {
  switch (lens) {
    case 'money':
      return { types: MONEY_EVENT_TYPES };
    case 'marketplace':
      return { types: MARKETPLACE_EVENT_TYPES };
    case 'stripe':
      return { sources: ['webhook', 'stripe'] };
    default:
      return {};
  }
}

export default function CommandCenterScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [windowId, setWindowId] = useState<CommandCenterWindowId>('24h');
  const [lens, setLens] = useState<FeedLens>('all');

  const feedFilters = useMemo(() => lensFilters(lens), [lens]);
  const {
    overview,
    events,
    anomalies,
    isLoading,
    isRefreshing,
    isLoadingMore,
    hasMoreEvents,
    error,
    feedError,
    anomalyError,
    refetch,
    loadMoreEvents,
  } = useCommandCenter(windowId, feedFilters);

  const go = useCallback((route: string) => router.push(route as never), [router]);

  const criticalAnomalies = useMemo(
    () => anomalies.filter((a) => a.severity === 'critical'),
    [anomalies]
  );

  if (error && !overview) {
    return (
      <AdminScreen>
        <AdminHeader title="Command Center" showBack backFallback={ROUTES.ADMIN.INDEX} />
        <AdminError
          title="Couldn't load the Command Center"
          message="The marketplace overview could not be read. The event ledger migration may not have been applied to this environment yet."
          detail={error}
          onRetry={refetch}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader title="Command Center" showBack backFallback={ROUTES.ADMIN.INDEX} />
      <AdminFilterChips
        options={WINDOW_IDS}
        value={windowId}
        onChange={setWindowId}
        labelFor={(id) => WINDOW_LABEL[id]}
      />
      {error && overview ? <AdminErrorBanner message={error} onRetry={refetch} /> : null}

      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={refetch} tintColor={theme.primary} />
        }
      >
        {isLoading && !overview ? (
          <AdminLoading label="Reading the event ledger…" />
        ) : overview ? (
          <>
            <MoneyIntegrityBand overview={overview} onPress={() => go(ROUTES.ADMIN.ANOMALIES)} />

            {/* ── Is anything broken? ─────────────────────────────────── */}
            <AdminSection
              title="Integrity"
              action={
                anomalies.length > 0 ? (
                  <TouchableOpacity onPress={() => go(ROUTES.ADMIN.ANOMALIES)}>
                    <Text style={{ color: theme.primary, fontSize: 13, fontWeight: '600' }}>
                      View all
                    </Text>
                  </TouchableOpacity>
                ) : undefined
              }
            >
              {anomalyError ? (
                <AdminErrorBanner message={anomalyError} onRetry={refetch} />
              ) : anomalies.length === 0 ? (
                <AdminPanel>
                  <View style={styles.inline}>
                    <MaterialIcons name="verified" size={20} color={theme.success} />
                    <Text style={{ color: theme.textSecondary, fontSize: 14, flex: 1 }}>
                      No financial mismatches detected.
                    </Text>
                  </View>
                </AdminPanel>
              ) : (
                <AdminPanel style={{ paddingVertical: 0 }}>
                  {anomalies.slice(0, 4).map((anomaly, index) => (
                    <AnomalyLine
                      key={`${anomaly.anomalyType}:${anomaly.entityId}`}
                      anomaly={anomaly}
                      last={index === Math.min(anomalies.length, 4) - 1}
                      onPress={() =>
                        anomaly.bountyId
                          ? go(ROUTES.ADMIN.BOUNTY_TIMELINE(anomaly.bountyId))
                          : go(ROUTES.ADMIN.ANOMALIES)
                      }
                    />
                  ))}
                </AdminPanel>
              )}
              {anomalies.length > 4 ? (
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginBottom: theme.spacing.md }}>
                  {anomalies.length.toLocaleString()} open finding
                  {anomalies.length === 1 ? '' : 's'}
                  {criticalAnomalies.length > 0
                    ? ` · ${criticalAnomalies.length.toLocaleString()} critical`
                    : ''}
                </Text>
              ) : null}
            </AdminSection>

            {/* ── Marketplace flow ────────────────────────────────────── */}
            <AdminSection title={`Marketplace · ${WINDOW_LABEL[windowId].toLowerCase()}`}>
              <View style={styles.tiles}>
                <AdminMetricTile
                  label="New bounties"
                  value={overview.newBounties}
                  icon="add-circle-outline"
                  onPress={() => go(ROUTES.ADMIN.BOUNTIES)}
                />
                <AdminMetricTile
                  label="Applications"
                  value={overview.applications}
                  icon="how-to-reg"
                />
                <AdminMetricTile label="Accepts" value={overview.accepts} icon="handshake" />
                <AdminMetricTile
                  label="Completions"
                  value={overview.completions}
                  icon="check-circle"
                  tone="success"
                />
                {/* First-ever post / first-ever application, not raw signups — a
                    signup that never posts tells a founder nothing. */}
                <AdminMetricTile
                  label="New posters"
                  value={overview.newPosters}
                  icon="person-add"
                  hint="First bounty ever posted"
                />
                <AdminMetricTile
                  label="New hunters"
                  value={overview.newHunters}
                  icon="person-search"
                  hint="First application ever sent"
                />
              </View>
            </AdminSection>

            {/* ── Money ───────────────────────────────────────────────── */}
            <AdminSection title="Money">
              <View style={styles.tiles}>
                <AdminMetricTile
                  label="Completed GMV"
                  value={formatMoney(overview.completedGmv)}
                  icon="trending-up"
                  hint="What the marketplace claims"
                />
                <AdminMetricTile
                  label="Verified GMV"
                  value={formatMoney(overview.verifiedGmv)}
                  icon="verified"
                  tone={overview.verifiedGmv >= overview.completedGmv ? 'success' : 'warning'}
                  hint="What Stripe confirms"
                />
                <AdminMetricTile
                  label="Escrow held"
                  value={formatMoney(overview.escrowHeld)}
                  icon="lock"
                  tone="warning"
                />
                <AdminMetricTile
                  label="Pending financial events"
                  value={overview.pendingFinancialEvents}
                  icon="hourglass-empty"
                  tone={overview.pendingFinancialEvents > 0 ? 'warning' : 'neutral'}
                  onPress={() => go(ROUTES.ADMIN.TRANSACTIONS)}
                />
                <AdminMetricTile
                  label="Payout failures"
                  value={overview.payoutFailures}
                  icon="error-outline"
                  tone={overview.payoutFailures > 0 ? 'error' : 'neutral'}
                  hint={`${overview.payoutFailuresLifetime.toLocaleString()} all time`}
                  onPress={() => go(ROUTES.ADMIN.WITHDRAWAL_RECOVERY)}
                />
                <AdminMetricTile
                  label="Unverified completions"
                  value={overview.unverifiedCompletions}
                  icon="help-outline"
                  tone={overview.unverifiedCompletions > 0 ? 'warning' : 'neutral'}
                  hint="Completed, money unconfirmed"
                  onPress={() => go(ROUTES.ADMIN.ANOMALIES)}
                />
              </View>
            </AdminSection>

            {/* ── Trust & safety ──────────────────────────────────────── */}
            <AdminSection title="Trust & safety">
              <View style={styles.tiles}>
                <AdminMetricTile
                  label="Suspicious listings"
                  value={overview.suspiciousListings}
                  icon="flag"
                  tone={overview.suspiciousListings > 0 ? 'warning' : 'neutral'}
                  onPress={() => go(ROUTES.ADMIN.REPORTS)}
                />
                <AdminMetricTile
                  label="Suspicious applications"
                  value={overview.suspiciousApplications}
                  icon="person-off"
                  tone={overview.suspiciousApplications > 0 ? 'warning' : 'neutral'}
                />
                <AdminMetricTile
                  label="Open disputes"
                  value={overview.openDisputes}
                  icon="gavel"
                  tone={overview.openDisputes > 0 ? 'error' : 'neutral'}
                  onPress={() => go(ROUTES.ADMIN.DISPUTES)}
                />
                <AdminMetricTile
                  label="Webhook backlog"
                  value={overview.unprocessedWebhooks + overview.failedWebhooks}
                  icon="cloud-off"
                  tone={overview.unprocessedWebhooks + overview.failedWebhooks > 0 ? 'error' : 'neutral'}
                  hint="Stale or failed Stripe deliveries"
                />
              </View>
            </AdminSection>

            {/* ── Live activity ───────────────────────────────────────── */}
            <AdminSection title="Live activity">
              <View style={{ marginBottom: theme.spacing.sm }}>
                <AdminFilterChips
                  options={FEED_LENSES}
                  value={lens}
                  onChange={setLens}
                  labelFor={(l) => LENS_LABEL[l]}
                />
              </View>

              {feedError ? (
                <AdminErrorBanner message={feedError} onRetry={refetch} />
              ) : events.length === 0 ? (
                <AdminEmpty
                  icon="timeline"
                  title="No events in this view"
                  description="Nothing matching this lens has been recorded yet."
                />
              ) : (
                <>
                  <AdminPanel style={{ paddingVertical: 0 }}>
                    {events.map((event, index) => (
                      <AdminEventRow
                        key={event.id}
                        event={event}
                        last={index === events.length - 1}
                        onPress={
                          event.bountyId
                            ? () => go(ROUTES.ADMIN.BOUNTY_TIMELINE(event.bountyId as string))
                            : undefined
                        }
                      />
                    ))}
                  </AdminPanel>
                  {hasMoreEvents ? (
                    <AdminButton
                      label="Load more"
                      variant="secondary"
                      loading={isLoadingMore}
                      onPress={loadMoreEvents}
                    />
                  ) : null}
                </>
              )}
            </AdminSection>
          </>
        ) : null}
      </ScrollView>
    </AdminScreen>
  );
}

/**
 * The headline the whole screen exists for: the gap between what the
 * marketplace says it transacted and what Stripe has actually confirmed.
 *
 * Under the v1 payment architecture a release is an internal wallet move with
 * no Stripe object, so this gap is expected to be large. Saying so plainly is
 * the point — an unexplained "verified GMV: $0" would read as a bug, and
 * hiding the number entirely would be worse.
 */
function MoneyIntegrityBand({
  overview,
  onPress,
}: {
  overview: AdminMarketplaceOverview;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  const gap = Math.max(0, overview.completedGmv - overview.verifiedGmv);
  const verified = gap === 0 && overview.completedGmv > 0;
  const color = verified ? theme.success : gap > 0 ? theme.warning : theme.textSecondary;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Completed GMV ${formatMoney(overview.completedGmv)}, Stripe verified ${formatMoney(overview.verifiedGmv)}`}
      style={{
        backgroundColor: withAlpha(color, 0.1),
        borderColor: withAlpha(color, 0.35),
        borderWidth: 1,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.lg,
        gap: theme.spacing.sm,
      }}
    >
      <View style={styles.inline}>
        <MaterialIcons name={verified ? 'verified' : 'rule'} size={20} color={color} />
        <Text style={{ fontSize: 15, fontWeight: '700', color: theme.text, flex: 1 }}>
          Financial verification
        </Text>
        <AdminBadge
          label={verified ? 'reconciled' : 'gap'}
          tone={verified ? 'success' : 'warning'}
        />
      </View>
      <View style={styles.splitRow}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: theme.textSecondary }}>Marketplace claims</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>
            {formatMoney(overview.completedGmv)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: theme.textSecondary }}>Stripe confirms</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color }}>
            {formatMoney(overview.verifiedGmv)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: theme.textSecondary }}>Unverified</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: gap > 0 ? theme.warning : theme.text }}>
            {formatMoney(gap)}
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 17 }}>
        {gap > 0
          ? 'Unverified money was recorded as moved by our own ledger with no matching Stripe confirmation. Under the v1 wallet architecture that is expected for internal releases — the Stripe leg happens at withdrawal.'
          : 'Every completed bounty in this window has a matching Stripe confirmation.'}
      </Text>
    </TouchableOpacity>
  );
}

function AnomalyLine({
  anomaly,
  onPress,
  last,
}: {
  anomaly: AdminAnomaly;
  onPress: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const color =
    anomaly.severity === 'critical'
      ? theme.error
      : anomaly.severity === 'high'
        ? theme.warning
        : theme.textSecondary;
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={anomaly.summary}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: theme.spacing.md,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderBottomColor: theme.border,
      }}
    >
      <MaterialIcons name="report-problem" size={18} color={color} />
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, color: theme.text }} numberOfLines={2}>
          {anomaly.summary}
        </Text>
        <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>
          {anomaly.anomalyType.replace(/_/g, ' ')}
          {anomaly.amount != null ? ` · ${formatMoney(anomaly.amount)}` : ''}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  splitRow: { flexDirection: 'row', gap: 12 },
});
