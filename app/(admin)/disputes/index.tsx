// app/(admin)/disputes/index.tsx - Admin dispute list and review screen
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { AdminHeader } from '../../../components/admin/AdminHeader';
import { AdminCard } from '../../../components/admin/AdminCard';
import { disputeService } from '../../../lib/services/dispute-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { getDisputeStatusColor, getDisputeStatusIcon } from '../../../lib/utils/dispute-helpers';
import type { BountyDispute } from '../../../lib/types';
import { ROUTES } from '../../../lib/routes';

import { colors } from '../../../lib/theme';
interface DisputeWithBounty extends BountyDispute {
  bountyTitle?: string;
  bountyAmount?: number;
}

export default function AdminDisputesScreen() {
  const router = useRouter();
  const [disputes, setDisputes] = useState<DisputeWithBounty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'under_review' | 'resolved'>('all');

  const loadDisputes = useCallback(async () => {
    try {
      setError(null);
      const allDisputes = await disputeService.getAllActiveDisputes();
      
      // Fetch bounty details for each dispute
      const disputesWithBounties = await Promise.all(
        allDisputes.map(async (dispute) => {
          try {
            const bounty = await bountyService.getById(dispute.bountyId);
            return {
              ...dispute,
              bountyTitle: bounty?.title,
              bountyAmount: bounty?.amount,
            };
          } catch (err) {
            console.error(`Error fetching bounty ${dispute.bountyId}:`, err);
            return dispute;
          }
        })
      );

      setDisputes(disputesWithBounties);
    } catch (err) {
      console.error('Error loading disputes:', err);
      setError('Failed to load disputes');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadDisputes();
  }, [loadDisputes]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    loadDisputes();
  }, [loadDisputes]);

  const handleDisputePress = (disputeId: string) => {
    router.push(ROUTES.ADMIN.DISPUTE_DETAIL(disputeId) as any);
  };

  const handleMarkUnderReview = async (disputeId: string) => {
    try {
      const success = await disputeService.updateDisputeStatus(disputeId, 'under_review');
      if (success) {
        Alert.alert('Success', 'Dispute marked as under review');
        loadDisputes();
      } else {
        Alert.alert('Error', 'Failed to update dispute status');
      }
    } catch (error) {
      console.error('Error updating dispute:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    }
  };

  const filteredDisputes = disputes.filter((dispute) => {
    if (filter === 'all') return true;
    return dispute.status === filter;
  });

  const stats = {
    total: disputes.length,
    open: disputes.filter(d => d.status === 'open').length,
    underReview: disputes.filter(d => d.status === 'under_review').length,
    resolved: disputes.filter(d => d.status === 'resolved').length,
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Dispute Resolution" />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary[600]} />
          <Text style={styles.loadingText}>Loading disputes...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Dispute Resolution" />
      
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#00dc50"
          />
        }
      >
        {/* Stats Overview */}
        <View style={styles.statsContainer}>
          <AdminCard>
            <View style={styles.statsGrid}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{stats.total}</Text>
                <Text style={styles.statLabel}>Total</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#f59e0b' }]}>
                  {stats.open}
                </Text>
                <Text style={styles.statLabel}>Open</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: '#3b82f6' }]}>
                  {stats.underReview}
                </Text>
                <Text style={styles.statLabel}>Reviewing</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={[styles.statValue, { color: colors.primary[500] }]}>
                  {stats.resolved}
                </Text>
                <Text style={styles.statLabel}>Resolved</Text>
              </View>
            </View>
          </AdminCard>
        </View>

        {/* Filter Tabs */}
        <View style={styles.filterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {(['all', 'open', 'under_review', 'resolved'] as const).map((status) => (
              <TouchableOpacity
                key={status}
                onPress={() => setFilter(status)}
                style={[
                  styles.filterTab,
                  filter === status && styles.filterTabActive,
                ]}
              >
                <Text
                  style={[
                    styles.filterTabText,
                    filter === status && styles.filterTabTextActive,
                  ]}
                >
                  {status === 'all'
                    ? 'All'
                    : status === 'under_review'
                    ? 'Under Review'
                    : status.charAt(0).toUpperCase() + status.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Error Banner */}
        {error && (
          <View style={styles.errorBanner}>
            <MaterialIcons name="error-outline" size={20} color="#f44336" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadDisputes} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Disputes List */}
        {filteredDisputes.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="check-circle-outline" size={64} color="rgba(255,254,245,0.3)" />
            <Text style={styles.emptyTitle}>
              {filter === 'all' ? 'No disputes found' : `No ${filter.replace('_', ' ')} disputes`}
            </Text>
            <Text style={styles.emptySubtitle}>
              {filter === 'all'
                ? 'All disputes have been resolved'
                : 'There are no disputes in this category'}
            </Text>
          </View>
        ) : (
          <View style={styles.disputesList}>
            {filteredDisputes.map((dispute) => (
              <TouchableOpacity
                key={dispute.id}
                onPress={() => handleDisputePress(dispute.id)}
                style={styles.disputeCard}
              >
                <AdminCard>
                  {/* Header */}
                  <View style={styles.disputeHeader}>
                    <View style={styles.disputeHeaderLeft}>
                      <MaterialIcons
                        name={getDisputeStatusIcon(dispute.status) as any}
                        size={24}
                        color={getDisputeStatusColor(dispute.status)}
                      />
                      <View style={styles.disputeHeaderText}>
                        <Text style={styles.disputeTitle} numberOfLines={1}>
                          {dispute.bountyTitle || 'Unknown Bounty'}
                        </Text>
                        <Text style={styles.disputeSubtitle}>
                          {dispute.bountyAmount
                            ? `$${dispute.bountyAmount.toFixed(2)}`
                            : 'Amount N/A'}
                        </Text>
                      </View>
                    </View>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: getDisputeStatusColor(dispute.status) },
                      ]}
                    >
                      <Text style={styles.statusBadgeText}>
                        {dispute.status.replace('_', ' ').toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  {/* Reason */}
                  <View style={styles.disputeContent}>
                    <Text style={styles.disputeReason} numberOfLines={3}>
                      {dispute.reason}
                    </Text>
                  </View>

                  {/* Meta Info */}
                  <View style={styles.disputeMeta}>
                    <View style={styles.metaItem}>
                      <MaterialIcons name="access-time" size={14} color="rgba(255,254,245,0.6)" />
                      <Text style={styles.metaText}>
                        {new Date(dispute.createdAt).toLocaleDateString()}
                      </Text>
                    </View>
                    {dispute.evidence && dispute.evidence.length > 0 && (
                      <View style={styles.metaItem}>
                        <MaterialIcons name="attach-file" size={14} color="rgba(255,254,245,0.6)" />
                        <Text style={styles.metaText}>
                          {dispute.evidence.length} evidence item{dispute.evidence.length !== 1 ? 's' : ''}
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Quick Actions */}
                  {dispute.status === 'open' && (
                    <View style={styles.quickActions}>
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          handleMarkUnderReview(dispute.id);
                        }}
                        style={styles.quickActionButton}
                      >
                        <MaterialIcons name="visibility" size={16} color="#fffef5" />
                        <Text style={styles.quickActionText}>Mark Under Review</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </AdminCard>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Bottom Padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
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
    gap: 16,
  },
  loadingText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
  },
  statsContainer: {
    marginBottom: 16,
  },
  statsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(0,145,44,0.15)',
  },
  filterTabActive: {
    backgroundColor: '#00912C',
  },
  filterTabText: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.6)',
  },
  filterTabTextActive: {
    color: '#fffef5',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.4)',
    gap: 8,
  },
  errorText: {
    flex: 1,
    color: '#f44336',
    fontSize: 13,
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f44336',
    borderRadius: 4,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fffef5',
    marginTop: 16,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
    textAlign: 'center',
  },
  disputesList: {
    gap: 12,
  },
  disputeCard: {
    marginBottom: 0,
  },
  disputeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  disputeHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  disputeHeaderText: {
    flex: 1,
  },
  disputeTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
    marginBottom: 2,
  },
  disputeSubtitle: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  disputeContent: {
    marginBottom: 12,
  },
  disputeReason: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
    lineHeight: 20,
  },
  disputeMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,145,44,0.2)',
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
  quickActions: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,145,44,0.2)',
  },
  quickActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00912C',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    gap: 6,
  },
  quickActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fffef5',
  },
});
