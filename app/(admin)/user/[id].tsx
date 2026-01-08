// app/(admin)/user/[id].tsx - Admin User Detail
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminCard } from '../../../components/admin/AdminCard';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { AdminStatRow } from '../../../components/admin/AdminStatRow';
import { AdminStatusBadge } from '../../../components/admin/AdminStatusBadge';
import { adminDataClient } from '../../../lib/admin/adminDataClient';
import type { AdminUserSummary } from '../../../lib/types-admin';

export default function AdminUserDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [user, setUser] = useState<AdminUserSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser = async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await adminDataClient.fetchAdminUserById(id);
      setUser(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load user');
      console.error('Error loading user:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadUser();
  }, [id]);

  if (isLoading) {
    return (
      <View style={styles.container}>
        <AdminHeader title="User Detail" onBack={() => router.back()} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00dc50" />
        </View>
      </View>
    );
  }

  if (error || !user) {
    return (
      <View style={styles.container}>
        <AdminHeader title="User Detail" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.3)" />
          <Text style={styles.errorTitle}>Failed to load user</Text>
          <Text style={styles.errorText}>{error || 'User not found'}</Text>
          <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={loadUser}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="User Detail" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Status */}
        <View style={styles.statusSection}>
          <AdminStatusBadge status={user.status} type="user" />
          {user.verificationStatus && (
            <View style={styles.verificationBadge}>
              <MaterialIcons
                name={user.verificationStatus === 'verified' ? 'verified' : 'pending'}
                size={16}
                color={user.verificationStatus === 'verified' ? '#4caf50' : '#ffc107'}
              />
              <Text style={styles.verificationText}>{user.verificationStatus}</Text>
            </View>
          )}
        </View>

        {/* User Info */}
        <View style={styles.section}>
          <Text style={styles.username}>{user.username}</Text>
          {user.email && <Text style={styles.email}>{user.email}</Text>}
        </View>

        {/* Stats Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Activity Stats</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <MaterialIcons name="post-add" size={32} color="#00dc50" />
              <Text style={styles.statCardValue}>{user.bountiesPosted}</Text>
              <Text style={styles.statCardLabel}>Posted</Text>
            </View>
            <View style={styles.statCard}>
              <MaterialIcons name="assignment-turned-in" size={32} color="#00dc50" />
              <Text style={styles.statCardValue}>{user.bountiesAccepted}</Text>
              <Text style={styles.statCardLabel}>Accepted</Text>
            </View>
            <View style={styles.statCard}>
              <MaterialIcons name="check-circle" size={32} color="#00dc50" />
              <Text style={styles.statCardValue}>{user.bountiesCompleted}</Text>
              <Text style={styles.statCardLabel}>Completed</Text>
            </View>
          </View>
        </View>

        {/* Financial Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Financial Summary</Text>
          <AdminCard>
            <AdminStatRow label="Current Balance" value={`$${user.balance.toFixed(2)}`} />
            <AdminStatRow label="Total Spent" value={`$${user.totalSpent.toFixed(2)}`} />
            <AdminStatRow label="Total Earned" value={`$${user.totalEarned.toFixed(2)}`} />
          </AdminCard>
        </View>

        {/* Account Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>
          <AdminCard>
            <AdminStatRow label="User ID" value={user.id} />
            <AdminStatRow label="Join Date" value={formatDate(user.joinDate)} />
            <AdminStatRow label="Account Status" value={user.status} />
          </AdminCard>
        </View>

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(76,175,80,0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(76,175,80,0.4)',
  },
  verificationText: {
    fontSize: 11,
    color: '#4caf50',
    fontWeight: '600',
    textTransform: 'capitalize',
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
  username: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 8,
  },
  email: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.7)',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
  },
  statCardValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#00dc50',
  },
  statCardLabel: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.6)',
    textTransform: 'uppercase',
  },
});
