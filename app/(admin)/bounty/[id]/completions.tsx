// app/(admin)/bounty/[id]/completions.tsx - Completion submissions for one bounty
//
// New screen. `completion_submissions` is the evidence record for "the hunter
// says the work is done" — the single most important artefact when
// adjudicating a dispute — and it had no admin surface at all.
//
// Read-only by design. Approving a submission is what releases escrow, and
// that path runs through the `completion` Edge Function which owns the payment
// side effects and their audit trail. The console shows the evidence so a
// dispute can be judged; it does not offer a way around that flow.
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../../components/admin/AdminHeader';
import {
  AdminBadge,
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
import type { AdminCompletionSubmission } from '../../../../lib/types-admin';

function toneForStatus(status: string): React.ComponentProps<typeof AdminBadge>['tone'] {
  switch (status) {
    case 'approved':
    case 'accepted':
              return 'success';
    case 'rejected':
      return 'error';
    case 'revision_requested':
      return 'warning';
    case 'pending':
    case 'submitted':
      return 'info';
    default:
      return 'neutral';
  }
}

export default function AdminBountyCompletionsScreen() {
  const router = useRouter();
  const { theme } = useAppTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [submissions, setSubmissions] = useState<AdminCompletionSubmission[]>([]);
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
      // A pull-to-refresh keeps the current rows on screen; a first load does not.
      if (refreshing) setIsRefreshing(true);
      else setIsLoading(true);
      setError(null);
      try {
        setSubmissions(await adminDataClient.fetchBountyCompletions(id));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load submissions');
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

  const openProof = useCallback(async (url?: string) => {
    if (!url) return;
    try {
      const supported = await Linking.canOpenURL(url);
      if (supported) await Linking.openURL(url);
    } catch {
      /* An unopenable proof URL is not worth interrupting the operator over. */
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: AdminCompletionSubmission }) => (
      <AdminPanel>
        <View style={styles.header}>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: theme.text }}>
            {item.hunterUsername ?? `Hunter ${shortId(item.hunterId)}`}
          </Text>
          <AdminBadge label={item.status} tone={toneForStatus(item.status)} />
        </View>

        <Text style={{ fontSize: 12, color: theme.textDisabled, marginTop: 4 }}>
          Submitted {formatRelative(item.submittedAt)}
          {item.reviewedAt ? ` · Reviewed ${formatDateTime(item.reviewedAt)}` : ' · Not yet reviewed'}
          {item.revisionCount > 0
            ? ` · ${item.revisionCount} revision${item.revisionCount === 1 ? '' : 's'}`
            : ''}
        </Text>

        {item.message ? (
          <Text
            style={{
              fontSize: 14,
              color: theme.text,
              lineHeight: 20,
              marginTop: theme.spacing.md,
            }}
          >
            {item.message}
          </Text>
        ) : null}

        {/* Proof of work */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: '700',
            color: theme.textSecondary,
            marginTop: theme.spacing.lg,
            letterSpacing: 0.4,
          }}
        >
          PROOF ({item.proofItems.length})
        </Text>
        {item.proofItems.length === 0 ? (
          <Text style={{ fontSize: 13, color: theme.textDisabled, fontStyle: 'italic', marginTop: 4 }}>
            No attachments were included with this submission.
          </Text>
        ) : (
          item.proofItems.map((proof, index) => (
            <TouchableOpacity
              key={`${item.id}-proof-${index}`}
              onPress={() => openProof(proof.url)}
              disabled={!proof.url}
              accessibilityRole={proof.url ? 'link' : 'text'}
              accessibilityLabel={proof.label}
              style={[styles.proofRow, { marginTop: theme.spacing.sm, opacity: proof.url ? 1 : 0.6 }]}
            >
              <MaterialIcons
                name={proof.url ? 'attachment' : 'insert-drive-file'}
                size={16}
                color={proof.url ? theme.primary : theme.textDisabled}
              />
              <Text
                style={{ flex: 1, fontSize: 13, color: proof.url ? theme.primary : theme.textSecondary }}
                numberOfLines={1}
              >
                {proof.label}
              </Text>
              {proof.url ? (
                <MaterialIcons name="open-in-new" size={14} color={theme.primary} />
              ) : null}
            </TouchableOpacity>
          ))
        )}

        {item.posterFeedback ? (
          <View
            style={{
              marginTop: theme.spacing.lg,
              padding: theme.spacing.md,
              borderRadius: theme.radius.md,
              backgroundColor: theme.surfaceSecondary,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: theme.textSecondary }}>
              POSTER FEEDBACK
            </Text>
            <Text style={{ fontSize: 14, color: theme.text, marginTop: 4, lineHeight: 20 }}>
              {item.posterFeedback}
            </Text>
          </View>
        ) : null}

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
    [openProof, router, theme]
  );

  return (
    <AdminScreen>
      <AdminHeader
        title="Completions"
        subtitle="Proof of work submitted for this bounty"
        showBack
        backFallback={id ? ROUTES.ADMIN.BOUNTY_DETAIL(id) : ROUTES.ADMIN.BOUNTIES}
      />

      {error && submissions.length === 0 ? (
        <AdminError
          title="Couldn't load submissions"
          message="The completion submissions for this bounty could not be read."
          detail={error}
          onRetry={() => load()}
        />
      ) : isLoading ? (
        <AdminLoading label="Loading submissions…" />
      ) : (
        <FlatList
          data={submissions}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: 40 }}
          refreshing={isRefreshing}
          onRefresh={() => load(true)}
          ListEmptyComponent={
            <AdminEmpty
              icon="assignment-late"
              title="Nothing submitted"
              description="The hunter has not submitted proof of work for this bounty yet."
              actionLabel="Refresh"
              onAction={() => load()}
            />
          }
          ListFooterComponent={
            submissions.length > 0 ? (
              <Text
                style={{
                  fontSize: 12,
                  color: theme.textSecondary,
                  textAlign: 'center',
                  paddingVertical: theme.spacing.lg,
                  lineHeight: 18,
                }}
              >
                Read-only. Approving a submission releases escrow and is handled by the poster
                through the completion flow.
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
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
