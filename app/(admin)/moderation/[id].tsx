// app/(admin)/moderation/[id].tsx — moderation review for one listing
//
// The human step of detect -> FLAG -> review -> APPROVE / HIDE / REMOVE. Shows
// the full signal breakdown with evidence, the poster's other listings, the
// application timeline and the transition history, and offers exactly the
// actions the state machine allows from the current state
// (moderation_transition_allowed in the migration is the real gate; the
// buttons here just mirror it).
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import {
  AdminBadge,
  AdminButton,
  AdminError,
  AdminLoading,
  AdminPanel,
  AdminRow,
  AdminScreen,
  AdminSection,
  formatDateTime,
  formatMoney,
  formatRelative,
  withAlpha,
} from '../../../components/admin/AdminUI';
import { useAppTheme } from '../../../hooks/use-app-theme';
import {
  classifyResolution,
  isTransitionAllowed,
  moderationClient,
  severityTone,
  signalLabel,
  stateLabel,
} from '../../../lib/admin/moderationClient';
import { ROUTES } from '../../../lib/routes';
import { analyticsService } from '../../../lib/services/analytics-service';
import type { AdminModerationDetail, AdminModerationState } from '../../../lib/types-admin';

// Canned transition reasons, written to bounty_moderation_events for the audit
// trail — every transition requires one (the RPC rejects an empty reason).
const REASONS: Record<AdminModerationState, string[]> = {
  under_review: ['Needs a closer look', 'Awaiting poster response', 'Escalated by an alert'],
  approved: [
    'Legitimate task — signals were a false positive',
    'Poster clarified the listing',
    'Reviewed, no policy violation',
  ],
  hidden: [
    'Promotional / no actionable task',
    'Off-platform contact solicitation',
    'Affiliate / referral funnel',
    'Pending poster correction',
  ],
  removed: [
    'Spam / promotional listing',
    'Crypto or affiliate promotion',
    'Repeat offender',
    'Prohibited content',
  ],
  active: ['Flag dismissed — not suspicious', 'Signals cleared after edit'],
  flagged: ['Re-flag for review', 'New signal fired'],
};

const ACTION_META: Record<
  AdminModerationState,
  { label: string; icon: keyof typeof MaterialIcons.glyphMap; variant: 'primary' | 'secondary' | 'danger' | 'warning' }
> = {
  under_review: { label: 'Start review', icon: 'visibility', variant: 'secondary' },
  approved: { label: 'Approve', icon: 'check-circle', variant: 'primary' },
  hidden: { label: 'Hide listing', icon: 'visibility-off', variant: 'warning' },
  removed: { label: 'Remove listing', icon: 'delete-forever', variant: 'danger' },
  active: { label: 'Dismiss flag', icon: 'undo', variant: 'secondary' },
  flagged: { label: 'Flag', icon: 'flag', variant: 'warning' },
};

// Order the actions are offered in.
const ACTION_ORDER: AdminModerationState[] = [
  'under_review',
  'approved',
  'hidden',
  'removed',
  'active',
  'flagged',
];

