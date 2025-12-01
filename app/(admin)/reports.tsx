// app/(admin)/reports.tsx - Enhanced Reports/Moderation Queue Screen
// Follows Apple Human Interface Guidelines for clean, accessible design
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { ROUTES } from '../../lib/routes';
import { reportService } from '../../lib/services/report-service';
import type { EnhancedReport, ReportStats } from '../../lib/types-admin';

type FilterStatus = 'all' | 'pending' | 'reviewed' | 'resolved' | 'dismissed';
type FilterPriority = 'all' | 'critical' | 'high' | 'medium' | 'low';
type SortOption = 'newest' | 'oldest' | 'priority';

/**
 * Calculate priority based on report reason and age.
 * Fraud and harassment reports escalate to critical after a time threshold.
 */
function calculatePriority(
  reason: string,
  createdAt: string
): 'low' | 'medium' | 'high' | 'critical' {
  const ageHours = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60);

  // Fraud and harassment are always higher priority
  if (reason === 'fraud') return ageHours > 24 ? 'critical' : 'high';
  if (reason === 'harassment') return ageHours > 48 ? 'critical' : 'high';
  if (reason === 'inappropriate') return ageHours > 72 ? 'high' : 'medium';
  if (reason === 'spam') return ageHours > 96 ? 'medium' : 'low';

  return 'low';
}

/**
 * Calculate stats from a list of reports.
 * Extracted for reusability and maintainability.
 */
function calculateStatsFromReports(reports: EnhancedReport[]): ReportStats {
  return {
    pending: reports.filter((r) => r.status === 'pending').length,
    reviewed: reports.filter((r) => r.status === 'reviewed').length,
    resolved: reports.filter((r) => r.status === 'resolved').length,
    dismissed: reports.filter((r) => r.status === 'dismissed').length,
    critical: reports.filter((r) => r.priority === 'critical').length,
    high: reports.filter((r) => r.priority === 'high').length,
  };
}

/**
 * Mock data for development with enhanced fields.
 * In production, this would be fetched from the API.
 */
const mockReports: EnhancedReport[] = [
  {
    id: 'report-001',
    user_id: 'user-123',
    reporter_name: '@safeuser',
    content_type: 'bounty',
    content_id: 'bounty-456',
    reason: 'fraud',
    details: 'This bounty appears to be a scam. The poster is asking for upfront payment.',
    status: 'pending',
    priority: 'critical',
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: 'report-002',
    user_id: 'user-456',
    reporter_name: '@concerned',
    content_type: 'message',
    content_id: 'msg-789',
    reason: 'harassment',
    details: 'User sent threatening messages after I declined their offer.',
    status: 'pending',
    priority: 'high',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'report-003',
    user_id: 'user-789',
    reporter_name: '@vigilant',
    content_type: 'profile',
    content_id: 'user-spam-001',
    reason: 'spam',
    details: 'Profile contains promotional links and suspicious content.',
    status: 'pending',
    priority: 'low',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: 'report-004',
    user_id: 'user-111',
    reporter_name: '@helpful',
    content_type: 'bounty',
    content_id: 'bounty-222',
    reason: 'inappropriate',
    details: 'Bounty description contains inappropriate language.',
    status: 'reviewed',
    priority: 'medium',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    reviewed_by: 'admin-001',
    reviewed_at: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
  },
  {
    id: 'report-005',
    user_id: 'user-333',
    reporter_name: '@guardian',
    content_type: 'message',
    content_id: 'msg-444',
    reason: 'harassment',
    details: 'Multiple users have reported this account for aggressive behavior.',
    status: 'resolved',
    priority: 'high',
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
    reviewed_by: 'admin-002',
    reviewed_at: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
    resolution_notes: 'User account suspended for 7 days.',
  },
];

