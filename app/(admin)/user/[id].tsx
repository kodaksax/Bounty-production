// app/(admin)/user/[id].tsx - Admin User Detail
//
// Fixed here:
//  - "Activity Stats" and "Financial Summary" rendered five hardcoded zeros
//    for every user, because they were read from `profiles.bounties_posted`,
//    `.total_spent` etc. — columns that have never existed. They now come from
//    a real server-side aggregate, and show "—" if that aggregate is
//    unavailable rather than reintroducing the fake zeros.
//  - The screen was a dead end: no route to the user's bounties, ledger or
//    disputes. All three are now links.
//  - "Send Warning" called sendWarning(), which selected a non-existent
//    `profiles.is_admin` column and therefore failed on every invocation.
//    (Fixed in lib/admin/adminDataClient.ts.)
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../../components/admin/AdminStatusBadge';
import {
  AdminBadge,
  AdminButton,
  AdminError,
  AdminLinkRow,
  AdminLoading,
  AdminPanel,
  AdminRow,
  AdminScreen,
  AdminSection,
  formatDateTime,
  formatMoney,
  shortId,
} from '../../../components/admin/AdminUI';
import { useAppTheme } from '../../../hooks/use-app-theme';
import type { ViolationType } from '../../../lib/admin/adminDataClient';
import { adminDataClient } from '../../../lib/admin/adminDataClient';
import { ROUTES } from '../../../lib/routes';
import type { AdminUserSummary } from '../../../lib/types-admin';

