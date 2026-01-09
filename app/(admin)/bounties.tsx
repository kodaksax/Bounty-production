// app/(admin)/bounties.tsx - Admin Bounties List with filters
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../components/admin/AdminStatusBadge';
import { useAdminBounties } from '../../hooks/useAdminBounties';
import { ROUTES } from '../../lib/routes';
import type { AdminBounty, AdminBountyFilters } from '../../lib/types-admin';

export default function AdminBountiesScreen() {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminBountyFilters>({ status: 'all' });
  const { bounties, isLoading, error, refetch } = useAdminBounties(filters);

  const statusOptions: AdminBountyFilters['status'][] = ['all', 'open', 'in_progress', 'completed', 'archived'];

  const renderBountyItem = ({ item }: { item: AdminBounty }) => (
    <TouchableOpacity
      style={styles.bountyCard}
      onPress={() => router.push(ROUTES.ADMIN.BOUNTY_DETAIL(item.id))}
    >
      <View style={styles.bountyHeader}>
        <Text style={styles.bountyTitle} numberOfLines={1}>
          {item.title}
        </Text>
        <AdminStatusBadge status={item.status} type="bounty" />
      </View>
      <Text style={styles.bountyDescription} numberOfLines={2}>
        {item.description}
      </Text>
      <View style={styles.bountyFooter}>
        <View style={styles.bountyMeta}>
          {item.isForHonor ? (
            <View style={styles.metaItem}>
              <MaterialIcons name="favorite" size={14} color="#00dc50" />
              <Text style={styles.metaText}>For Honor</Text>
            </View>
          ) : (
            <View style={styles.metaItem}>
              <MaterialIcons name="attach-money" size={14} color="#00dc50" />
              <Text style={styles.metaText}>${item.amount?.toFixed(2)}</Text>
            </View>
          )}
          {item.location && (
            <View style={styles.metaItem}>
              <MaterialIcons name="location-on" size={14} color="rgba(255,254,245,0.6)" />
              <Text style={styles.metaText}>{item.location}</Text>
            </View>
          )}
        </View>
        <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
      </View>
      {(item.flaggedCount ?? 0) > 0 && (
        <View style={styles.flaggedBanner}>
          <MaterialIcons name="flag" size={14} color="#f44336" />
          <Text style={styles.flaggedText}>Flagged {item.flaggedCount} times</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="work-off" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.emptyTitle}>No bounties found</Text>
      <Text style={styles.emptyText}>
        {filters.status !== 'all' ? `No ${filters.status} bounties` : 'No bounties match this filter'}
      </Text>
      <TouchableOpacity style={styles.refreshButton} onPress={refetch}>
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.errorTitle}>Failed to load bounties</Text>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={refetch}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="Bounties" onBack={() => router.back()} />

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={statusOptions}
          keyExtractor={(item) => item || 'all'}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.filterChip, filters.status === item && styles.filterChipActive]}
              onPress={() => setFilters({ ...filters, status: item })}
            >
              <Text style={[styles.filterText, filters.status === item && styles.filterTextActive]}>
                {item === 'all' ? 'All' : (item || '').replace('_', ' ')}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.filtersContent}
        />
      </View>

      {/* List */}
      {error && !bounties.length ? (
        renderErrorState()
      ) : (
        <FlatList
          data={bounties}
          renderItem={renderBountyItem}
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

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
  bountyCard: {
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
  },
  bountyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 12,
  },
  bountyTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
  bountyDescription: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.7)',
    marginBottom: 12,
    lineHeight: 20,
  },
  bountyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bountyMeta: {
    flexDirection: 'row',
    gap: 12,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
  },
  flaggedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(244,67,54,0.3)',
  },
  flaggedText: {
    fontSize: 12,
    color: '#f44336',
    fontWeight: '600',
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
