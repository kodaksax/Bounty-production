// app/(admin)/analytics.tsx - Analytics dashboard for admin panel
//
// Rewritten. This screen used to fetch
// `${EXPO_PUBLIC_API_URL || 'http://localhost:3001'}/admin/analytics/metrics`,
// a Fastify route that returned a hardcoded object behind a "TODO: Fetch real
// analytics" comment. It reported 1,250 users against a database holding 343,
// plus invented revenue figures and a fixed "top events" list. Nothing looked
// broken — the numbers were simply fiction.
//
// It also targeted the wrong backend: Supabase Edge Functions are the app's
// primary backend and the Node service is not reachable from a device, so the
// localhost fallback could never have resolved in production anyway.
//
// Now every figure comes from lib/admin/adminAnalytics.ts, counted off the
// real tables.
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminError,
  AdminErrorBanner,
  AdminLoading,
  AdminPanel,
  AdminRow,
  AdminScreen,
  AdminSection,
  formatDateTime,
  formatMoney,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAuthContext } from '../../hooks/use-auth-context';
import { adminAnalytics, type AdminAnalytics, type AdminAnalyticsWindow } from '../../lib/admin/adminAnalytics';
import { ErrorBoundary } from '../../lib/error-boundary';
import { ROUTES } from '../../lib/routes';

function AnalyticsDashboardInner() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { isAuthStale, attemptRefresh } = useAuthContext();

  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refreshing = false) => {
    refreshing ? setIsRefreshing(true) : setIsLoading(true);
    setError(null);
    try {
      setAnalytics(await adminAnalytics.fetch());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !analytics) {
    return (
      <AdminScreen>
        <AdminHeader title="Analytics" showBack backFallback={ROUTES.ADMIN.INDEX} />
        <AdminError
          title="Couldn't load analytics"
          message="The platform metrics could not be read. Check your connection and try again."
          detail={error}
          onRetry={() => load()}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader title="Analytics" showBack backFallback={ROUTES.ADMIN.INDEX} />

      {isAuthStale ? (
        <AdminErrorBanner
          message="You appear offline or your session may have expired."
          onRetry={() => attemptRefresh?.()}
        />
      ) : null}
      {error && analytics ? <AdminErrorBanner message={error} onRetry={() => load()} /> : null}

      {isLoading && !analytics ? (
        <AdminLoading label="Counting platform activity…" />
      ) : analytics ? (
        <ScrollView
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={theme.primary} />
          }
        >
          <Text
            style={{
              fontSize: 12,
              color: theme.textSecondary,
              marginBottom: theme.spacing.lg,
              lineHeight: 18,
            }}
          >
            Counted live from the database at {formatDateTime(analytics.generatedAt)}. &quot;Today&quot;
            is since local midnight; &quot;7 days&quot; is a rolling window.
          </Text>

          <AdminSection title="Users">
            <AdminPanel>
              <AdminRow label="Total accounts" value={analytics.users.total.toLocaleString()} icon="people" />
              <WindowRow label="New sign-ups" window={analytics.users.new} icon="person-add" />
              <WindowRow label="Active" window={analytics.users.active} icon="bolt" last />
            </AdminPanel>
            <Text style={[styles.note, { color: theme.textDisabled }]}>
              Active counts profiles whose most recent session falls in the window. The platform
              does not keep a per-session event table, so this is an approximation rather than a
              distinct-session count.
            </Text>
          </AdminSection>

          <AdminSection title="Bounty funnel">
            <AdminPanel>
              <WindowRow label="Posted" window={analytics.bounties.created} icon="post-add" />
              <WindowRow label="Applications" window={analytics.bounties.applications} icon="how-to-reg" />
              <WindowRow label="Accepted" window={analytics.bounties.accepted} icon="handshake" />
              <WindowRow label="Completed" window={analytics.bounties.completed} icon="check-circle" last />
            </AdminPanel>
          </AdminSection>

          <AdminSection title="Money">
            <AdminPanel>
              <WindowRow label="Escrow funded" window={analytics.money.escrowCount} icon="lock" />
              <WindowRow
                label="Escrow value"
                window={analytics.money.escrowVolume}
                icon="savings"
                money
              />
              <WindowRow
                label="Released to hunters"
                window={analytics.money.releasedVolume}
                icon="lock-open"
                money
              />
              <WindowRow
                label="Refunded"
                window={analytics.money.refundedVolume}
                icon="undo"
                money
              />
              <WindowRow
                label="Failed transactions"
                window={analytics.money.failedCount}
                icon="error-outline"
                last
              />
            </AdminPanel>
          </AdminSection>

          <AdminSection title="Messaging">
            <AdminPanel>
              <WindowRow label="Messages" window={analytics.messaging.messages} icon="chat" />
              <WindowRow
                label="Conversations started"
                window={analytics.messaging.conversations}
                icon="forum"
                last
              />
            </AdminPanel>
          </AdminSection>

          <AdminSection title="Client errors">
            {analytics.errors.available ? (
              <>
                <AdminPanel>
                  <WindowRow label="Errors logged" window={analytics.errors.count} icon="bug-report" last />
                </AdminPanel>
                {analytics.errors.top.length > 0 ? (
                  <AdminPanel>
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: theme.textSecondary,
                        letterSpacing: 0.4,
                        marginBottom: theme.spacing.sm,
                      }}
                    >
                      MOST FREQUENT (7 DAYS)
                    </Text>
                    {analytics.errors.top.map((entry, index) => (
                      <AdminRow
                        key={entry.message}
                        label={entry.message}
                        value={entry.count.toLocaleString()}
                        last={index === analytics.errors.top.length - 1}
                      />
                    ))}
                  </AdminPanel>
                ) : (
                  <AdminPanel>
                    <Text style={{ fontSize: 14, color: theme.textSecondary }}>
                      No client errors were logged in the last 7 days.
                    </Text>
                  </AdminPanel>
                )}
              </>
            ) : (
              <AdminPanel>
                <Text style={{ fontSize: 14, color: theme.textSecondary, lineHeight: 20 }}>
                  Client logs are not readable with this session. Error counts are unavailable
                  rather than shown as zero.
                </Text>
              </AdminPanel>
            )}
          </AdminSection>
        </ScrollView>
      ) : null}
    </AdminScreen>
  );
}

/** Two-column "today / 7 days" row — the shape every metric here takes. */
function WindowRow({
  label,
  window,
  icon,
  money,
  last,
}: {
  label: string;
  window: AdminAnalyticsWindow;
  icon?: React.ComponentProps<typeof AdminRow>['icon'];
  money?: boolean;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  const fmt = (n: number) => (money ? formatMoney(n) : n.toLocaleString());
  return (
    <AdminRow
      label={label}
      icon={icon}
      last={last}
      value={
        <View style={styles.windowValue}>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text }}>
              {fmt(window.today)}
            </Text>
            <Text style={{ fontSize: 10, color: theme.textDisabled }}>today</Text>
          </View>
          <View style={{ alignItems: 'flex-end', minWidth: 72 }}>
            <Text style={{ fontSize: 15, fontWeight: '600', color: theme.textSecondary }}>
              {fmt(window.week)}
            </Text>
            <Text style={{ fontSize: 10, color: theme.textDisabled }}>7 days</Text>
          </View>
        </View>
      }
    />
  );
}

export default function AnalyticsDashboard() {
  return (
    <ErrorBoundary>
      <AnalyticsDashboardInner />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  windowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  note: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
});
