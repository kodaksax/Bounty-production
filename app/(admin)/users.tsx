// app/(admin)/users.tsx - Admin Users List
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../components/admin/AdminStatusBadge';
import { useAdminUsers } from '../../hooks/useAdminUsers';
import { ROUTES } from '../../lib/routes';
import type { AdminUserFilters, AdminUserSummary } from '../../lib/types-admin';

export default function AdminUsersScreen() {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminUserFilters>({ status: 'all' });
  const { users, isLoading, error, refetch } = useAdminUsers(filters);

  const statusOptions: AdminUserFilters['status'][] = ['all', 'active', 'suspended', 'banned'];

  const renderUserItem = ({ item }: { item: AdminUserSummary }) => (
    <TouchableOpacity accessibilityRole="button"
      style={styles.userCard}
      onPress={() => router.push(ROUTES.ADMIN.USER_DETAIL(item.id))}
    >
      <View style={styles.userHeader}>
        <View style={styles.userInfo}>
          <Text style={styles.username}>{item.username}</Text>
          {item.email && <Text style={styles.email}>{item.email}</Text>}
        </View>
        <AdminStatusBadge status={item.status} type="user" />
      </View>
      <View style={styles.userStats}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{item.bountiesPosted}</Text>
          <Text style={styles.statLabel}>Posted</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{item.bountiesCompleted}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>${item.balance.toFixed(0)}</Text>
          <Text style={styles.statLabel}>Balance</Text>
        </View>
      </View>
      <View style={styles.userFooter}>
        {item.verificationStatus && (
          <View style={styles.verificationBadge}>
            <MaterialIcons
              name={item.verificationStatus === 'verified' ? 'verified' : 'pending'}
              size={14}
              color={item.verificationStatus === 'verified' ? '#4caf50' : '#ffc107'}
            />
            <Text style={styles.verificationText}>{item.verificationStatus}</Text>
          </View>
        )}
        <Text style={styles.joinDate}>Joined {formatDate(item.joinDate)}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="people-outline" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.emptyTitle}>No users found</Text>
      <Text style={styles.emptyText}>
        {filters.status !== 'all' ? `No ${filters.status} users` : 'No users match this filter'}
      </Text>
      <TouchableOpacity accessibilityRole="button" style={styles.refreshButton} onPress={refetch}>
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.errorTitle}>Failed to load users</Text>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity accessibilityRole="button" style={styles.retryButton} onPress={refetch}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="Users" onBack={() => router.back()} />

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={statusOptions}
          keyExtractor={(item) => item || 'all'}
          renderItem={({ item }) => (
            <TouchableOpacity accessibilityRole="button"
              style={[styles.filterChip, filters.status === item && styles.filterChipActive]}
              onPress={() => setFilters({ ...filters, status: item })}
            >
              <Text style={[styles.filterText, filters.status === item && styles.filterTextActive]}>
                {item === 'all' ? 'All' : item}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.filtersContent}
        />
      </View>

      {/* List */}
      {error && !users.length ? (
        renderErrorState()
      ) : (
        <FlatList
          data={users}
          renderItem={renderUserItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={isLoading ? null : renderEmptyState}
          refreshing={isLoading}
          onRefresh={refetch}
        />
      )}
    </View>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 30) return `${diffDays}d ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  filtersContainer: {
    backgroundColor: '#1a3d2e',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,145,44,0.2)',
  },
  filtersContent: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#00912C',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.8)',
    textTransform: 'capitalize',
  },
  filterTextActive: {
    color: '#fffef5',
  },
  listContent: {
    padding: 16,
  },
  userCard: {
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
    gap: 12,
  },
  userInfo: {
    flex: 1,
  },
  username: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
  },
  userStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 12,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#00dc50',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.6)',
    textTransform: 'uppercase',
  },
  userFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  verificationBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  verificationText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.7)',
    textTransform: 'capitalize',
  },
  joinDate: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    minHeight: 400,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fffef5',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
    marginTop: 8,
    textAlign: 'center',
  },
  refreshButton: {
    backgroundColor: '#00912C',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  refreshButtonText: {
    color: '#fffef5',
    fontSize: 14,
    fontWeight: '600',
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
});
