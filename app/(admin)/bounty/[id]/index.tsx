// app/(admin)/bounty/[id].tsx - Admin Bounty Detail
//
// Fixed here:
//  - The screen was a dead end. "Posted By" and "Accepted By" rendered raw
//    UUIDs as plain text with nowhere to go, and there was no route to the
//    bounty's requests, ledger, completion submission, dispute or chat.
//    Every one of those is now a link.
//  - "Accepted By" read `hunter_id`, a column that does not exist, so it never
//    rendered at all — 44 of 114 production bounties have an `accepted_by`
//    that the console could not show.
//  - The status transition map covered 4 of 7 statuses; opening a cancelled
//    or deleted bounty offered no actions and threw on the missing key.
//  - "Remove + Warn Poster" called sendWarning(), which selected a
//    non-existent `profiles.is_admin` column and therefore threw every time.
//    (Fixed in lib/admin/adminDataClient.ts.)
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminHeader } from '../../../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../../../components/admin/AdminStatusBadge';
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
  withAlpha,
} from '../../../../components/admin/AdminUI';
import { useAppTheme } from '../../../../hooks/use-app-theme';
import type { ViolationType } from '../../../../lib/admin/adminDataClient';
import { AdminModerationError, adminDataClient } from '../../../../lib/admin/adminDataClient';
import {
  commandCenterClient,
  financialStatusMeta,
  isCompletedButUnverified,
} from '../../../../lib/admin/commandCenterClient';
import { ROUTES } from '../../../../lib/routes';
import type {
  AdminBounty,
  AdminBountyFinancialSummary,
  AdminBountyRelations,
  AdminBountyStatus,
} from '../../../../lib/types-admin';

type IconName = keyof typeof MaterialIcons.glyphMap;

interface Transition {
  status: AdminBountyStatus;
  label: string;
  icon: IconName;
  /** Transitions that move money or end the engagement warrant a stronger confirm. */
  destructive?: boolean;
}

/**
 * Complete transition map — every value of bounty_status_enum has an entry.
 *
 * These are deliberately limited to lifecycle/moderation moves that do not
 * themselves settle money. Escrow release, refunds and dispute outcomes stay
 * on their own dedicated screens (Transactions, Withdrawal Recovery, Disputes)
 * where the money-moving flow and its audit trail already live; flipping a
 * bounty row to `completed` here does not release escrow and must not be
 * mistaken for doing so.
 */
const STATUS_TRANSITIONS: Record<AdminBountyStatus, Transition[]> = {
  open: [
    { status: 'in_progress', label: 'Mark in progress', icon: 'play-arrow' },
    { status: 'archived', label: 'Archive', icon: 'archive' },
    { status: 'cancelled', label: 'Cancel', icon: 'cancel', destructive: true },
  ],
  in_progress: [
    { status: 'completed', label: 'Mark completed', icon: 'check', destructive: true },
    { status: 'open', label: 'Reopen', icon: 'refresh' },
    { status: 'cancelled', label: 'Cancel', icon: 'cancel', destructive: true },
    { status: 'archived', label: 'Archive', icon: 'archive' },
  ],
  completed: [{ status: 'archived', label: 'Archive', icon: 'archive' }],
  archived: [{ status: 'open', label: 'Reopen', icon: 'refresh' }],
  cancelled: [
    { status: 'open', label: 'Reopen', icon: 'refresh' },
    { status: 'archived', label: 'Archive', icon: 'archive' },
  ],
  cancellation_requested: [
    { status: 'cancelled', label: 'Approve cancellation', icon: 'check', destructive: true },
    { status: 'in_progress', label: 'Decline, resume work', icon: 'undo' },
  ],
  deleted: [{ status: 'archived', label: 'Restore as archived', icon: 'restore_from_trash' as IconName }],
};

const VIOLATION_OPTIONS: { label: string; value: ViolationType }[] = [
  { label: 'Spam', value: 'spam' },
  { label: 'Harassment', value: 'harassment' },
  { label: 'Inappropriate Content', value: 'inappropriate_content' },
  { label: 'Fraud / Scam', value: 'fraud' },
  { label: 'Guideline Violation', value: 'guideline_violation' },
  { label: 'Other', value: 'other' },
];

