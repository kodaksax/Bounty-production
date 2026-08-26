// app/(admin)/bounties.tsx - Admin Bounties List
//
// Fixed here:
//  - The status filter chips changed their own highlight but never refiltered
//    the list (see hooks/useAdminList.ts for the root cause).
//  - Only 4 of the 7 bounty_status_enum values were offered, so cancelled and
//    deleted bounties were unreachable.
//  - There was no search at all, and the query had no LIMIT — the screen
//    fetched every bounty row on the platform on every visit.
//  - The "Flagged N times" banner read `flaggedCount`, mapped from a
//    `bounties.flagged_count` column that does not exist, so it never showed.
//    Replaced with the stale flag the expiry sweeper actually writes.
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../components/admin/AdminStatusBadge';
import {
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminFilterChips,
  AdminLoading,
  AdminListFooter,
  AdminScreen,
  AdminSearchBar,
  formatMoney,
  formatRelative,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdminBounties } from '../../hooks/useAdminBounties';
import { ROUTES } from '../../lib/routes';
import {
  ADMIN_BOUNTY_STATUSES,
  type AdminBounty,
  type AdminBountyStatus,
} from '../../lib/types-admin';

const STATUS_OPTIONS = ['all', ...ADMIN_BOUNTY_STATUSES] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

export default function AdminBountiesScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();

  // Deep-link support: /(admin)/bounties?posterId=…&status=… lets the user
  // detail screen link straight into a pre-filtered list.
  const params = useLocalSearchParams<{ posterId?: string; hunterId?: string; status?: string }>();

  const [status, setStatus] = useState<StatusOption>(
    STATUS_OPTIONS.includes(params.status as StatusOption) ? (params.status as StatusOption) : 'all'
  );
  const [search, setSearch] = useState('');

  const filters = useMemo(
    () => ({
      status: status === 'all' ? ('all' as const) : (status as AdminBountyStatus),
      search: search.trim() || undefined,
      posterId: params.posterId || undefined,
      hunterId: params.hunterId || undefined,
    }),
    [status, search, params.posterId, params.hunterId]
  );

  const {
    bounties,
    total,
    isLoading,
    isLoadingMore,
    isRefreshing,
    error,
    hasMore,
    refetch,
    loadMore,
  } = useAdminBounties(filters);

  const openBounty = useCallback(
    (id: string) => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(id) as never),
    [router]
  );

  const scopeLabel = params.posterId
    ? 'Bounties posted by this user'
    : params.hunterId
      ? 'Bounties accepted by this user'
      : undefined;

  const renderItem = useCallback(
    ({ item }: { item: AdminBounty }) => (
      <BountyRow item={item} onPress={openBounty} />
    ),
    [openBounty]
  );

  const keyExtractor = useCallback((item: AdminBounty) => item.id, []);

  // A hard error with nothing on screen owns the viewport; a failed refresh
  // over existing rows is only a banner.
  const showFullError = !!error && bounties.length === 0 && !isLoading;

  return (
    <AdminScreen>
      <AdminHeader
        title="Bounties"
        subtitle={scopeLabel}
        showBack
        backFallback={ROUTES.ADMIN.INDEX}
      />

      <AdminSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search title or description…"
      />

      <View style={{ marginTop: theme.spacing.sm }}>
        <AdminFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </View>

      {error && bounties.length > 0 ? <AdminErrorBanner message={error} onRetry={refetch} /> : null}

      {showFullError ? (
        <AdminError
          title="Couldn't load bounties"
          message="The bounty list could not be read. Check your connection and try again."
          detail={error}
          onRetry={refetch}
        />
      ) : isLoading && bounties.length === 0 ? (
        <AdminLoading label="Loading bounties…" />
      ) : (
        <FlatList
          data={bounties}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshing={isRefreshing}
          onRefresh={refetch}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <AdminEmpty
              icon="work-off"
              title="No bounties found"
              description={
                search.trim()
                  ? `Nothing matches "${search.trim()}"${status !== 'all' ? ` with status ${status.replace(/_/g, ' ')}` : ''}.`
                  : status !== 'all'
                    ? `No bounties currently have the status "${status.replace(/_/g, ' ')}".`
                    : 'No bounties have been posted yet.'
              }
              actionLabel={search.trim() || status !== 'all' ? 'Clear filters' : 'Refresh'}
              onAction={() => {
                if (search.trim() || status !== 'all') {
                  setSearch('');
                  setStatus('all');
                } else {
                  void refetch();
                }
              }}
            />
          }
          ListFooterComponent={
            <AdminListFooter
              shown={bounties.length}
              total={total}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              noun="bounties"
            />
          }
        />
      )}
    </AdminScreen>
  );
}

const BountyRow = React.memo(function BountyRow({
  item,
  onPress,
}: {
  item: AdminBounty;
  onPress: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={{
        backgroundColor: theme.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.border,
      }}
      onPress={() => onPress(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, status ${item.status}`}
    >
      <View style={styles.header}>
        <Text
          style={{ flex: 1, fontSize: 16, fontWeight: '600', color: theme.text }}
          numberOfLines={1}
        >
          {item.title || 'Untitled bounty'}
        </Text>
        <AdminStatusBadge status={item.status} type="bounty" />
      </View>

      {item.description ? (
        <Text
          style={{ fontSize: 14, color: theme.textSecondary, marginTop: 6, lineHeight: 20 }}
          numberOfLines={2}
        >
          {item.description}
        </Text>
      ) : null}

      <View style={[styles.meta, { marginTop: theme.spacing.md }]}>
        <View style={styles.metaItem}>
          <MaterialIcons
            name={item.isForHonor ? 'favorite' : 'attach-money'}
            size={14}
            color={theme.primary}
          />
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            {item.isForHonor ? 'For Honor' : formatMoney(item.amount)}
          </Text>
        </View>

        {/* Poster is resolved to a username instead of showing a raw UUID. */}
        {item.posterUsername || item.user_id ? (
          <View style={styles.metaItem}>
            <MaterialIcons name="person" size={14} color={theme.textSecondary} />
            <Text style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
              {item.posterUsername ?? 'Unknown poster'}
            </Text>
          </View>
        ) : null}

        {item.acceptedUsername ? (
          <View style={styles.metaItem}>
            <MaterialIcons name="handyman" size={14} color={theme.textSecondary} />
            <Text style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
              {item.acceptedUsername}
            </Text>
          </View>
        ) : null}

        {item.location ? (
          <View style={styles.metaItem}>
            <MaterialIcons name="location-on" size={14} color={theme.textSecondary} />
            <Text style={{ fontSize: 12, color: theme.textSecondary }} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[styles.footer, { marginTop: theme.spacing.sm }]}>
        <Text style={{ fontSize: 12, color: theme.textDisabled }}>
          {formatRelative(item.createdAt)}
        </Text>
        {item.isStale ? (
          <View style={styles.metaItem}>
            <MaterialIcons name="schedule" size={14} color={theme.warning} />
            <Text style={{ fontSize: 12, color: theme.warning, fontWeight: '600' }}>
              {item.staleReason ? `Stale: ${item.staleReason}` : 'Stale'}
            </Text>
          </View>
        ) : null}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
