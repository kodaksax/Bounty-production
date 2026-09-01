// app/(admin)/transactions.tsx - Admin Transactions List (read-only)
//
// Fixed here:
//  - The type filter chips never refiltered the list (see
//    hooks/useAdminList.ts for the root cause).
//  - Only 5 of the 7 wallet_tx_type_enum values were offered — `dispute_loss`
//    and `admin_adjustment` transactions were unreachable — and there was no
//    status filter at all despite the ledger carrying failed/pending rows.
//  - The "To:" line read `wallet_transactions.to_user_id`, a column that does
//    not exist, so a transaction's recipient was never shown. It reads
//    `receiver_id` now.
//  - Bounty and user references were printed as bare UUIDs with no way to
//    navigate to them. They are resolved to names and are links.
//  - The query was capped at a hardcoded 100 rows with no pagination and no
//    indication that anything had been truncated.
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
  AdminListFooter,
  AdminLoading,
  AdminScreen,
  AdminSearchBar,
  formatMoney,
  formatRelative,
  shortId,
  withAlpha,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useAdminTransactions } from '../../hooks/useAdminTransactions';
import { ROUTES } from '../../lib/routes';
import {
  ADMIN_TRANSACTION_STATUSES,
  ADMIN_TRANSACTION_TYPES,
  type AdminTransaction,
  type AdminTransactionStatus,
  type AdminTransactionType,
} from '../../lib/types-admin';

const TYPE_OPTIONS = ['all', ...ADMIN_TRANSACTION_TYPES] as const;
const STATUS_OPTIONS = ['all', ...ADMIN_TRANSACTION_STATUSES] as const;
type TypeOption = (typeof TYPE_OPTIONS)[number];
type StatusOption = (typeof STATUS_OPTIONS)[number];

const TYPE_ICONS: Record<AdminTransactionType, keyof typeof MaterialIcons.glyphMap> = {
  escrow: 'lock',
  release: 'lock-open',
  refund: 'undo',
  deposit: 'add-circle',
  withdrawal: 'remove-circle',
  dispute_loss: 'gavel',
  admin_adjustment: 'tune',
};

export default function AdminTransactionsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();

  // Deep links from the bounty and user detail screens scope the ledger.
  const params = useLocalSearchParams<{ bountyId?: string; userId?: string }>();

  const [type, setType] = useState<TypeOption>('all');
  const [status, setStatus] = useState<StatusOption>('all');
  const [search, setSearch] = useState('');

  const filters = useMemo(
    () => ({
      type: type === 'all' ? ('all' as const) : (type as AdminTransactionType),
      status: status === 'all' ? ('all' as const) : (status as AdminTransactionStatus),
      search: search.trim() || undefined,
      bountyId: params.bountyId || undefined,
      userId: params.userId || undefined,
    }),
    [type, status, search, params.bountyId, params.userId]
  );

  const {
    transactions,
    total,
    isLoading,
    isLoadingMore,
    isRefreshing,
    error,
    hasMore,
    refetch,
    loadMore,
  } = useAdminTransactions(filters);

  const scopeLabel = params.bountyId
    ? 'Ledger for one bounty'
    : params.userId
      ? 'Ledger for one user'
      : undefined;

  const renderItem = useCallback(
    ({ item }: { item: AdminTransaction }) => <TransactionRow item={item} router={router} />,
    [router]
  );

  const keyExtractor = useCallback((item: AdminTransaction) => item.id, []);
  const showFullError = !!error && transactions.length === 0 && !isLoading;
  const hasActiveFilter = type !== 'all' || status !== 'all' || !!search.trim();

  return (
    <AdminScreen>
      <AdminHeader
        title="Transactions"
        subtitle={scopeLabel}
        showBack
        backFallback={ROUTES.ADMIN.INDEX}
      />

      <AdminSearchBar
        value={search}
        onChangeText={setSearch}
        placeholder="Search description or Stripe reference…"
      />

      <View style={{ marginTop: theme.spacing.sm }}>
        <AdminFilterChips options={TYPE_OPTIONS} value={type} onChange={setType} />
        <AdminFilterChips options={STATUS_OPTIONS} value={status} onChange={setStatus} />
      </View>

      {error && transactions.length > 0 ? (
        <AdminErrorBanner message={error} onRetry={refetch} />
      ) : null}

      {showFullError ? (
        <AdminError
          title="Couldn't load transactions"
          message="The wallet ledger could not be read. Check your connection and try again."
          detail={error}
          onRetry={refetch}
        />
      ) : isLoading && transactions.length === 0 ? (
        <AdminLoading label="Loading ledger…" />
      ) : (
        <FlatList
          data={transactions}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshing={isRefreshing}
          onRefresh={refetch}
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <AdminEmpty
              icon="receipt-long"
              title="No transactions found"
              description={
                hasActiveFilter
                  ? 'No ledger entries match the current filters.'
                  : params.bountyId
                    ? 'No money has moved for this bounty yet.'
                    : params.userId
                      ? 'This user has no ledger entries yet.'
                      : 'The wallet ledger is empty.'
              }
              actionLabel={hasActiveFilter ? 'Clear filters' : 'Refresh'}
              onAction={() => {
                if (hasActiveFilter) {
                  setType('all');
                  setStatus('all');
                  setSearch('');
                } else {
                  void refetch();
                }
              }}
            />
          }
          ListFooterComponent={
            <AdminListFooter
              shown={transactions.length}
              total={total}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={loadMore}
              noun="transactions"
            />
          }
        />
      )}
    </AdminScreen>
  );
}

