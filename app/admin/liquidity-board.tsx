// app/admin/liquidity-board.tsx — founder Liquidity Board (BNTY-10)
//
// Everything admin_liquidity_board() finds: open, non-test demand that isn't
// moving, grouped by why. Each row is one tap from "message the poster" or
// "look at the bounty" — this screen never writes anything itself.
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useMemo } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

interface LiquiditySection {
  bucket: AdminLiquidityBucket;
  title: string;
  bucketTotal: number;
  data: AdminLiquidityRow[];
}

export default function AdminLiquidityBoardScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { rows, isLoading, isRefreshing, error, refetch } = useLiquidityBoard();

  const sections = useMemo<LiquiditySection[]>(() => {
    const byBucket = new Map<AdminLiquidityBucket, AdminLiquidityRow[]>();
    for (const row of rows) {
      const list = byBucket.get(row.bucket);
      if (list) list.push(row);
      else byBucket.set(row.bucket, [row]);
    }
    return BUCKET_ORDER.map((bucket) => {
      const data = byBucket.get(bucket) ?? [];
      const bucketTotal = data.reduce((max, row) => Math.max(max, row.bucketTotal ?? 0), data.length);
      return { bucket, title: LIQUIDITY_BUCKET_TITLES[bucket], bucketTotal, data };
    }).filter((section) => section.data.length > 0);
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
      {error && rows.length > 0 ? <AdminErrorBanner message={error} onRetry={() => refetch()} /> : null}

      {isLoading && rows.length === 0 ? (
        <AdminLoading label="Scanning for stuck demand…" />
      ) : sections.length === 0 ? (
        <AdminEmpty
          icon="waves"
          title="Nothing stuck"
          description="Every open bounty has a location, applications, an engaged poster, and a hire where one is expected."
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.bucket}:${item.bountyId}`}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title}
              shown={section.data.length}
              total={section.bucketTotal}
            />
          )}
          renderItem={({ item, index, section }) => (
            <LiquidityRow
              row={item}
              first={index === 0}
              last={index === section.data.length - 1}
              onViewBounty={() => goToBounty(item.bountyId)}
              onMessagePoster={item.posterId ? () => messagePoster(item.posterId as string) : undefined}
            />
          )}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 64 }}
          stickySectionHeadersEnabled={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={() => refetch()} tintColor={theme.primary} />
          }
        />
      )}
    </AdminScreen>
  );
}

function SectionHeader({ title, shown, total }: { title: string; shown: number; total: number }) {
  const { theme } = useAppTheme();
  const truncated = total > shown;
  return (
    <View style={{ marginBottom: 12, marginTop: theme.spacing.md }}>
      <Text
        style={{
          fontSize: theme.typography.fontSize.lg,
          fontWeight: theme.typography.fontWeight.bold,
          color: theme.text,
        }}
      >
        {title} · {truncated ? `${shown.toLocaleString()} of ${total.toLocaleString()}` : shown.toLocaleString()}
      </Text>
    </View>
  );
}

function LiquidityRow({
  row,
  onViewBounty,
  onMessagePoster,
  first,
  last,
}: {
  row: AdminLiquidityRow;
  onViewBounty: () => void;
  onMessagePoster?: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: theme.surface,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.md,
          borderLeftWidth: 1,
          borderRightWidth: 1,
          borderTopWidth: first ? 1 : 0,
          borderBottomWidth: last ? 1 : StyleSheet.hairlineWidth,
          borderColor: theme.border,
          borderTopLeftRadius: first ? theme.radius.lg : 0,
          borderTopRightRadius: first ? theme.radius.lg : 0,
          borderBottomLeftRadius: last ? theme.radius.lg : 0,
          borderBottomRightRadius: last ? theme.radius.lg : 0,
          marginBottom: last ? theme.spacing.xl : 0,
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
