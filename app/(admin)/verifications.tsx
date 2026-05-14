// app/(admin)/verifications.tsx - Admin queue of pending ID verifications.
//
// Lists profiles where `id_verification_status = 'pending'`, shows the
// uploaded ID and selfie via short-lived signed URLs from the
// `admin-verifications-list` edge function, and lets the admin Approve or
// Reject a submission via the existing `admin-review-id` edge function.

import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { supabase } from '../../lib/supabase';

interface VerificationItem {
  id: string;
  username: string | null;
  display_name: string | null;
  id_submitted_at: string | null;
  selfie_submitted_at: string | null;
  id_front_url: string | null;
  id_back_url: string | null;
  selfie_url: string | null;
}

export default function AdminVerificationsScreen() {
  const [items, setItems] = useState<VerificationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { data, error: fnError } = await supabase.functions.invoke('admin-verifications-list', {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (fnError) throw new Error(fnError.message || 'Failed to load verification queue');
      const list = (data?.items ?? []) as VerificationItem[];
      setItems(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load verification queue';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const review = async (userId: string, decision: 'approved' | 'rejected') => {
    setActingOn(userId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const { error: fnError } = await supabase.functions.invoke('admin-review-id', {
        body: { userId, decision },
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });
      if (fnError) throw new Error(fnError.message || 'Review failed');

      // TODO: Trigger notification to the user when verification is approved
      // or rejected. The repo already has a notifications-outbox migration
      // (20260316_add_notifications_outbox.sql) and a send-system-notification
      // RPC (20260416_add_send_system_notification_fn.sql) that could be
      // invoked from admin-review-id once the user-facing copy is finalised.

      // Optimistically remove from queue.
      setItems((prev) => prev.filter((i) => i.id !== userId));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Review failed';
      Alert.alert('Action Failed', msg);
    } finally {
      setActingOn(null);
    }
  };

  const confirmReject = (userId: string, label: string) => {
    Alert.alert(
      'Reject verification?',
      `Reject the verification submission for ${label}? The user will be marked as rejected and can resubmit.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Reject', style: 'destructive', onPress: () => review(userId, 'rejected') },
      ],
    );
  };

  const confirmApprove = (userId: string, label: string) => {
    Alert.alert(
      'Approve verification?',
      `Mark ${label} as verified?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Approve', onPress: () => review(userId, 'approved') },
      ],
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="verified-user" size={48} color="rgba(255,254,245,0.4)" />
      <Text style={styles.emptyText}>No pending verifications</Text>
      <Text style={styles.emptySubtext}>The queue is empty. Pull to refresh.</Text>
    </View>
  );

  const renderItem = ({ item }: { item: VerificationItem }) => {
    const label = item.display_name || item.username || item.id.slice(0, 8);
    const acting = actingOn === item.id;
    // Require both ID front and selfie to approve. `review-id` marks a
    // profile `pending` even when only the ID is uploaded, so we guard the
    // approve action here to avoid verifying a user without a selfie.
    const hasRequiredEvidence = !!item.id_front_url && !!item.selfie_url;
    const canApprove = !acting && hasRequiredEvidence;
    return (
      <AdminCard style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{label}</Text>
            {item.username && item.display_name ? (
              <Text style={styles.userHandle}>@{item.username}</Text>
            ) : null}
            {item.id_submitted_at ? (
              <Text style={styles.submittedAt}>
                Submitted {new Date(item.id_submitted_at).toLocaleString()}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.imagesRow}>
          <View style={styles.imageBlock}>
            <Text style={styles.imageLabel}>ID Front</Text>
            {item.id_front_url ? (
              <Image source={{ uri: item.id_front_url }} style={styles.docImage} resizeMode="contain" />
            ) : (
              <View style={[styles.docImage, styles.missingImage]}>
                <MaterialIcons name="image-not-supported" size={24} color="rgba(255,255,255,0.4)" />
              </View>
            )}
          </View>
          <View style={styles.imageBlock}>
            <Text style={styles.imageLabel}>Selfie</Text>
            {item.selfie_url ? (
              <Image source={{ uri: item.selfie_url }} style={styles.docImage} resizeMode="contain" />
            ) : (
              <View style={[styles.docImage, styles.missingImage]}>
                <MaterialIcons name="image-not-supported" size={24} color="rgba(255,255,255,0.4)" />
              </View>
            )}
          </View>
        </View>

        {item.id_back_url && (
          <View style={styles.backRow}>
            <Text style={styles.imageLabel}>ID Back</Text>
            <Image source={{ uri: item.id_back_url }} style={styles.backImage} resizeMode="contain" />
          </View>
        )}

        {!hasRequiredEvidence && (
          <View style={styles.warningBox}>
            <MaterialIcons name="warning-amber" size={16} color="#fbbf24" />
            <Text style={styles.warningText}>
              {!item.id_front_url && !item.selfie_url
                ? 'ID and selfie are missing. Reject and ask the user to resubmit.'
                : !item.id_front_url
                  ? 'ID image is missing. Approval is disabled.'
                  : 'Selfie is missing. Approval is disabled.'}
            </Text>
          </View>
        )}

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.rejectButton, acting && styles.disabled]}
            onPress={() => confirmReject(item.id, label)}
            disabled={acting}
            accessibilityRole="button"
            accessibilityLabel={`Reject verification for ${label}`}
          >
            <MaterialIcons name="close" size={18} color="#fecaca" />
            <Text style={styles.rejectText}>Reject</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionButton, styles.approveButton, !canApprove && styles.disabled]}
            onPress={() => confirmApprove(item.id, label)}
            disabled={!canApprove}
            accessibilityRole="button"
            accessibilityLabel={`Approve verification for ${label}`}
            accessibilityState={{ disabled: !canApprove }}
          >
            {acting ? (
              <ActivityIndicator size="small" color="#052e1b" />
            ) : (
              <>
                <MaterialIcons name="check" size={18} color="#052e1b" />
                <Text style={styles.approveText}>Approve</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </AdminCard>
    );
  };

  return (
    <View style={styles.container}>
      <AdminHeader title="ID Verifications" />

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00dc50" />
          <Text style={styles.loadingText}>Loading queue…</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={false} onRefresh={loadQueue} tintColor="#00dc50" />}
          ListHeaderComponent={
            error ? (
              <View style={styles.errorBox}>
                <MaterialIcons name="error-outline" size={20} color="#fecaca" />
                <Text style={styles.errorText}>{error}</Text>
                <TouchableOpacity onPress={loadQueue}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          ListEmptyComponent={!error ? renderEmpty : null}
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={5}
          removeClippedSubviews
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
    gap: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 64,
    gap: 8,
  },
  emptyText: {
    color: 'rgba(255,254,245,0.9)',
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtext: {
    color: 'rgba(255,254,245,0.5)',
    fontSize: 13,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(127,29,29,0.6)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(252,165,165,0.3)',
  },
  errorText: {
    flex: 1,
    color: '#fecaca',
    fontSize: 13,
  },
  retryText: {
    color: '#fecaca',
    fontWeight: '600',
  },
  card: {
    gap: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  userName: {
    color: '#fffef5',
    fontSize: 16,
    fontWeight: '700',
  },
  userHandle: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 13,
    marginTop: 2,
  },
  submittedAt: {
    color: 'rgba(255,254,245,0.5)',
    fontSize: 12,
    marginTop: 4,
  },
  imagesRow: {
    flexDirection: 'row',
    gap: 12,
  },
  imageBlock: {
    flex: 1,
    gap: 6,
  },
  imageLabel: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 12,
    fontWeight: '600',
  },
  docImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  missingImage: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  backRow: {
    gap: 6,
  },
  backImage: {
    width: '100%',
    height: 160,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  warningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(120,53,15,0.4)',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(251,191,36,0.3)',
  },
  warningText: {
    flex: 1,
    color: '#fde68a',
    fontSize: 12,
    lineHeight: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 999,
    gap: 6,
  },
  rejectButton: {
    backgroundColor: 'rgba(127,29,29,0.4)',
    borderWidth: 1,
    borderColor: 'rgba(252,165,165,0.4)',
  },
  rejectText: {
    color: '#fecaca',
    fontWeight: '600',
  },
  approveButton: {
    backgroundColor: '#a7f3d0',
  },
  approveText: {
    color: '#052e1b',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.6,
  },
});
