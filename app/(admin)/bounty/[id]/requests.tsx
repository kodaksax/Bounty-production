// app/(admin)/bounty/[id]/requests.tsx - Hunter applications for one bounty
//
// New screen. `bounty_requests` is a core marketplace table (237 rows in
// production) that had no admin surface whatsoever: when investigating a
// dispute or a complaint about who got picked, an operator had no way to see
// who applied, what they said, or when the poster decided.
//
// Read-only by design. Accepting or rejecting an application drives the
// hunter-assignment side effects in the `accept-bounty-request` Edge Function;
// letting the console write `bounty_requests.status` directly would set the
// row without those effects and silently desynchronise the bounty.
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { AdminHeader } from '../../../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../../../components/admin/AdminStatusBadge';
import {
  AdminEmpty,
  AdminError,
  AdminLinkRow,
  AdminLoading,
  AdminPanel,
  AdminScreen,
  formatDateTime,
  formatRelative,
  shortId,
} from '../../../../components/admin/AdminUI';
import { useAppTheme } from '../../../../hooks/use-app-theme';
import { adminDataClient } from '../../../../lib/admin/adminDataClient';
import { ROUTES } from '../../../../lib/routes';
import type { AdminBountyRequest } from '../../../../lib/types-admin';

export default function AdminBountyRequestsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [requests, setRequests] = useState<AdminBountyRequest[]>([]);
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
      refreshing ? setIsRefreshing(true) : setIsLoading(true);
      setError(null);
      try {
        setRequests(await adminDataClient.fetchBountyRequests(id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load applications');
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

  const renderItem = useCallback(
    ({ item }: { item: AdminBountyRequest }) => (
      <AdminPanel>
        <View style={styles.header}>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: theme.text }}>
            {item.hunterUsername ?? `Hunter ${shortId(item.hunterId)}`}
          </Text>
          <AdminStatusBadge status={item.status} type="request" />
        </View>

        {item.message ? (
          <Text
            style={{
              fontSize: 14,
              color: theme.textSecondary,
              lineHeight: 20,
              marginTop: theme.spacing.sm,
            }}
          >
            {item.message}
          </Text>
        ) : (
          <Text
            style={{
              fontSize: 13,
              color: theme.textDisabled,
              fontStyle: 'italic',
              marginTop: theme.spacing.sm,
            }}
          >
            No message was included with this application.
          </Text>
        )}

        <Text style={{ fontSize: 12, color: theme.textDisabled, marginTop: theme.spacing.md }}>
          Applied {formatRelative(item.createdAt)}
          {item.acceptedAt ? ` · Accepted ${formatDateTime(item.acceptedAt)}` : ''}
          {item.rejectedAt ? ` · Rejected ${formatDateTime(item.rejectedAt)}` : ''}
        </Text>

        {item.hunterId ? (
          <View style={{ marginTop: theme.spacing.sm }}>
            <AdminLinkRow
              icon="person"
              label="View hunter"
              detail={shortId(item.hunterId)}
              onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(item.hunterId!) as never)}
              last
            />
          </View>
        ) : null}
      </AdminPanel>
    ),
    [router, theme]
  );

  return (
    <AdminScreen>
      <AdminHeader
        title="Applications"
        subtitle="Hunters who applied to this bounty"
        showBack
        backFallback={id ? ROUTES.ADMIN.BOUNTY_DETAIL(id) : ROUTES.ADMIN.BOUNTIES}
      />

      {error && requests.length === 0 ? (
        <AdminError
          title="Couldn't load applications"
          message="The applications for this bounty could not be read."
          detail={error}
          onRetry={() => load()}
        />
      ) : isLoading ? (
        <AdminLoading label="Loading applications…" />
      ) : (
        <FlatList
          data={requests}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshing={isRefreshing}
          onRefresh={() => load(true)}
          ListEmptyComponent={
            <AdminEmpty
              icon="how-to-reg"
              title="No applications"
              description="No hunter has applied to this bounty yet. Applications appear here as soon as one is submitted."
              actionLabel="Refresh"
              onAction={() => load()}
            />
          }
          ListFooterComponent={
            requests.length > 0 ? (
              <Text
                style={{
                  fontSize: 12,
                  color: theme.textSecondary,
                  textAlign: 'center',
                  paddingVertical: theme.spacing.lg,
                  lineHeight: 18,
                }}
              >
                Read-only. Accepting an application runs the hunter-assignment flow and is done by
                the poster in the app.
              </Text>
            ) : null
          }
        />
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
});
