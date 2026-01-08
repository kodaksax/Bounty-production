// app/(admin)/bounty/[id].tsx - Admin Bounty Detail with status transitions
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminCard } from '../../../components/admin/AdminCard';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { AdminStatRow } from '../../../components/admin/AdminStatRow';
import { AdminStatusBadge } from '../../../components/admin/AdminStatusBadge';
import { adminDataClient } from '../../../lib/admin/adminDataClient';
import type { AdminBounty } from '../../../lib/types-admin';

export default function AdminBountyDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [bounty, setBounty] = useState<AdminBounty | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const loadBounty = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminBountyById(id);
      setBounty(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load bounty');
      console.error('Error loading bounty:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBounty();
  }, [id]);

  const handleStatusChange = async (newStatus: AdminBounty['status']) => {
    if (!bounty) return;

    Alert.alert(
      'Change Status',
      `Change bounty status to "${newStatus}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setIsUpdating(true);
            try {
              const updated = await adminDataClient.updateBountyStatus(bounty.id, newStatus);
              setBounty(updated);
              Alert.alert('Success', 'Bounty status updated');
            } catch (err) {
              Alert.alert('Error', err instanceof Error ? err.message : 'Failed to update status');
            } finally {
              setIsUpdating(false);
            }
          },
        },
      ]
    );
  };

  const statusTransitions: Record<AdminBounty['status'], { status: AdminBounty['status']; label: string; icon: string }[]> = {
    open: [
      { status: 'in_progress', label: 'Start Progress', icon: 'play-arrow' },
      { status: 'archived', label: 'Archive', icon: 'archive' },
    ],
    in_progress: [
      { status: 'completed', label: 'Complete', icon: 'check' },
      { status: 'open', label: 'Reopen', icon: 'refresh' },
      { status: 'archived', label: 'Archive', icon: 'archive' },
    ],
    completed: [
      { status: 'archived', label: 'Archive', icon: 'archive' },
    ],
    archived: [
      { status: 'open', label: 'Reopen', icon: 'refresh' },
    ],
  };

  if (isLoading) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Bounty Detail" onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00dc50" />
        </View>
      </View>
    );
  }

  if (error || !bounty) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Bounty Detail" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.3)" />
          <Text style={styles.errorTitle}>Failed to load bounty</Text>
          <Text style={styles.errorText}>{error || 'Bounty not found'}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={loadBounty}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Bounty Detail" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Status */}
        <View style={styles.statusSection}>
          <AdminStatusBadge status={bounty.status} type="bounty" />
          {(bounty.flaggedCount ?? 0) > 0 && (
            <View style={styles.flaggedBadge}>
              <MaterialIcons name="flag" size={16} color="#f44336" />
              <Text style={styles.flaggedText}>Flagged {bounty.flaggedCount}×</Text>
            </View>
          )}
        </View>

        {/* Title & Description */}
        <View style={styles.section}>
          <Text style={styles.title}>{bounty.title}</Text>
          <Text style={styles.description}>{bounty.description}</Text>
        </View>

        {/* Bounty Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Bounty Information</Text>
          <AdminCard>
            <AdminStatRow
              label="Amount"
              value={bounty.isForHonor ? 'For Honor' : `$${bounty.amount?.toFixed(2)}`}
            />
            {bounty.location && <AdminStatRow label="Location" value={bounty.location} />}
            <AdminStatRow label="Posted By" value={bounty.user_id} />
            {bounty.acceptedBy && <AdminStatRow label="Accepted By" value={bounty.acceptedBy} />}
            <AdminStatRow label="Created" value={formatDate(bounty.createdAt)} />
            {bounty.lastModified && <AdminStatRow label="Last Modified" value={formatDate(bounty.lastModified)} />}
          </AdminCard>
        </View>

        {/* Status Transitions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status Actions</Text>
          <View style={styles.actionsGrid}>
            {statusTransitions[bounty.status]?.map((action) => (
              <TouchableOpacity accessibilityRole="button"
                key={action.status}
                style={styles.actionButton}
                onPress={() => handleStatusChange(action.status)}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <ActivityIndicator size="small" color="#fffef5" />
                ) : (
                  <>
                    <MaterialIcons name={action.icon as any} size={24} color="#fffef5" />
                    <Text style={styles.actionButtonText}>{action.label}</Text>
                  </>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString();
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fffef5',
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#00912C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  retryButtonText: {
    color: '#fffef5',
    fontSize: 14,
    fontWeight: '600',
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 20,
  },
  flaggedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244,67,54,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.4)',
  },
  flaggedText: {
    fontSize: 11,
    color: '#f44336',
    fontWeight: '600',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.8)',
    lineHeight: 22,
  },
  actionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  actionButton: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#00912C',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.4)',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fffef5',
  },
});