const TransactionRow = React.memo(function TransactionRow({
  item,
  router,
}: {
  item: AdminTransaction;
  router: ReturnType<typeof useRouter>;
}) {
  const { theme } = useAppTheme();
  const icon = TYPE_ICONS[item.type] ?? 'swap-horiz';
  // Failed rows earn a visible left edge — they are the ones an operator has
  // to act on, and they used to look identical to every completed row.
  const accent =
    item.status === 'failed' ? theme.error : item.status === 'pending' ? theme.warning : theme.border;

  return (
    <View
      style={{
        backgroundColor: theme.surface,
        borderRadius: theme.radius.lg,
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.md,
        borderWidth: 1,
        borderColor: theme.border,
        borderLeftWidth: 3,
        borderLeftColor: accent,
      }}
    >
      <View style={styles.header}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.primary, 0.12),
          }}
        >
          <MaterialIcons name={icon} size={20} color={theme.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 14, fontWeight: '700', color: theme.text }}>
            {item.type.replace(/_/g, ' ').toUpperCase()}
          </Text>
          {item.description ? (
            <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }} numberOfLines={1}>
              {item.description}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>
            {formatMoney(item.amount)}
          </Text>
          <AdminStatusBadge status={item.status} type="transaction" />
        </View>
      </View>

      <View style={{ marginTop: theme.spacing.md, gap: 6 }}>
        {item.bountyId ? (
          <RefLink
            icon="work"
            label={item.bountyTitle ?? `Bounty ${shortId(item.bountyId)}`}
            prefix="Bounty"
            onPress={() => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(item.bountyId!) as never)}
          />
        ) : null}
        {item.fromUserId ? (
          <RefLink
            icon="person"
            label={item.fromUsername ?? shortId(item.fromUserId)}
            prefix="From"
            onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(item.fromUserId!) as never)}
          />
        ) : null}
        {item.toUserId ? (
          <RefLink
            icon="person-outline"
            label={item.toUsername ?? shortId(item.toUserId)}
            prefix="To"
            onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(item.toUserId!) as never)}
          />
        ) : null}
      </View>

      <View style={[styles.footer, { marginTop: theme.spacing.md }]}>
        <Text style={{ fontSize: 12, color: theme.textDisabled }}>
          {formatRelative(item.createdAt)}
        </Text>
        {item.payoutMethod ? (
          <Text style={{ fontSize: 12, color: theme.textDisabled }}>via {item.payoutMethod}</Text>
        ) : null}
        {item.stripePaymentIntentId ? (
          <Text style={{ fontSize: 11, color: theme.textDisabled }} numberOfLines={1}>
            {shortId(item.stripePaymentIntentId)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function RefLink({
  icon,
  label,
  prefix,
  onPress,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  prefix: string;
  onPress: () => void;
}) {
  const { theme } = useAppTheme();
  return (
    <TouchableOpacity
      style={styles.refRow}
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`${prefix}: ${label}`}
    >
      <MaterialIcons name={icon} size={14} color={theme.textSecondary} />
      <Text style={{ fontSize: 12, color: theme.textSecondary }}>{prefix}:</Text>
      <Text style={{ fontSize: 12, color: theme.primary, flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      <MaterialIcons name="chevron-right" size={14} color={theme.primary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
});
