// app/(admin)/bounty/[id]/timeline.tsx — one bounty's lifecycle
//
// The actual sequence of what happened, oldest first, with every entry
// labelled by provenance:
//
//   APP EVENT            our own tables recorded a user action
//   SYSTEM EVENT         a backend job acted
//   STRIPE EVENT         observed by reading the Stripe API
//   WEBHOOK CONFIRMATION a signature-verified Stripe webhook
//   INFERRED STATE       reconstructed from surrounding state
//
// The last one matters most. `bounties` has never recorded when a bounty was
// accepted or cancelled, so those points on the timeline are reconstructed
// from `updated_at`. They are shown — an operator needs the shape of the
// story — but they are never presented as observed events, and an inferred
// financial step is never presented as a Stripe success.
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminEventRow } from '../../../../components/admin/AdminEventRow';
import { AdminHeader } from '../../../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminEmpty,
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
import {
  commandCenterClient,
  financialStatusMeta,
  isCompletedButUnverified,
} from '../../../../lib/admin/commandCenterClient';
import { ROUTES } from '../../../../lib/routes';
import type { AdminCommandBountyDetail, AdminLedgerEvent } from '../../../../lib/types-admin';

export default function AdminBountyTimelineScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [detail, setDetail] = useState<AdminCommandBountyDetail | null>(null);
  const [events, setEvents] = useState<AdminLedgerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (refreshing = false) => {
      if (!id) {
        setError('No bounty id was provided.');
        setIsLoading(false);
        return;
      }
      if (refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      try {
        const [detailResult, timelineResult] = await Promise.all([
          commandCenterClient.fetchBountyDetail(id),
          commandCenterClient.fetchBountyTimeline(id),
        ]);
        setDetail(detailResult);
        setEvents(timelineResult);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the timeline');
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [id]
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (isLoading && !detail) {
    return (
      <AdminScreen>
        <AdminHeader title="Lifecycle" showBack backFallback={ROUTES.ADMIN.BOUNTIES} />
        <AdminLoading label="Reading the event ledger…" />
      </AdminScreen>
    );
  }

  if (error || !detail) {
    return (
      <AdminScreen>
        <AdminHeader title="Lifecycle" showBack backFallback={ROUTES.ADMIN.BOUNTIES} />
        <AdminError
          title={error ? "Couldn't load this timeline" : 'Bounty not found'}
          message={
            error
              ? 'The bounty and its events could not be read.'
              : `No bounty exists with id ${shortId(id)}.`
          }
          detail={error ?? undefined}
          onRetry={error ? () => load() : undefined}
        />
      </AdminScreen>
    );
  }

  const financial = detail.financial;
  const financialMeta = financialStatusMeta(financial?.financialStatus ?? 'not_applicable');
  const splitState = isCompletedButUnverified(financial);

  return (
    <AdminScreen>
      <AdminHeader
        title="Lifecycle"
        subtitle={detail.title}
        showBack
        backFallback={ROUTES.ADMIN.BOUNTY_DETAIL(detail.id)}
      />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={theme.primary} />
        }
      >
        {/* ── The two statuses, side by side and never merged ─────────── */}
        <AdminSection title="Status">
          <View style={styles.statusPair}>
            <StatusCard
              caption="Marketplace status"
              value={detail.marketplaceStatus.replace(/_/g, ' ')}
              explanation="What the poster and hunter believe happened."
              color={theme.primary}
            />
            <StatusCard
              caption="Financial status"
              value={financialMeta.label}
              explanation={financialMeta.explanation}
              color={
                financialMeta.tone === 'success'
                  ? theme.success
                  : financialMeta.tone === 'error'
                    ? theme.error
                    : financialMeta.tone === 'warning'
                      ? theme.warning
                      : theme.textSecondary
              }
            />
          </View>
          {splitState ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
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
                COMPLETED + FINANCIAL VERIFICATION PENDING. The marketplace considers this bounty
                finished, but no signature-verified Stripe event confirms the money moved. Do not
                treat this as a settled payment.
              </Text>
            </View>
          ) : null}
        </AdminSection>

        {/* ── The record ─────────────────────────────────────────────── */}
        <AdminSection title="Bounty">
          <AdminPanel>
            <AdminRow
              label="Amount"
              value={detail.isForHonor ? 'For Honor' : formatMoney(detail.amount)}
              icon="attach-money"
            />
            {detail.category ? <AdminRow label="Category" value={detail.category} icon="label" /> : null}
            {detail.location ? (
              <AdminRow label="Location" value={detail.location} icon="location-on" />
            ) : null}
            <AdminRow label="Posted" value={formatDateTime(detail.createdAt)} icon="event" />
            {detail.deadline ? (
              <AdminRow label="Deadline" value={formatDateTime(detail.deadline)} icon="alarm" />
            ) : null}
            {detail.completedAt ? (
              <AdminRow
                label="Completed"
                value={formatDateTime(detail.completedAt)}
                icon="check-circle"
              />
            ) : null}
            <AdminRow
              label="Applications"
              value={`${detail.applicationsPending} pending of ${detail.applications}`}
              icon="how-to-reg"
            />
            <AdminRow label="Bounty ID" value={detail.id} icon="tag" mono last />
          </AdminPanel>
        </AdminSection>

        <AdminSection title="People">
          <AdminPanel style={{ paddingVertical: 0 }}>
            <AdminLinkRow
              icon="person"
              label={detail.poster?.username ?? 'Poster'}
              detail={detail.poster ? `Poster · ${detail.poster.accountStatus ?? 'active'}` : undefined}
              onPress={() =>
                detail.poster && router.push(ROUTES.ADMIN.USER_DETAIL(detail.poster.id) as never)
              }
              disabled={!detail.poster}
              disabledHint="This bounty has no poster on record"
            />
            <AdminLinkRow
              icon="handyman"
              label={detail.hunter?.username ?? 'No hunter assigned'}
              detail={detail.hunter ? `Hunter · ${detail.hunter.accountStatus ?? 'active'}` : undefined}
              onPress={() =>
                detail.hunter && router.push(ROUTES.ADMIN.USER_DETAIL(detail.hunter.id) as never)
              }
              disabled={!detail.hunter}
              disabledHint="Nobody has been accepted for this bounty yet"
              last
            />
          </AdminPanel>
        </AdminSection>

        {/* ── Money, with the confirmation state spelled out ──────────── */}
        {financial ? (
          <AdminSection title="Money">
            <AdminPanel>
              <AdminRow label="Escrow taken" value={formatMoney(financial.escrowAmount)} icon="lock" />
              <AdminRow label="Released" value={formatMoney(financial.releaseAmount)} icon="north-east" />
              <AdminRow label="Refunded" value={formatMoney(financial.refundAmount)} icon="undo" />
              <AdminRow
                label="Stripe confirmations"
                value={
                  financial.stripeConfirmed
                    ? `${financial.webhookEvents} webhook event${financial.webhookEvents === 1 ? '' : 's'}`
                    : 'None'
                }
                icon="bolt"
              />
              <AdminRow
                label="Pending ledger rows"
                value={financial.pendingLedgerCount}
                icon="hourglass-empty"
                last
              />
            </AdminPanel>
          </AdminSection>
        ) : null}

        {/* ── Moderation ─────────────────────────────────────────────── */}
        {detail.moderation.reports > 0 ||
        detail.moderation.disputes > 0 ||
        detail.moderation.warnings > 0 ||
        detail.moderation.suspiciousReasons.length > 0 ? (
          <AdminSection title="Moderation">
            <AdminPanel>
              <AdminRow
                label="Reports"
                value={`${detail.moderation.reportsOpen} open of ${detail.moderation.reports}`}
                icon="report"
              />
              <AdminRow label="Disputes" value={detail.moderation.disputes} icon="gavel" />
              <AdminRow label="Warnings issued" value={detail.moderation.warnings} icon="warning" last />
            </AdminPanel>
            {detail.moderation.suspiciousReasons.length > 0 ? (
              <View style={styles.reasons}>
                {detail.moderation.suspiciousReasons.map((reason) => (
                  <AdminBadge key={reason} label={reason.replace(/_/g, ' ')} tone="warning" icon="flag" />
                ))}
              </View>
            ) : null}
          </AdminSection>
        ) : null}

        {/* ── The sequence ───────────────────────────────────────────── */}
        <AdminSection title={`Timeline · ${events.length} event${events.length === 1 ? '' : 's'}`}>
          {events.length === 0 ? (
            <AdminEmpty
              icon="timeline"
              title="No events recorded"
              description="Nothing has been written to the event ledger for this bounty."
            />
          ) : (
            <AdminPanel style={{ paddingVertical: 0 }}>
              {events.map((event, index) => (
                <AdminEventRow
                  key={event.id}
                  event={event}
                  showBounty={false}
                  last={index === events.length - 1}
                />
              ))}
            </AdminPanel>
          )}
        </AdminSection>
      </ScrollView>
    </AdminScreen>
  );
}

function StatusCard({
  caption,
  value,
  explanation,
  color,
}: {
  caption: string;
  value: string;
  explanation: string;
  color: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={{
        flexGrow: 1,
        flexBasis: '46%',
        backgroundColor: theme.surface,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: withAlpha(color, 0.35),
        padding: theme.spacing.lg,
        gap: 4,
      }}
    >
      <Text style={{ fontSize: 11, color: theme.textSecondary, letterSpacing: 0.4 }}>
        {caption.toUpperCase()}
      </Text>
      <Text style={{ fontSize: 17, fontWeight: '700', color }}>{value}</Text>
      <Text style={{ fontSize: 12, color: theme.textSecondary, lineHeight: 17 }}>{explanation}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusPair: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
});
