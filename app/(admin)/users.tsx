// app/(admin)/users.tsx - Admin Users List
//
// Fixed here:
//  - The status filter chips never refiltered the list (see
//    hooks/useAdminList.ts for the root cause).
//  - No search. Finding one user among 343 profiles meant scrolling, and the
//    query returned every profile row with no LIMIT.
//  - The per-user "Posted / Completed" counters were read from
//    `profiles.bounties_posted` / `.bounties_completed`, columns that do not
//    exist, so every user showed 0. They are now real aggregates; when the
//    aggregate is unavailable the row shows "—" rather than a fake zero.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../components/admin/AdminStatusBadge';
import {
  AdminEmpty,
  AdminError,
  AdminErrorBanner,
  AdminFilterChips,
  AdminListFooter,
  AdminLoading,
  AdminScreen,
  AdminSearchBar,
  formatMoney,
  formatRelative,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdminUsers } from '../../hooks/useAdminUsers';
import { ROUTES } from '../../lib/routes';
import { ADMIN_USER_STATUSES, type AdminUserStatus, type AdminUserSummary } from '../../lib/types-admin';

const STATUS_OPTIONS = ['all', ...ADMIN_USER_STATUSES] as const;
type StatusOption = (typeof STATUS_OPTIONS)[number];

export default function AdminUsersScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();

  const [status, setStatus] = useState<StatusOption>('all');
  const [search, setSearch] = useState('');

  const filters = useMemo(
    () => ({
      status: status === 'all' ? ('all' as const) : (status as AdminUserStatus),
      search: search.trim() || undefined,
    }),
    [status, search]
  );

  const { users, total, isLoading, isLoadingMore, isRefreshing, error, hasMore, refetch, loadMore } =
    useAdminUsers(filters);

  const openUser = useCallback(
    (id: string) => router.push(ROUTES.ADMIN.USER_DETAIL(id) as never),
    [router]
  );

  const renderItem = useCallback(
    ({ item }: { item: AdminUserSummary }) => <UserRow item={item} onPress={openUser} />,
    [openUser]
  );

  const keyExtractor = useCallback((item: AdminUserSummary) => item.id, []);
  const showFullError = !!error && users.length === 0 && !isLoading;

  return (
    <AdminScreen>
      <AdminHeader title="Users" showBack backFallback={ROUTES.ADMIN.INDEX} />

      <AdminSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search username, name or email…"
      />

      <View style={{ marginTop: theme.spacing.sm }}>
        <AdminFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </View>

      {error && users.length > 0 ? <AdminErrorBanner message={error} onRetry={refetch} /> : null}

      {showFullError ? (
        <AdminError
          title="Couldn't load users"
          message="The user directory could not be read. This is served by the admin-profiles function, which requires an admin session."
          detail={error}
          onRetry={refetch}
        />
      ) : isLoading && users.length === 0 ? (
        <AdminLoading label="Loading users…" />
      ) : (
        <FlatList
          data={users}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshing={isRefreshing}
          onRefresh={refetch}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <AdminEmpty
              icon="person-search"
              title="No users found"
              description={
                search.trim()
                  ? `No account matches "${search.trim()}"${status !== 'all' ? ` with status ${status}` : ''}.`
                  : status !== 'all'
                    ? `No accounts currently have the status "${status}".`
                    : 'No accounts exist yet.'
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
              shown={users.length}
              total={total}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              noun="users"
            />
          }
        />
      )}
    </AdminScreen>
  );
}

const UserRow = React.memo(function UserRow({
  item,
  onPress,
}: {
  item: AdminUserSummary;
  onPress: (id: string) => void;
}) {
  const { theme } = useAppTheme();
  const verified = item.verificationStatus === 'verified' || item.verificationStatus === 'trusted';
  // An em dash rather than 0 when the aggregate could not be computed — a
  // fabricated zero is worse than an honest gap.
  const stat = (value: number) => (item.statsLoaded ? value.toLocaleString() : '—');

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
      accessibilityLabel={`${item.username}, ${item.status}`}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '600', color: theme.text }} numberOfLines={1}>
            {item.username}
          </Text>
          {item.email ? (
            <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
              {item.email}
            </Text>
          ) : null}
        </View>
        <AdminStatusBadge status={item.status} type="user" />
      </View>

      <View style={[styles.stats, { borderColor: theme.border, marginTop: theme.spacing.md }]}>
        <Stat label="Posted" value={stat(item.bountiesPosted)} />
        <Stat label="Completed" value={stat(item.bountiesCompleted)} />
        <Stat label="Balance" value={formatMoney(item.balance)} />
      </View>

      <View style={[styles.footer, { marginTop: theme.spacing.md }]}>
        <View style={styles.metaItem}>
          <MaterialIcons
            name={verified ? 'verified' : 'pending'}
            size={14}
            color={verified ? theme.success : theme.warning}
          />
          <Text style={{ fontSize: 12, color: theme.textSecondary }}>
            {item.verificationStatus ?? 'unverified'}
          </Text>
        </View>
        {item.balanceFrozen ? (
          <View style={styles.metaItem}>
            <MaterialIcons name="ac-unit" size={14} color={theme.info} />
            <Text style={{ fontSize: 12, color: theme.info, fontWeight: '600' }}>Frozen</Text>
          </View>
        ) : null}
        <Text style={{ fontSize: 12, color: theme.textDisabled, marginLeft: 'auto' }}>
          Joined {formatRelative(item.joinDate)}
        </Text>
      </View>
    </TouchableOpacity>
  );
});

function Stat({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>{value}</Text>
      <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  stats: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
