// app/admin/liquidity-board.tsx — founder Liquidity Board (BNTY-10)
//
// Everything admin_liquidity_board() finds: open, non-test demand that isn't
// moving, grouped by why. Each row is one tap from "message the poster" or
// "look at the bounty" — this screen never writes anything itself.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPanel,
  AdminScreen,
  AdminSection,
  formatMoney,
  formatRelative,
} from '../../components/admin/AdminUI';
import { useAppTheme } from '../../hooks/use-app-theme';
import { useLiquidityBoard } from '../../hooks/useLiquidityBoard';
import { LIQUIDITY_BUCKET_TITLES } from '../../lib/admin/liquidityBoardClient';
import { ROUTES } from '../../lib/routes';
import type { AdminLiquidityBucket, AdminLiquidityRow } from '../../lib/types-admin';

const BUCKET_ORDER: AdminLiquidityBucket[] = [
  'no_geom',
  'zero_applications',
  'unopened_applications',
  'funding_required_no_hire',
  'poster_gone_dark',
];

export default function AdminLiquidityBoardScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { rows, isLoading, isRefreshing, error, refetch } = useLiquidityBoard();

  const groups = useMemo(() => {
    const byBucket = new Map<AdminLiquidityBucket, AdminLiquidityRow[]>();
    for (const row of rows) {
      const list = byBucket.get(row.bucket);
      if (list) list.push(row);
      else byBucket.set(row.bucket, [row]);
    }
    return BUCKET_ORDER.map((bucket) => ({ bucket, items: byBucket.get(bucket) ?? [] })).filter(
      (g) => g.items.length > 0
    );
  }, [rows]);

  const goToBounty = useCallback(
    (bountyId: string) => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(bountyId) as never),
    [router]
  );
  const messagePoster = useCallback(
    (posterId: string) => router.push(ROUTES.MESSAGES.WITH_USER(posterId) as never),
    [router]
  );

  if (error && rows.length === 0) {
    return (
      <AdminScreen>
        <AdminHeader title="Liquidity Board" showBack backFallback={ROUTES.ADMIN.COMMAND_CENTER} />
        <AdminError
          title="Couldn't load the Liquidity Board"
          message="admin_liquidity_board() could not be executed. The Command Center migration may not be applied to this environment yet."
          detail={error}
          onRetry={() => refetch()}
        />
      </AdminScreen>
    );
  }

  return (
    <AdminScreen>
      <AdminHeader
        title="Liquidity Board"
        subtitle={`${rows.length.toLocaleString()} stuck item${rows.length === 1 ? '' : 's'}`}
        showBack
        backFallback={ROUTES.ADMIN.COMMAND_CENTER}
      />
      <ScrollView
        contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={() => refetch()} tintColor={theme.primary} />
        }
      >
        {isLoading && rows.length === 0 ? (
          <AdminLoading label="Scanning for stuck demand…" />
        ) : groups.length === 0 ? (
          <AdminEmpty
            icon="waves"
            title="Nothing stuck"
            description="Every open bounty has a location, applications, an engaged poster, and a hire where one is expected."
          />
        ) : (
          groups.map((group) => (
            <AdminSection key={group.bucket} title={`${LIQUIDITY_BUCKET_TITLES[group.bucket]} · ${group.items.length}`}>
              <AdminPanel style={{ paddingVertical: 0 }}>
                {group.items.map((row, index) => (
                  <LiquidityRow
                    key={row.bountyId}
                    row={row}
                    last={index === group.items.length - 1}
                    onViewBounty={() => goToBounty(row.bountyId)}
                    onMessagePoster={row.posterId ? () => messagePoster(row.posterId as string) : undefined}
                  />
                ))}
              </AdminPanel>
            </AdminSection>
          ))
        )}
      </ScrollView>
    </AdminScreen>
  );
}

function LiquidityRow({
  row,
  onViewBounty,
  onMessagePoster,
  last,
}: {
  row: AdminLiquidityRow;
  onViewBounty: () => void;
  onMessagePoster?: () => void;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.row,
        {
          paddingVertical: theme.spacing.md,
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: theme.border,
        },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.inline}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: theme.text, flexShrink: 1 }} numberOfLines={1}>
            {row.title ?? 'Untitled bounty'}
          </Text>
          {row.amount != null ? (
            <Text style={{ fontSize: 13, fontWeight: '700', color: theme.textSecondary }}>
              {formatMoney(row.amount)}
            </Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, color: theme.textSecondary }}>
          {row.posterUsername ?? 'Unknown poster'} · stuck {row.stuckHours}h · since{' '}
          {formatRelative(row.stuckSince)}
        </Text>
      </View>
      <View style={styles.actions}>
        {onMessagePoster ? (
          <TouchableOpacity
            onPress={onMessagePoster}
            accessibilityRole="button"
            accessibilityLabel="Message poster"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.actionButton}
          >
            <MaterialIcons name="message" size={20} color={theme.primary} />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={onViewBounty}
          accessibilityRole="button"
          accessibilityLabel="View bounty"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.actionButton}
        >
          <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionButton: { padding: 4 },
});