export default function ModerationDetailScreen() {
  const { theme } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const bountyId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [detail, setDetail] = useState<AdminModerationDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!bountyId) return;
    setError(null);
    try {
      const d = await moderationClient.fetchDetail(bountyId);
      setDetail(d);
      if (!d) setError('This listing was not found.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the listing.');
    } finally {
      setIsLoading(false);
    }
  }, [bountyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentState: AdminModerationState = detail?.moderation.state ?? 'active';

  const actions = useMemo(
    () => ACTION_ORDER.filter((target) => isTransitionAllowed(currentState, target)),
    [currentState]
  );

  const runTransition = useCallback(
    (target: AdminModerationState, reason: string) => {
      if (!bountyId) return;
      setBusy(true);
      moderationClient
        .transition(bountyId, target, reason)
        .then((result) => {
          analyticsService.trackEvent('moderation_action', {
            from_state: result.fromState,
            to_state: result.toState,
            reason,
            signal_score: detail?.moderation.signalScore,
            applications: detail?.applications.total,
            bounty_status: result.bountyStatus,
          });
          return load();
        })
        .catch((err) => {
          Alert.alert('Action failed', err instanceof Error ? err.message : 'Could not apply the change.');
        })
        .finally(() => setBusy(false));
    },
    [bountyId, detail, load]
  );

  const promptAction = useCallback(
    (target: AdminModerationState) => {
      const meta = ACTION_META[target];
      const reasons = REASONS[target] ?? ['Reviewed'];
      Alert.alert(
        meta.label,
        target === 'hidden' || target === 'removed'
          ? `Choose a reason. This takes the listing out of the marketplace${
              target === 'removed' ? ' (status → deleted).' : ' (status → archived).'
            }`
          : 'Choose a reason for the audit log.',
        [
          ...reasons.map((r) => ({ text: r, onPress: () => runTransition(target, r) })),
          { text: 'Cancel', style: 'cancel' as const },
        ]
      );
    },
    [runTransition]
  );

  if (isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="Review listing" backFallback={ROUTES.ADMIN.MODERATION} />
        <AdminLoading label="Loading listing…" />
      </AdminScreen>
    );
  }

  if (error || !detail) {
    return (
      <AdminScreen>
        <AdminHeader title="Review listing" backFallback={ROUTES.ADMIN.MODERATION} />
        <AdminError title="Couldn't load the listing" message={error ?? undefined} onRetry={load} />
      </AdminScreen>
    );
  }

  const { bounty, poster, moderation, signals, events, applications, relatedListings } = detail;

  return (
    <AdminScreen>
      <AdminHeader
        title="Review listing"
        subtitle={bounty.title}
        backFallback={ROUTES.ADMIN.MODERATION}
      />
      <ScrollView contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}>
        {/* ── State + actions ─────────────────────────────────────────── */}
        <AdminPanel>
          <View style={styles.stateHead}>
            <AdminBadge label={stateLabel(moderation.state)} tone={moderation.state === 'approved' ? 'success' : moderation.state === 'hidden' || moderation.state === 'removed' ? 'error' : 'warning'} />
            <Text style={[styles.score, { color: theme.textSecondary }]}>
              signal score {moderation.signalScore.toFixed(1)}
              {moderation.autoFlagged ? ' · auto-flagged' : ''}
            </Text>
          </View>
          {moderation.flaggedReason ? (
            <Text style={[styles.reasonLine, { color: theme.textSecondary }]}>{moderation.flaggedReason}</Text>
          ) : null}
          {moderation.resolution ? (
            <Text style={[styles.reasonLine, { color: theme.textSecondary }]}>
              Resolved: {moderation.resolution === 'legitimate' ? 'legitimate demand' : 'suspicious — confirmed'}
              {moderation.resolvedAt ? ` (${formatRelative(moderation.resolvedAt)})` : ''}
            </Text>
          ) : null}

          <View style={styles.actionGrid}>
            {actions.map((target) => {
              const meta = ACTION_META[target];
              const res = classifyResolution(target);
              return (
                <AdminButton
                  key={target}
                  label={meta.label}
                  icon={meta.icon}
                  variant={meta.variant}
                  disabled={busy}
                  onPress={() => promptAction(target)}
                  accessibilityLabel={`${meta.label}${res ? ` (records ${res})` : ''}`}
                  style={styles.actionBtn}
                />
              );
            })}
          </View>
          {actions.length === 0 ? (
            <Text style={[styles.reasonLine, { color: theme.textSecondary }]}>
              No further transitions available from this state.
            </Text>
          ) : null}
        </AdminPanel>

        {/* ── Listing ─────────────────────────────────────────────────── */}
        <AdminSection title="Listing">
          <AdminPanel>
            <AdminRow label="Title" value={bounty.title} />
            <AdminRow label="Amount" value={bounty.isForHonor ? 'Honor' : formatMoney(bounty.amount)} />
            <AdminRow label="Marketplace status" value={bounty.status} />
            <AdminRow label="Category" value={bounty.category ?? '—'} />
            <AdminRow label="Posted" value={formatDateTime(bounty.createdAt)} />
            <AdminRow
              label="Open bounty"
              value="View in Bounties"
              onPress={() => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(bounty.id))}
              last
            />
            {bounty.description ? (
              <Text style={[styles.description, { color: theme.text, borderColor: theme.border }]}>
                {bounty.description}
              </Text>
            ) : null}
          </AdminPanel>
        </AdminSection>

        {/* ── Poster ──────────────────────────────────────────────────── */}
        {poster ? (
          <AdminSection title="Poster">
            <AdminPanel>
              <AdminRow label="Username" value={poster.username ? `@${poster.username}` : '—'} />
              <AdminRow
                label="Account age"
                value={poster.accountAgeDays != null ? `${poster.accountAgeDays} days` : '—'}
              />
              <AdminRow label="Account status" value={poster.accountStatus} />
              <AdminRow label="Risk level" value={poster.riskLevel} />
              <AdminRow
                label="Restricted"
                value={poster.accountRestricted ? 'Yes' : 'No'}
              />
              <AdminRow
                label="Open account"
                value="View user"
                onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(poster.id))}
                last
              />
            </AdminPanel>
          </AdminSection>
        ) : null}

        {/* ── Signals ─────────────────────────────────────────────────── */}
        <AdminSection title={`Detection signals (${signals.length})`}>
          {signals.length === 0 ? (
            <AdminPanel>
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
                No detection signals on this listing — it may be here from a manual action.
              </Text>
            </AdminPanel>
          ) : (
            signals.map((s) => {
              const c =
                severityTone(s.severity) === 'error'
                  ? theme.error
                  : severityTone(s.severity) === 'warning'
                    ? theme.warning
                    : theme.textSecondary;
              return (
                <AdminPanel key={s.type}>
                  <View style={styles.signalHead}>
                    <Text style={[styles.signalTitle, { color: theme.text }]}>{signalLabel(s.type)}</Text>
                    <View style={[styles.sevChip, { backgroundColor: withAlpha(c, 0.15), borderColor: withAlpha(c, 0.4) }]}>
                      <Text style={[styles.sevChipText, { color: c }]}>
                        {s.severity.toUpperCase()} · +{s.weight}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.signalMeta, { color: theme.textSecondary }]}>
                    {s.source} · {formatRelative(s.detectedAt)}
                  </Text>
                  {Object.keys(s.evidence).length > 0 ? (
                    <Text style={[styles.evidence, { color: theme.textSecondary, borderColor: theme.border }]}>
                      {JSON.stringify(s.evidence)}
                    </Text>
                  ) : null}
                </AdminPanel>
              );
            })
          )}
        </AdminSection>

        {/* ── Applications ────────────────────────────────────────────── */}
        <AdminSection title={`Applications (${applications.total})`}>
          <AdminPanel>
            {applications.recent.length === 0 ? (
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>No applications.</Text>
            ) : (
              applications.recent.map((a, i) => (
                <AdminRow
                  key={a.id}
                  label={formatDateTime(a.createdAt)}
                  value={a.status}
                  last={i === applications.recent.length - 1}
                />
              ))
            )}
          </AdminPanel>
        </AdminSection>

        {/* ── Related listings ───────────────────────────────────────── */}
        {relatedListings.length > 0 ? (
          <AdminSection title={`Other listings from this poster (${relatedListings.length})`}>
            <AdminPanel>
              {relatedListings.map((r, i) => (
                <AdminRow
                  key={r.id}
                  label={`${r.title || 'Untitled'} · ${r.status}`}
                  value={formatRelative(r.createdAt)}
                  onPress={() => router.push(ROUTES.ADMIN.MODERATION_DETAIL(r.id) as never)}
                  last={i === relatedListings.length - 1}
                />
              ))}
            </AdminPanel>
          </AdminSection>
        ) : null}

        {/* ── History ────────────────────────────────────────────────── */}
        <AdminSection title="Moderation history">
          <AdminPanel>
            {events.length === 0 ? (
              <Text style={{ color: theme.textSecondary, fontSize: 13 }}>No transitions recorded.</Text>
            ) : (
              events.map((e, i) => (
                <View
                  key={e.id}
                  style={[
                    styles.eventRow,
                    { borderBottomColor: theme.border, borderBottomWidth: i === events.length - 1 ? 0 : StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[styles.eventLine, { color: theme.text }]}>
                    {(e.fromState ? stateLabel(e.fromState) : '—')} → {stateLabel(e.toState)}
                    <Text style={{ color: theme.textSecondary }}>{`  (${e.actor})`}</Text>
                  </Text>
                  {e.reason ? (
                    <Text style={[styles.eventMeta, { color: theme.textSecondary }]}>{e.reason}</Text>
                  ) : null}
                  <Text style={[styles.eventMeta, { color: theme.textDisabled }]}>
                    {formatDateTime(e.createdAt)}
                  </Text>
                </View>
              ))
            )}
          </AdminPanel>
        </AdminSection>
      </ScrollView>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  stateHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  score: { fontSize: 12 },
  reasonLine: { fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  actionBtn: { flexGrow: 1, flexBasis: '46%' },
  description: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  signalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  signalTitle: { fontSize: 14, fontWeight: '700', flex: 1 },
  sevChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  sevChipText: { fontSize: 10, fontWeight: '700' },
  signalMeta: { fontSize: 11, marginTop: 4 },
  evidence: {
    fontSize: 11,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  eventRow: { paddingVertical: 10 },
  eventLine: { fontSize: 13, fontWeight: '600' },
  eventMeta: { fontSize: 11, marginTop: 2 },
});
