// app/admin/review-queue.tsx — support queue for stalled bounties (trust-spine T6 / T22)
//
// Work that waited 72h on the poster, and every dispute (including a poster's
// "Hunter hasn't responded"). Items close themselves when the poster acts or a
// dispute is ruled on; this screen records that support contacted someone, or
// how support settled it. Moving money stays in the dispute screen.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminLoading,
  AdminScreen,
  formatMoney,
  formatRelative,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import {
  TRUST_REVIEW_RESOLUTION_LABELS,
  describeTrustReviewItem,
  fetchTrustReviewQueue,
  updateTrustReviewItem,
  type TrustReviewAdminResolution,
  type TrustReviewItem,
} from '../../lib/admin/trustReviewQueueClient';
import { ROUTES } from '../../lib/routes';

export default function AdminReviewQueueScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const [items, setItems] = useState<TrustReviewItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setIsRefreshing(true);
    try {
      setItems(await fetchTrustReviewQueue(false));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = useCallback(
    async (item: TrustReviewItem, status: 'contacted' | 'resolved', resolution?: TrustReviewAdminResolution) => {
      try {
        await updateTrustReviewItem(item.id, status, resolution);
        await load();
      } catch (e) {
        Alert.alert("Couldn't update", e instanceof Error ? e.message : String(e));
      }
    },
    [load]
  );

  const resolve = useCallback(
    (item: TrustReviewItem) => {
      const options = (Object.keys(TRUST_REVIEW_RESOLUTION_LABELS) as TrustReviewAdminResolution[]).map((r) => ({
        text: TRUST_REVIEW_RESOLUTION_LABELS[r],
        onPress: () => update(item, 'resolved', r),
      }));
      Alert.alert(
        'How was this settled?',
        'Record the outcome only after the money moved (or didn\'t need to). Resolving here does not release or refund anything.',
        [...options, { text: 'Cancel', style: 'cancel' }]
      );
    },
    [update]
  );

  if (error && items.length === 0 && !isLoading) {
    return (
      <AdminScreen>
        <AdminHeader title="Review Queue" showBack backFallback={ROUTES.ADMIN.INDEX} />
        <AdminError
          title="Couldn't load the review queue"
          message="admin_trust_review_queue() could not be executed. The review-window migration may not be applied to this environment yet."
          detail={error}
          onRetry={() => load()}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader
        title="Review Queue"
        subtitle={`${items.length} open item${items.length === 1 ? '' : 's'}`}
        showBack
        backFallback={ROUTES.ADMIN.INDEX}
      />
      {error && items.length > 0 ? <AdminErrorBanner message={error} onRetry={() => load()} /> : null}
      {isLoading ? (
        <AdminLoading label="Loading the review queue…" />
      ) : items.length === 0 ? (
        <AdminEmpty
          icon="task-alt"
          title="Nothing waiting"
          description="No submission has passed its 72-hour review window, and no dispute is open."
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64, gap: 12 }}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => load(true)} tintColor={theme.primary} />
          }
          renderItem={({ item }) => (
            <QueueRow
              item={item}
              onViewBounty={item.bountyId ? () => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(item.bountyId!) as never) : undefined}
              onViewDispute={item.disputeId != null ? () => router.push(ROUTES.ADMIN.DISPUTE_DETAIL(item.disputeId!) as never) : undefined}
              onMessage={(userId) => router.push(ROUTES.MESSAGES.WITH_USER(userId) as never)}
              onContacted={item.status === 'open' ? () => update(item, 'contacted') : undefined}
              onResolve={() => resolve(item)}
            />
          )}
        />
      )}
    </AdminScreen>
  );
}

function hoursLabel(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? `${Math.round(n)}h` : null;
}

function QueueRow({
  item,
  onViewBounty,
  onViewDispute,
  onMessage,
  onContacted,
  onResolve,
}: {
  item: TrustReviewItem;
  onViewBounty?: () => void;
  onViewDispute?: () => void;
  onMessage: (userId: string) => void;
  onContacted?: () => void;
  onResolve: () => void;
}) {
  const { theme } = useAppTheme();
  const sinceAccept = hoursLabel(item.facts.hours_since_acceptance);
  const hunterLast = typeof item.facts.hunter_last_message_at === 'string'
    ? formatRelative(item.facts.hunter_last_message_at as string)
    : 'never';
  const muted = { fontSize: 12, color: theme.textSecondary };

  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, borderRadius: theme.radius.lg }]}>
      <View style={styles.inline}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: theme.warning ?? '#f59e0b' }}>
          {describeTrustReviewItem(item).toUpperCase()}
        </Text>
        {item.status === 'contacted' ? <Text style={muted}>· contacted</Text> : null}
      </View>
      <View style={styles.inline}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: theme.text, flexShrink: 1 }} numberOfLines={2}>
          {item.bountyTitle ?? 'Untitled bounty'}
        </Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textSecondary }}>
          {item.isForHonor ? 'Honor' : formatMoney(item.amount)}
        </Text>
      </View>
      <Text style={muted}>
        {item.posterName ?? 'Poster'} → {item.hunterName ?? 'Hunter'} · opened {formatRelative(item.openedAt)}
        {sinceAccept ? ` · accepted ${sinceAccept} ago` : ''} · hunter last messaged {hunterLast}
      </Text>
      {item.disputeReason ? (
        <Text style={{ fontSize: 13, color: theme.text }} numberOfLines={3}>
          “{item.disputeReason}”
        </Text>
      ) : null}
      {item.kind === 'completion_review_overdue' ? (
        <Text style={muted}>
          Phase B shadow: {item.autoReleaseEligible ? 'would auto-release' : `would not (${item.autoReleaseBlockers.join(', ')})`}
        </Text>
      ) : null}
      <View style={[styles.inline, { marginTop: 6, flexWrap: 'wrap' }]}>
        {onViewBounty ? <Action icon="open-in-new" label="Bounty" onPress={onViewBounty} /> : null}
        {onViewDispute ? <Action icon="gavel" label="Dispute" onPress={onViewDispute} /> : null}
        {item.posterId ? <Action icon="message" label="Poster" onPress={() => onMessage(item.posterId!)} /> : null}
        {item.hunterId ? <Action icon="message" label="Hunter" onPress={() => onMessage(item.hunterId!)} /> : null}
        {onContacted ? <Action icon="phone-in-talk" label="Contacted" onPress={onContacted} /> : null}
        <Action icon="check-circle" label="Resolve" onPress={onResolve} />
      </View>
    </View>
  );
}

function Action({ icon, label, onPress }: { icon: keyof typeof MaterialIcons.glyphMap; label: string; onPress: () => void }) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      style={[styles.action, { borderColor: theme.border }]}
    >
      <MaterialIcons name={icon} size={16} color={theme.primary} />
      <Text style={{ fontSize: 12, color: theme.text }}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, gap: 6 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
});