export default function AdminReportsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [reports, setReports] = useState<EnhancedReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Filter states
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('pending');
  const [priorityFilter, setPriorityFilter] = useState<FilterPriority>('all');
  const [sortBy, setSortBy] = useState<SortOption>('priority');

  // Stats for the header
  const [stats, setStats] = useState<ReportStats>({
    pending: 0,
    reviewed: 0,
    resolved: 0,
    dismissed: 0,
    critical: 0,
    high: 0,
  });

  const fetchReports = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Use mock data for now, will integrate with real service
      const result = await reportService.getAllReports({
        status: statusFilter === 'all' ? undefined : statusFilter,
      });

      if (result.success && result.reports) {
        // Enhance reports with priority calculation
        const enhanced: EnhancedReport[] = result.reports.map((r: any) => ({
          ...r,
          priority: calculatePriority(r.reason, r.created_at),
        }));
        setReports(enhanced);
        setStats(calculateStatsFromReports(enhanced));
      } else {
        // Fall back to mock data for demo
        setReports(mockReports);
        setStats(calculateStatsFromReports(mockReports));
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
      // Fall back to mock data
      setReports(mockReports);
      setStats(calculateStatsFromReports(mockReports));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  // Filter and sort reports
  const filteredReports = useMemo(() => {
    let result = [...reports];

    // Apply status filter
    if (statusFilter !== 'all') {
      result = result.filter((r) => r.status === statusFilter);
    }

    // Apply priority filter
    if (priorityFilter !== 'all') {
      result = result.filter((r) => r.priority === priorityFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (r) =>
          r.details?.toLowerCase().includes(query) ||
          r.content_id.toLowerCase().includes(query) ||
          r.reporter_name?.toLowerCase().includes(query) ||
          r.reason.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      if (sortBy === 'priority') {
        const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      if (sortBy === 'oldest') {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      // newest (default)
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return result;
  }, [reports, statusFilter, priorityFilter, searchQuery, sortBy]);

  const handleUpdateStatus = useCallback(
    async (reportId: string, status: 'reviewed' | 'resolved' | 'dismissed') => {
      // Haptic feedback
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      try {
        const result = await reportService.updateReportStatus(reportId, status);
        if (result.success) {
          // Update local state optimistically
          setReports((prev) =>
            prev.map((r) =>
              r.id === reportId
                ? { ...r, status, reviewed_at: new Date().toISOString() }
                : r
            )
          );
          Alert.alert('Success', `Report marked as ${status}`);
        } else {
          Alert.alert('Error', result.error || 'Failed to update report');
        }
      } catch (err) {
        console.error('Error updating report:', err);
        Alert.alert('Error', 'An error occurred while updating the report');
      }
    },
    []
  );

  const showActionSheet = useCallback(
    (report: EnhancedReport) => {
      if (Platform.OS !== 'web') {
        Haptics.selectionAsync();
      }

      Alert.alert(
        'Report Actions',
        `What would you like to do with this ${report.content_type} report?`,
        [
          {
            text: 'View Content',
            onPress: () => {
              // Navigate to the reported content using ROUTES constants
              if (report.content_type === 'bounty') {
                router.push(ROUTES.ADMIN.BOUNTY_DETAIL(report.content_id));
              } else if (report.content_type === 'profile') {
                router.push(ROUTES.ADMIN.USER_DETAIL(report.content_id));
              }
            },
          },
          {
            text: 'Mark as Reviewed',
            onPress: () => handleUpdateStatus(report.id, 'reviewed'),
          },
          {
            text: 'Resolve',
            onPress: () => handleUpdateStatus(report.id, 'resolved'),
          },
          {
            text: 'Dismiss',
            style: 'destructive',
            onPress: () => handleUpdateStatus(report.id, 'dismissed'),
          },
          { text: 'Cancel', style: 'cancel' },
        ]
      );
    },
    [router, handleUpdateStatus]
  );

  // Icon and color helpers
  const getContentTypeIcon = (type: string): keyof typeof MaterialIcons.glyphMap => {
    switch (type) {
      case 'bounty':
        return 'work';
      case 'profile':
        return 'person';
      case 'message':
        return 'message';
      default:
        return 'help-outline';
    }
  };

  const getPriorityConfig = (priority: string) => {
    switch (priority) {
      case 'critical':
        return { color: '#dc2626', bg: 'rgba(220,38,38,0.15)', icon: 'error' };
      case 'high':
        return { color: '#f97316', bg: 'rgba(249,115,22,0.15)', icon: 'warning' };
      case 'medium':
        return { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)', icon: 'info' };
      case 'low':
        return { color: '#008e2a', bg: 'rgba(0,142,42,0.15)', icon: 'check-circle' };
      default:
        return { color: '#aad9b8', bg: 'rgba(167,243,208,0.15)', icon: 'help' };
    }
  };

  const getReasonConfig = (reason: string) => {
    switch (reason) {
      case 'fraud':
        return { color: '#dc2626', label: 'Fraud' };
      case 'harassment':
        return { color: '#ef4444', label: 'Harassment' };
      case 'inappropriate':
        return { color: '#f97316', label: 'Inappropriate' };
      case 'spam':
        return { color: '#fbbf24', label: 'Spam' };
      default:
        return { color: '#aad9b8', label: reason };
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  // Segmented control for status filter (Apple HIG style)
  const StatusSegmentedControl = () => (
    <View style={styles.segmentedContainer}>
      <View style={styles.segmentedControl}>
        {(['pending', 'all', 'reviewed', 'resolved'] as FilterStatus[]).map((status) => (
          <TouchableOpacity
            key={status}
            style={[
              styles.segmentButton,
              statusFilter === status && styles.segmentButtonActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.selectionAsync();
              }
              setStatusFilter(status);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: statusFilter === status }}
            accessibilityLabel={`Filter by ${status} reports`}
          >
            <Text
              style={[
                styles.segmentButtonText,
                statusFilter === status && styles.segmentButtonTextActive,
              ]}
            >
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Text>
            {status === 'pending' && stats.pending > 0 && (
              <View style={styles.badgeContainer}>
                <Text style={styles.badgeText}>{stats.pending}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  // Stats summary bar
  const StatsSummary = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statsRow}>
        {stats.critical > 0 && (
          <View style={[styles.statBadge, { backgroundColor: 'rgba(220,38,38,0.15)' }]}>
            <MaterialIcons name="error" size={14} color="#dc2626" />
            <Text style={[styles.statBadgeText, { color: '#dc2626' }]}>
              {stats.critical} Critical
            </Text>
          </View>
        )}
        {stats.high > 0 && (
          <View style={[styles.statBadge, { backgroundColor: 'rgba(249,115,22,0.15)' }]}>
            <MaterialIcons name="warning" size={14} color="#f97316" />
            <Text style={[styles.statBadgeText, { color: '#f97316' }]}>
              {stats.high} High
            </Text>
          </View>
        )}
        <View style={[styles.statBadge, { backgroundColor: 'rgba(0,142,42,0.15)' }]}>
          <MaterialIcons name="pending" size={14} color="#008e2a" />
          <Text style={[styles.statBadgeText, { color: '#008e2a' }]}>
            {stats.pending} Pending
          </Text>
        </View>
      </View>
    </View>
  );

  // Search bar
  const SearchBar = () => (
    <View style={styles.searchContainer}>
      <View style={styles.searchInputWrapper}>
        <MaterialIcons name="search" size={20} color="rgba(255,254,245,0.5)" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search reports..."
          placeholderTextColor="rgba(255,254,245,0.4)"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          accessibilityLabel="Search reports"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity
            onPress={() => setSearchQuery('')}
            accessibilityLabel="Clear search"
          >
            <MaterialIcons name="close" size={18} color="rgba(255,254,245,0.5)" />
          </TouchableOpacity>
        )}
      </View>
      <TouchableOpacity
        style={styles.sortButton}
        onPress={() => {
          if (Platform.OS !== 'web') {
            Haptics.selectionAsync();
          }
          // Cycle through sort options
          const options: SortOption[] = ['priority', 'newest', 'oldest'];
          const currentIndex = options.indexOf(sortBy);
          setSortBy(options[(currentIndex + 1) % options.length]);
        }}
        accessibilityLabel={`Sort by ${sortBy}`}
      >
        <MaterialIcons name="sort" size={20} color="#aad9b8" />
        <Text style={styles.sortButtonText}>
          {sortBy === 'priority' ? 'Priority' : sortBy === 'newest' ? 'Newest' : 'Oldest'}
        </Text>
      </TouchableOpacity>
    </View>
  );

  // Report card component
  const renderReportCard = ({ item: report }: { item: EnhancedReport }) => {
    const priorityConfig = getPriorityConfig(report.priority);
    const reasonConfig = getReasonConfig(report.reason);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => showActionSheet(report)}
        onLongPress={() => {
          if (Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          }
          showActionSheet(report);
        }}
        accessibilityRole="button"
        accessibilityLabel={`${report.priority} priority ${report.content_type} report for ${report.reason}. ${formatTimeAgo(report.created_at)}`}
      >
        <AdminCard>
          <View style={styles.reportCard}>
            {/* Priority indicator bar */}
            <View
              style={[styles.priorityBar, { backgroundColor: priorityConfig.color }]}
            />

            {/* Header row */}
            <View style={styles.reportHeader}>
              <View style={styles.reportHeaderLeft}>
                <View
                  style={[
                    styles.contentTypeIcon,
                    { backgroundColor: 'rgba(0,142,42,0.2)' },
                  ]}
                >
                  <MaterialIcons
                    name={getContentTypeIcon(report.content_type)}
                    size={18}
                    color="#00dc50"
                  />
                </View>
                <View>
                  <Text style={styles.reportContentType}>
                    {report.content_type.charAt(0).toUpperCase() +
                      report.content_type.slice(1)}
                  </Text>
                  <Text style={styles.reportTime}>
                    {formatTimeAgo(report.created_at)}
                  </Text>
                </View>
              </View>
              <View style={styles.reportHeaderRight}>
                <View
                  style={[styles.priorityBadge, { backgroundColor: priorityConfig.bg }]}
                >
                  <MaterialIcons
                    name={priorityConfig.icon as any}
                    size={12}
                    color={priorityConfig.color}
                  />
                  <Text style={[styles.priorityText, { color: priorityConfig.color }]}>
                    {report.priority.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            {/* Reason badge */}
            <View style={styles.reasonRow}>
              <View
                style={[
                  styles.reasonBadge,
                  { backgroundColor: reasonConfig.color + '20' },
                ]}
              >
                <Text style={[styles.reasonText, { color: reasonConfig.color }]}>
                  {reasonConfig.label}
                </Text>
              </View>
              {report.reporter_name && (
                <Text style={styles.reporterName}>by {report.reporter_name}</Text>
              )}
            </View>

            {/* Details */}
            {report.details && (
              <Text style={styles.reportDetails} numberOfLines={3}>
                {report.details}
              </Text>
            )}

            {/* Quick actions for pending reports */}
            {report.status === 'pending' && (
              <View style={styles.quickActions}>
                <TouchableOpacity
                  style={[styles.quickActionButton, styles.reviewAction]}
                  onPress={() => handleUpdateStatus(report.id, 'reviewed')}
                  accessibilityLabel="Mark as reviewed"
                >
                  <MaterialIcons name="visibility" size={16} color="#3b82f6" />
                  <Text style={styles.reviewActionText}>Review</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickActionButton, styles.resolveAction]}
                  onPress={() => handleUpdateStatus(report.id, 'resolved')}
                  accessibilityLabel="Resolve report"
                >
                  <MaterialIcons name="check-circle" size={16} color="#008e2a" />
                  <Text style={styles.resolveActionText}>Resolve</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.quickActionButton, styles.dismissAction]}
                  onPress={() => handleUpdateStatus(report.id, 'dismissed')}
                  accessibilityLabel="Dismiss report"
                >
                  <MaterialIcons name="close" size={16} color="#ef4444" />
                  <Text style={styles.dismissActionText}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Resolution info for resolved reports */}
            {report.status === 'resolved' && report.resolution_notes && (
              <View style={styles.resolutionInfo}>
                <MaterialIcons name="check-circle" size={14} color="#008e2a" />
                <Text style={styles.resolutionText}>{report.resolution_notes}</Text>
              </View>
            )}
          </View>
        </AdminCard>
      </TouchableOpacity>
    );
  };

  // Empty state
  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <MaterialIcons
          name={statusFilter === 'pending' ? 'check-circle' : 'inbox'}
          size={64}
          color="#008e2a"
        />
      </View>
      <Text style={styles.emptyTitle}>
        {statusFilter === 'pending' ? 'All Clear!' : 'No Reports Found'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {statusFilter === 'pending'
          ? 'No reports need your attention right now.'
          : 'Try adjusting your filters to see more reports.'}
      </Text>
      {statusFilter !== 'all' && (
        <TouchableOpacity
          style={styles.viewAllButton}
          onPress={() => setStatusFilter('all')}
        >
          <Text style={styles.viewAllButtonText}>View All Reports</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (error && reports.length === 0) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Moderation Queue" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchReports}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Moderation Queue"
        onBack={() => router.back()}
        actions={
          <TouchableOpacity
            onPress={() => router.push(ROUTES.ADMIN.AUDIT_LOGS)}
            style={styles.headerAction}
            accessibilityLabel="View audit logs"
          >
            <MaterialIcons name="history" size={22} color="#c8ffe0" />
          </TouchableOpacity>
        }
      />

      {/* Stats summary */}
      <StatsSummary />

      {/* Segmented control for status */}
      <StatusSegmentedControl />

      {/* Search and sort */}
      <SearchBar />

      {/* Reports list */}
      <FlatList
        data={filteredReports}
        renderItem={renderReportCard}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 16 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchReports}
            tintColor="#008e2a"
            colors={['#008e2a']}
          />
        }
        ListEmptyComponent={<EmptyState />}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={5}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  headerAction: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  statsContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  statBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  segmentedContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
    padding: 3,
  },
  segmentButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  segmentButtonActive: {
    backgroundColor: '#007523',
  },
  segmentButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255,254,245,0.6)',
  },
  segmentButtonTextActive: {
    color: '#ffffff',
    fontWeight: '600',
  },
  badgeContainer: {
    backgroundColor: '#dc2626',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 10,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#ffffff',
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
  },
  sortButtonText: {
    fontSize: 13,
    color: '#aad9b8',
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  reportCard: {
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  priorityBar: {
    position: 'absolute',
    left: -16,
    top: -16,
    bottom: -16,
    width: 4,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  contentTypeIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportContentType: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  reportTime: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
    marginTop: 2,
  },
  reportHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reasonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reasonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  reporterName: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
  },
  reportDetails: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
    lineHeight: 20,
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  quickActionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    borderRadius: 8,
  },
  reviewAction: {
    backgroundColor: 'rgba(59,130,246,0.15)',
  },
  reviewActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3b82f6',
  },
  resolveAction: {
    backgroundColor: 'rgba(0,142,42,0.15)',
  },
  resolveActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#008e2a',
  },
  dismissAction: {
    backgroundColor: 'rgba(239,68,68,0.15)',
  },
  dismissActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#ef4444',
  },
  resolutionInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(0,142,42,0.1)',
    padding: 10,
    borderRadius: 8,
  },
  resolutionText: {
    flex: 1,
    fontSize: 13,
    color: '#008e2a',
    lineHeight: 18,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    paddingHorizontal: 32,
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(0,142,42,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.6)',
    textAlign: 'center',
    lineHeight: 22,
  },
  viewAllButton: {
    marginTop: 20,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#008e2a',
    borderRadius: 10,
  },
  viewAllButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  errorText: {
    fontSize: 15,
    color: '#ef4444',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#008e2a',
    borderRadius: 10,
    marginTop: 8,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
});