export default function AdminBountyDetailScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [bounty, setBounty] = useState<AdminBounty | null>(null);
  const [relations, setRelations] = useState<AdminBountyRelations | null>(null);
  // Financial status is deliberately a separate fetch from the bounty record:
  // `bounties.status` is the MARKETPLACE status and says nothing about whether
  // money moved. Best-effort, so a missing ledger never blanks the screen.
  const [financial, setFinancial] = useState<AdminBountyFinancialSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const loadBounty = useCallback(async () => {
    if (!id) {
      setError('No bounty id was provided.');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminBountyById(id);
      setBounty(data);
      if (data) {
        // Relation counts are best-effort and must not block the record
        // itself from rendering.
        adminDataClient
          .fetchBountyRelations(id)
          .then(setRelations)
          .catch(() => setRelations(null));
        commandCenterClient
          .fetchBountyDetail(id)
          .then((detail) => setFinancial(detail?.financial ?? null))
          .catch(() => setFinancial(null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadBounty();
  }, [loadBounty]);

  const applyStatus = useCallback(
    async (next: AdminBountyStatus) => {
      if (!bounty || pendingAction != null) return;
      setPendingAction(next);
      try {
        const updated = await adminDataClient.updateBountyStatus(bounty.id, next);
        setBounty(updated);
        Alert.alert('Status updated', `This bounty is now "${next.replace(/_/g, ' ')}".`);
      } catch (err) {
        // No optimistic write happened, so there is nothing to roll back —
        // the record on screen is still the server's last known state.
        Alert.alert(
          'Update failed',
          err instanceof Error ? err.message : 'The status could not be changed.'
        );
        if (err instanceof AdminModerationError && err.code === 'BOUNTY_NOT_FOUND') {
          router.back();
        }
      } finally {
        setPendingAction(null);
      }
    },
    [bounty, pendingAction, router]
  );

  const confirmStatusChange = useCallback(
    (transition: Transition) => {
      if (!bounty) return;
      Alert.alert(
        transition.destructive ? `${transition.label}?` : 'Change status',
        transition.destructive
          ? `This changes the bounty's lifecycle state to "${transition.status.replace(/_/g, ' ')}". It does not move any money — escrow, releases and refunds are handled on the Transactions and Disputes screens.`
          : `Change this bounty's status to "${transition.status.replace(/_/g, ' ')}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: transition.label,
            style: transition.destructive ? 'destructive' : 'default',
            onPress: () => void applyStatus(transition.status),
          },
        ]
      );
    },
    [bounty, applyStatus]
  );

  const executeRemove = useCallback(
    async (violationType: ViolationType, violationLabel: string, warnPoster: boolean) => {
      // `busy` (driven by pendingAction) already disables the trigger button
      // while a removal is in flight; this guard also blocks a stray
      // re-entrant call from firing a second mutation for the same click.
      if (!bounty || pendingAction != null) return;
      setPendingAction('remove');
      try {
        const result = await adminDataClient.removeBountyForViolation(
          bounty.id,
          `Community guideline violation: ${violationLabel}`
        );
        setBounty((prev) => (prev ? { ...prev, status: result.bountyStatus } : prev));

        let warnFailed: string | null = null;
        if (warnPoster) {
          try {
            await adminDataClient.sendWarning({
              userId: bounty.user_id,
              bountyId: bounty.id,
              violationType,
              message: `Your bounty "${sanitizeMessageText(bounty.title)}" was removed for violating our community guidelines (${violationType.replace(/_/g, ' ')}). Please review our guidelines before posting again.`,
            });
          } catch (warnErr) {
            // The removal already succeeded — report the partial outcome
            // rather than a blanket failure, so the operator knows the bounty
            // is gone but the poster was not told.
            warnFailed =
              warnErr instanceof Error ? warnErr.message : 'The warning could not be delivered.';
          }
        }

        const alreadyRemoved = result.status === 'already_removed';
        Alert.alert(
          warnFailed ? 'Removed, warning failed' : alreadyRemoved ? 'Already removed' : 'Bounty removed',
          warnFailed
            ? `The bounty was removed, but the warning to the poster failed: ${warnFailed}`
            : alreadyRemoved
              ? 'This bounty was already removed — likely by another admin session. No changes were needed.'
              : warnPoster
                ? 'The bounty has been removed and a warning was sent to the poster.'
                : 'The bounty has been removed.',
          [{ text: 'OK', onPress: () => router.back() }]
        );
      } catch (err) {
        // AdminModerationError carries a safe, specific message per failure
        // mode (not admin / bounty gone / DB error); anything else falls back
        // to a generic message rather than leaking raw error text.
        const message =
          err instanceof AdminModerationError || err instanceof Error
            ? err.message
            : 'The bounty could not be removed.';
        Alert.alert('Removal failed', message);
        // A genuinely missing bounty means this screen's own record is
        // stale — nothing left here to act on.
        if (err instanceof AdminModerationError && err.code === 'BOUNTY_NOT_FOUND') {
          router.back();
        }
      } finally {
        setPendingAction(null);
      }
    },
    [bounty, pendingAction, router]
  );

  const handleRemove = useCallback(() => {
    if (!bounty) return;
    Alert.alert('Remove Bounty', 'Select the reason for removal:', [
      ...VIOLATION_OPTIONS.map(({ label, value }) => ({
        text: label,
        onPress: () =>
          Alert.alert(
            'Confirm removal',
            `Remove this bounty for "${label}"? It will be archived and hidden from the marketplace.`,
            [
              { text: 'Cancel', style: 'cancel' as const },
              { text: 'Remove + warn poster', onPress: () => void executeRemove(value, label, true) },
              {
                text: 'Remove only',
                style: 'destructive' as const,
                onPress: () => void executeRemove(value, label, false),
              },
            ]
          ),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }, [bounty, executeRemove]);

  if (isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="Bounty" showBack backFallback={ROUTES.ADMIN.BOUNTIES} />
        <AdminLoading label="Loading bounty…" />
      </AdminScreen>
    );
  }

  if (error || !bounty) {
    return (
      <AdminScreen>
        <AdminHeader title="Bounty" showBack backFallback={ROUTES.ADMIN.BOUNTIES} />
        <AdminError
          title={error ? "Couldn't load this bounty" : 'Bounty not found'}
          message={
            error
              ? 'The bounty record could not be read.'
              : `No bounty exists with id ${shortId(id)}. It may have been permanently deleted.`
          }
          detail={error}
          onRetry={error ? loadBounty : undefined}
        />
      </AdminScreen>
    );
  }

  const transitions = STATUS_TRANSITIONS[bounty.status] ?? [];
  const busy = pendingAction != null;
  // `removeBountyForViolation` drives bounties.status to 'archived' or
  // 'deleted' depending on what the live enum permits (see
  // _moderation_takedown_status in the moderation migration) — both mean the
  // same thing for this button's purposes: nothing left to remove.
  const isRemoved = bounty.status === 'archived' || bounty.status === 'deleted';

  return (
    <AdminScreen>
      <AdminHeader
        title="Bounty"
        subtitle={bounty.title}
        showBack
        backFallback={ROUTES.ADMIN.BOUNTIES}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 48 }}>
        <View style={[styles.statusRow, { marginBottom: theme.spacing.lg }]}>
          <AdminStatusBadge status={bounty.status} type="bounty" />
          {bounty.isForHonor ? <AdminBadge label="For honor" tone="info" icon="favorite" /> : null}
          {bounty.isStale ? <AdminBadge label="Stale" tone="warning" icon="schedule" /> : null}
        </View>

        <Text style={{ fontSize: 22, fontWeight: '700', color: theme.text }}>{bounty.title}</Text>
        {bounty.description ? (
          <Text
            style={{
              fontSize: 15,
              color: theme.textSecondary,
              lineHeight: 22,
              marginTop: theme.spacing.sm,
              marginBottom: theme.spacing.xl,
            }}
          >
            {bounty.description}
          </Text>
        ) : (
          <Text
            style={{
              fontSize: 14,
              color: theme.textDisabled,
              fontStyle: 'italic',
              marginTop: theme.spacing.sm,
              marginBottom: theme.spacing.xl,
            }}
          >
            No description was provided.
          </Text>
        )}

        {/* ── The record ─────────────────────────────────────────────── */}
        <AdminSection title="Details">
          <AdminPanel>
            <AdminRow
              label="Amount"
              value={bounty.isForHonor ? 'For Honor' : formatMoney(bounty.amount)}
              icon="attach-money"
            />
            {bounty.category ? <AdminRow label="Category" value={bounty.category} icon="label" /> : null}
            {bounty.location ? (
              <AdminRow label="Location" value={bounty.location} icon="location-on" />
            ) : null}
            <AdminRow label="Created" value={formatDateTime(bounty.createdAt)} icon="event" />
            {bounty.deadline ? (
              <AdminRow label="Deadline" value={formatDateTime(bounty.deadline)} icon="alarm" />
            ) : null}
            {bounty.completedAt ? (
              <AdminRow label="Completed" value={formatDateTime(bounty.completedAt)} icon="check-circle" />
            ) : null}
            <AdminRow label="Bounty ID" value={bounty.id} icon="tag" mono last />
          </AdminPanel>
        </AdminSection>

        {/* ── Financial status, kept apart from the marketplace status ─
            A bounty can be COMPLETED and still have no confirmed payment. The
            badge above is the marketplace's view; this is the money's. */}
        {financial ? (
          <AdminSection title="Financial status">
            <AdminPanel>
              <View style={styles.statusRow}>
                <AdminBadge
                  label={financialStatusMeta(financial.financialStatus).label}
                  tone={financialStatusMeta(financial.financialStatus).tone}
                  icon={financial.stripeConfirmed ? 'verified' : 'hourglass-empty'}
                />
              </View>
              <Text
                style={{
                  fontSize: 13,
                  color: theme.textSecondary,
                  lineHeight: 18,
                  marginTop: theme.spacing.sm,
                  marginBottom: theme.spacing.md,
                }}
              >
                {financialStatusMeta(financial.financialStatus).explanation}
              </Text>
              <AdminRow label="Escrow taken" value={formatMoney(financial.escrowAmount)} icon="lock" />
              <AdminRow label="Released" value={formatMoney(financial.releaseAmount)} icon="north-east" />
              <AdminRow label="Refunded" value={formatMoney(financial.refundAmount)} icon="undo" />
              <AdminRow
                label="Stripe confirmed"
                value={financial.stripeConfirmed ? 'Yes' : 'No'}
                icon="bolt"
                last
              />
            </AdminPanel>
            {isCompletedButUnverified(financial) ? (
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  padding: theme.spacing.lg,
                  borderRadius: theme.radius.lg,
                  borderWidth: 1,
                  borderColor: withAlpha(theme.warning, 0.35),
                  backgroundColor: withAlpha(theme.warning, 0.1),
                  marginBottom: theme.spacing.md,
                }}
              >
                <MaterialIcons name="warning-amber" size={20} color={theme.warning} />
                <Text style={{ flex: 1, fontSize: 13, color: theme.text, lineHeight: 18 }}>
                  COMPLETED + FINANCIAL VERIFICATION PENDING — no signature-verified Stripe event
                  confirms this bounty&apos;s money moved.
                </Text>
              </View>
            ) : null}
          </AdminSection>
        ) : null}

        {/* ── People — now navigable, previously plain-text UUIDs ─────── */}
        <AdminSection title="People">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="person"
              label={bounty.posterUsername ?? 'Poster'}
              detail={bounty.user_id ? `Poster · ${shortId(bounty.user_id)}` : undefined}
              onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(bounty.user_id) as never)}
              disabled={!bounty.user_id}
              disabledHint="This bounty has no poster on record"
            />
            <AdminLinkRow
              icon="handyman"
              label={bounty.acceptedUsername ?? (bounty.acceptedBy ? 'Hunter' : 'No hunter assigned')}
              detail={bounty.acceptedBy ? `Hunter · ${shortId(bounty.acceptedBy)}` : undefined}
              onPress={() =>
                bounty.acceptedBy &&
                router.push(ROUTES.ADMIN.USER_DETAIL(bounty.acceptedBy) as never)
              }
              disabled={!bounty.acceptedBy}
              disabledHint="Nobody has been accepted for this bounty yet"
              last
            />
          </AdminPanel>
        </AdminSection>

        {/* ── Related records ────────────────────────────────────────── */}
        <AdminSection title="Related records">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="how-to-reg"
              label="Applications"
              detail={
                relations
                  ? `${relations.pendingRequestCount} pending of ${relations.requestCount}`
                  : 'Loading…'
              }
              count={relations?.requestCount}
              onPress={() =>
                router.push(`${ROUTES.ADMIN.BOUNTY_REQUESTS(bounty.id)}` as never)
              }
              disabledHint="No hunter has applied to this bounty"
            />
            <AdminLinkRow
              icon="receipt-long"
              label="Transactions"
              detail="Escrow, releases and refunds for this bounty"
              count={relations?.transactionCount}
              onPress={() =>
                router.push(`${ROUTES.ADMIN.TRANSACTIONS}?bountyId=${bounty.id}` as never)
              }
              disabledHint="No money has moved for this bounty"
            />
            <AdminLinkRow
              icon="assignment-turned-in"
              label="Completion submissions"
              detail="Proof of work submitted by the hunter"
              count={relations?.completionSubmissionCount}
              onPress={() =>
                router.push(`${ROUTES.ADMIN.BOUNTY_COMPLETIONS(bounty.id)}` as never)
              }
              disabledHint="Nothing has been submitted for review"
            />
            <AdminLinkRow
              icon="timeline"
              label="Lifecycle timeline"
              detail="Every recorded event, with its provenance"
              onPress={() => router.push(ROUTES.ADMIN.BOUNTY_TIMELINE(bounty.id) as never)}
            />
            <AdminLinkRow
              icon="gavel"
              label="Disputes"
              detail="Open or resolved disputes on this bounty"
              count={relations?.disputeCount}
              onPress={() =>
                relations?.openDisputeId
                  ? router.push(ROUTES.ADMIN.DISPUTE_DETAIL(relations.openDisputeId) as never)
                  : router.push(ROUTES.ADMIN.DISPUTES as never)
              }
              disabledHint="This bounty has never been disputed"
              last
            />
          </AdminPanel>
        </AdminSection>

        {/* ── Lifecycle actions ──────────────────────────────────────── */}
        <AdminSection title="Status actions">
          {transitions.length === 0 ? (
            <AdminPanel>
              <Text style={{ color: theme.textSecondary, fontSize: 14 }}>
                No status changes are available from &quot;{bounty.status.replace(/_/g, ' ')}&quot;.
              </Text>
            </AdminPanel>
          ) : (
            <View style={styles.actions}>
              {transitions.map((transition) => (
                <AdminButton
                  key={transition.status}
                  label={transition.label}
                  icon={transition.icon}
                  variant={transition.destructive ? 'warning' : 'secondary'}
                  loading={pendingAction === transition.status}
                  disabled={busy && pendingAction !== transition.status}
                  onPress={() => confirmStatusChange(transition)}
                  style={styles.actionButton}
                />
              ))}
            </View>
          )}
          <Text
            style={{
              fontSize: 12,
              color: theme.textSecondary,
              marginTop: theme.spacing.sm,
              lineHeight: 18,
            }}
          >
            Status changes affect the bounty lifecycle only. They never move escrow — use
            Transactions or Disputes to settle money.
          </Text>
        </AdminSection>

        {/* ── Moderation ─────────────────────────────────────────────── */}
        <AdminSection title="Community guidelines">
          <AdminButton
            label={isRemoved ? 'Already removed' : 'Remove for violation'}
            icon="gavel"
            variant="danger"
            loading={pendingAction === 'remove'}
            disabled={busy || isRemoved}
            onPress={handleRemove}
          />
        </AdminSection>
      </ScrollView>
    </AdminScreen>
  );
}

/**
 * Strip control characters and clamp the length before a bounty title is
 * embedded in a message delivered to a user.
 */
function sanitizeMessageText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

const styles = StyleSheet.create({
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
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