const VIOLATION_OPTIONS: { label: string; value: ViolationType }[] = [
  { label: 'Spam', value: 'spam' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Inappropriate Content', value: 'inappropriate_content' },
  { label: 'Fraud / Scam', value: 'fraud' },
  { label: 'Guideline Violation', value: 'guideline_violation' },
  { label: 'Other', value: 'other' },
];

// Every account_status change requires a reason, written to admin_action_log
// for audit purposes -- see 20260726000000_enforce_account_status.sql.
const STATUS_CHANGE_REASONS = [
  'Spam',
  'Harassment',
  'Fraud / Scam',
  'Inappropriate Content',
  'Guideline Violation',
  'Other',
];

export default function AdminUserDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [user, setUser] = useState<AdminUserSummary | null>(null);
  const [breakdown, setBreakdown] = useState<{
    posted: number;
    hunting: number;
    activeAsPoster: number;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    if (!id) {
      setError('No user id was provided.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminUserById(id);
      setUser(data);
      if (data) {
        adminDataClient
          .fetchUserBountyBreakdown(id)
          .then(setBreakdown)
          .catch(() => setBreakdown(null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const submitWarning = useCallback(
    async (violationType: ViolationType, reasonLabel: string) => {
      if (!user) return;
      setPendingAction('warn');
      try {
        await adminDataClient.sendWarning({
          userId: user.id,
          violationType,
          message: `Your account has received a warning for: ${reasonLabel}. Please review our community guidelines to avoid further action.`,
        });
        Alert.alert('Warning sent', `A warning was recorded against @${user.username}.`);
      } catch (err) {
        Alert.alert(
          'Warning not sent',
          err instanceof Error ? err.message : 'The warning could not be recorded.'
        );
      } finally {
        setPendingAction(null);
      }
    },
    [user]
  );

  const handleSendWarning = useCallback(() => {
    if (!user) return;
    Alert.alert('Send warning', `Select a reason to warn @${user.username}:`, [
      ...VIOLATION_OPTIONS.map(({ label, value }) => ({
        text: label,
        onPress: () => void submitWarning(value, label),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [user, submitWarning]);

  const submitStatusChange = useCallback(
    async (status: AdminUserSummary['status'], reason: string, verb: string) => {
      if (!user) return;
      setPendingAction(status);
      try {
        await adminDataClient.updateUserStatus(user.id, status, reason);
        // Only reflect the new status once the server confirmed it -- an
        // optimistic flip here would leave an operator believing a ban landed
        // when the Edge Function rejected it.
        setUser((prev) => (prev ? { ...prev, status } : prev));
        Alert.alert(`User ${verb}`, `@${user.username} has been ${verb.toLowerCase()}.`);
      } catch (err) {
        Alert.alert(
          'Action failed',
          err instanceof Error ? err.message : 'The account status could not be changed.'
        );
      } finally {
        setPendingAction(null);
      }
    },
    [user]
  );

  const promptStatusChange = useCallback(
    (status: AdminUserSummary['status'], title: string, body: string, verb: string) => {
      if (!user) return;
      Alert.alert(title, body, [
        ...STATUS_CHANGE_REASONS.map((reason) => ({
          text: reason,
          onPress: () => void submitStatusChange(status, reason, verb),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [user, submitStatusChange]
  );

  if (isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="User" showBack backFallback={ROUTES.ADMIN.USERS} />
        <AdminLoading label="Loading user…" />
      </AdminScreen>
    );
  }

  if (error || !user) {
    return (
      <AdminScreen>
        <AdminHeader title="User" showBack backFallback={ROUTES.ADMIN.USERS} />
        <AdminError
          title={error ? "Couldn't load this user" : 'User not found'}
          message={
            error
              ? 'The account could not be read. This is served by the admin-profiles function, which requires an admin session.'
              : `No account exists with id ${shortId(id)}.`
          }
          detail={error}
          onRetry={error ? loadUser : undefined}
        />
      </AdminScreen>
    );
  }

  const busy = pendingAction != null;
  const verified = user.verificationStatus === 'verified' || user.verificationStatus === 'trusted';
  const stat = (value: number) => (user.statsLoaded ? value.toLocaleString() : '—');
  const money = (value: number) => (user.statsLoaded ? formatMoney(value) : '—');

  return (
    <AdminScreen>
      <AdminHeader
        title="User"
        subtitle={user.username}
        showBack
        backFallback={ROUTES.ADMIN.USERS}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        <View style={[styles.badgeRow, { marginBottom: theme.spacing.lg }]}>
          <AdminStatusBadge status={user.status} type="user" />
          <AdminBadge
            label={user.verificationStatus ?? 'unverified'}
            tone={verified ? 'success' : 'warning'}
            icon={verified ? 'verified' : 'pending'}
          />
          {user.balanceFrozen ? <AdminBadge label="Balance frozen" tone="info" icon="ac-unit" /> : null}
          {user.deletedAt ? <AdminBadge label="Deleted" tone="error" icon="delete" /> : null}
        </View>

        <Text style={{ fontSize: 24, fontWeight: '700', color: theme.text }}>{user.username}</Text>
        {user.displayName && user.displayName !== user.username ? (
          <Text style={{ fontSize: 15, color: theme.textSecondary, marginTop: 2 }}>
            {user.displayName}
          </Text>
        ) : null}
        {user.email ? (
          <Text style={{ fontSize: 14, color: theme.textSecondary, marginTop: 2 }}>{user.email}</Text>
        ) : null}

        {user.restrictionReason ? (
          <View
            style={{
              marginTop: theme.spacing.lg,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.surfaceSecondary,
              borderLeftWidth: 3,
              borderLeftColor: theme.warning,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.warning }}>RESTRICTED</Text>
            <Text style={{ fontSize: 14, color: theme.text, marginTop: 4 }}>
              {user.restrictionReason}
            </Text>
          </View>
        ) : null}

        {/* ── Activity ────────────────────────────────────────────────── */}
        <AdminSection title="Activity" style={{ marginTop: theme.spacing.xl }}>
          {!user.statsLoaded ? (
            <View style={{ marginBottom: theme.spacing.sm }}>
              <Text style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 18 }}>
                Activity totals are unavailable for this environment. They are computed by the
                admin_user_stats database function; if it has not been deployed here, these show as
                em dashes rather than zeros.
              </Text>
            </View>
          ) : null}
          <View style={styles.statGrid}>
            <StatCard icon="post-add" value={stat(user.bountiesPosted)} label="Posted" />
            <StatCard icon="assignment-turned-in" value={stat(user.bountiesAccepted)} label="Accepted" />
            <StatCard icon="check-circle" value={stat(user.bountiesCompleted)} label="Completed" />
          </View>
        </AdminSection>

        {/* ── Money ───────────────────────────────────────────────────── */}
        <AdminSection title="Financials">
          <AdminPanel>
            <AdminRow label="Current balance" value={formatMoney(user.balance)} icon="account-balance-wallet" />
            <AdminRow label="On hold" value={formatMoney(user.balanceOnHold)} icon="lock" />
            <AdminRow label="Total spent" value={money(user.totalSpent)} icon="trending-down" />
            <AdminRow label="Total earned" value={money(user.totalEarned)} icon="trending-up" />
            <AdminRow
              label="Payouts enabled"
              value={user.payoutsEnabled == null ? '—' : user.payoutsEnabled ? 'Yes' : 'No'}
              icon="payments"
            />
            <AdminRow
              label="Stripe account"
              value={user.stripeConnectAccountId ?? 'Not connected'}
              icon="link"
              mono={!!user.stripeConnectAccountId}
              last
            />
          </AdminPanel>
        </AdminSection>

        {/* ── Related records — the screen used to have none of these ─── */}
        <AdminSection title="Related records">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="work"
              label="Bounties posted"
              detail={
                breakdown
                  ? `${breakdown.activeAsPoster} currently active`
                  : 'Bounties this user posted'
              }
              count={breakdown?.posted}
              onPress={() =>
                router.push(`${ROUTES.ADMIN.BOUNTIES}?posterId=${user.id}` as never)
              }
              disabledHint="This user has never posted a bounty"
            />
            <AdminLinkRow
              icon="handyman"
              label="Bounties hunting"
              detail="Bounties this user was accepted for"
              count={breakdown?.hunting}
              onPress={() =>
                router.push(`${ROUTES.ADMIN.BOUNTIES}?hunterId=${user.id}` as never)
              }
              disabledHint="This user has never been accepted for a bounty"
            />
            <AdminLinkRow
              icon="receipt-long"
              label="Transactions"
              detail="Every ledger entry on either side"
              onPress={() =>
                router.push(`${ROUTES.ADMIN.TRANSACTIONS}?userId=${user.id}` as never)
              }
            />
            <AdminLinkRow
              icon="gavel"
              label="Disputes"
              detail="Disputes involving this user"
              onPress={() => router.push(ROUTES.ADMIN.DISPUTES as never)}
            />
            <AdminLinkRow
              icon="history"
              label="Audit trail"
              detail="Admin actions taken on this account"
              onPress={() => router.push(ROUTES.ADMIN.AUDIT_LOGS as never)}
              last
            />
          </AdminPanel>
        </AdminSection>

        {/* ── Account ─────────────────────────────────────────────────── */}
        <AdminSection title="Account">
          <AdminPanel>
            <AdminRow label="User ID" value={user.id} icon="tag" mono />
            <AdminRow label="Joined" value={formatDateTime(user.joinDate)} icon="event" />
            <AdminRow label="Last seen" value={formatDateTime(user.lastSeenAt)} icon="schedule" />
            <AdminRow label="Status" value={user.status} icon="badge" last />
          </AdminPanel>
        </AdminSection>

        {/* ── Moderation ──────────────────────────────────────────────── */}
        <AdminSection title="Moderation">
          <View style={styles.actions}>
            <AdminButton
              label="Send warning"
              icon="warning"
              variant="secondary"
              loading={pendingAction === 'warn'}
              disabled={busy && pendingAction !== 'warn'}
              onPress={handleSendWarning}
              style={styles.actionButton}
            />
            {user.status === 'active' ? (
              <AdminButton
                label="Suspend"
                icon="pause-circle-filled"
                variant="warning"
                loading={pendingAction === 'suspended'}
                disabled={busy && pendingAction !== 'suspended'}
                onPress={() =>
                  promptStatusChange(
                    'suspended',
                    'Suspend user',
                    `Select a reason to suspend @${user.username}. They lose access until restored.`,
                    'Suspended'
                  )
                }
                style={styles.actionButton}
              />
            ) : null}
            {user.status !== 'banned' ? (
              <AdminButton
                label="Ban"
                icon="block"
                variant="danger"
                loading={pendingAction === 'banned'}
                disabled={busy && pendingAction !== 'banned'}
                onPress={() =>
                  promptStatusChange(
                    'banned',
                    'Ban user',
                    `Select a reason to ban @${user.username}. This permanently blocks their access.`,
                    'Banned'
                  )
                }
                style={styles.actionButton}
              />
            ) : null}
            {user.status === 'suspended' || user.status === 'banned' ? (
              <AdminButton
                label="Restore"
                icon="restore"
                variant="primary"
                loading={pendingAction === 'active'}
                disabled={busy && pendingAction !== 'active'}
                onPress={() =>
                  promptStatusChange(
                    'active',
                    'Restore user',
                    `Select a reason to restore @${user.username} to full access.`,
                    'Restored'
                  )
                }
                style={styles.actionButton}
              />
            ) : null}
          </View>
          <Text
            style={{
              fontSize: 12,
              color: theme.textSecondary,
              marginTop: theme.spacing.sm,
              lineHeight: 18,
            }}
          >
            Every status change requires a reason and is recorded in the admin action log. The
            change is applied by a service-role function that re-verifies your admin role
            server-side.
          </Text>
        </AdminSection>
      </ScrollView>
    </AdminScreen>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  value: string;
  label: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        backgroundColor: theme.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.border,
        paddingVertical: theme.spacing.lg,
        gap: 6,
      }}
    >
      <MaterialIcons name={icon} size={26} color={theme.primary} />
      <Text style={{ fontSize: 20, fontWeight: '700', color: theme.text }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.textSecondary }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  statGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flexGrow: 1,
    flexBasis: '46%',
  },
});
