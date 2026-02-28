// app/(admin)/audit-logs.tsx - Audit Log Viewer Screen
// Apple Human Interface Guidelines compliant design for transparent audit trail viewing
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { auditLogService } from '../../lib/services/audit-log-service';
import type { AuditLogCategory, AuditLogEntry } from '../../lib/types-admin';

import { colors } from '../../lib/theme';
type CategoryFilter = AuditLogCategory | 'all';
type SeverityFilter = 'all' | 'info' | 'warning' | 'critical';

export default function AuditLogsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filter states
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Stats for the header
  const [stats, setStats] = useState<{
    totalLogs: number;
    bySeverity: Record<string, number>;
    byCategory: Record<string, number>;
    recentCritical: number;
  }>({
    totalLogs: 0,
    bySeverity: { info: 0, warning: 0, critical: 0 },
    byCategory: {},
    recentCritical: 0,
  });

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await auditLogService.getAuditLogs({
        category: categoryFilter === 'all' ? undefined : categoryFilter,
        severity: severityFilter === 'all' ? undefined : severityFilter,
        searchQuery: searchQuery.trim() || undefined,
      });

      if (result.success && result.logs) {
        setLogs(result.logs);
      } else {
        setError(result.error || 'Failed to load audit logs');
      }

      // Fetch stats
      const statsResult = await auditLogService.getAuditLogStats();
      if (statsResult.success && statsResult.stats) {
        setStats(statsResult.stats);
      }
    } catch (err) {
      console.error('Error fetching audit logs:', err);
      setError('An error occurred while loading audit logs');
    } finally {
      setIsLoading(false);
    }
  }, [categoryFilter, severityFilter, searchQuery]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Filtered logs based on local filters
  const filteredLogs = useMemo(() => {
    if (!searchQuery.trim()) return logs;

    const query = searchQuery.toLowerCase();
    return logs.filter(
      (log) =>
        log.description.toLowerCase().includes(query) ||
        log.actorName?.toLowerCase().includes(query) ||
        log.action.toLowerCase().includes(query) ||
        log.category.toLowerCase().includes(query)
    );
  }, [logs, searchQuery]);

  const handleExport = useCallback(async () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    try {
      const result = await auditLogService.exportAuditLogs(
        {
          category: categoryFilter === 'all' ? undefined : categoryFilter,
          severity: severityFilter === 'all' ? undefined : severityFilter,
        },
        'csv'
      );

      if (result.success && result.data) {
        // On mobile, use Share API
        await Share.share({
          title: 'Audit Logs Export',
          message: result.data,
        });
      } else {
        Alert.alert('Export Failed', result.error || 'Unable to export logs');
      }
    } catch (err) {
      console.error('Export error:', err);
      Alert.alert('Export Error', 'Failed to export audit logs');
    }
  }, [categoryFilter, severityFilter]);

  const showLogDetail = useCallback((log: AuditLogEntry) => {
    if (Platform.OS !== 'web') {
      Haptics.selectionAsync();
    }
    setSelectedLog(log);
    setShowDetailModal(true);
  }, []);

  // Category configuration
  const getCategoryConfig = (category: string) => {
    switch (category) {
      case 'user':
        return { icon: 'person', color: '#3b82f6', label: 'User' };
      case 'bounty':
        return { icon: 'work', color: colors.primary[500], label: 'Bounty' };
      case 'payment':
        return { icon: 'account-balance-wallet', color: '#8b5cf6', label: 'Payment' };
      case 'moderation':
        return { icon: 'shield', color: '#f59e0b', label: 'Moderation' };
      case 'system':
        return { icon: 'settings', color: '#6b7280', label: 'System' };
      case 'security':
        return { icon: 'security', color: '#ef4444', label: 'Security' };
      default:
        return { icon: 'info', color: '#a7f3d0', label: category };
    }
  };

  // Severity configuration
  const getSeverityConfig = (severity: string) => {
    switch (severity) {
      case 'critical':
        return { color: '#dc2626', bg: 'rgba(220,38,38,0.15)', label: 'Critical' };
      case 'warning':
        return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: 'Warning' };
      case 'info':
      default:
        return { color: colors.primary[500], bg: 'rgba(16,185,129,0.15)', label: 'Info' };
    }
  };

  // Format timestamp
  const formatTimestamp = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Format full timestamp for detail view
  const formatFullTimestamp = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  // Category filter chips
  const CategoryFilters = () => {
    const categories: { id: CategoryFilter; label: string; icon: string }[] = [
      { id: 'all', label: 'All', icon: 'list' },
      { id: 'moderation', label: 'Moderation', icon: 'shield' },
      { id: 'user', label: 'Users', icon: 'person' },
      { id: 'bounty', label: 'Bounties', icon: 'work' },
      { id: 'payment', label: 'Payments', icon: 'account-balance-wallet' },
      { id: 'security', label: 'Security', icon: 'security' },
      { id: 'system', label: 'System', icon: 'settings' },
    ];

    return (
      <View style={styles.filterChipsContainer}>
        {categories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[
              styles.filterChip,
              categoryFilter === cat.id && styles.filterChipActive,
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.selectionAsync();
              }
              setCategoryFilter(cat.id);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: categoryFilter === cat.id }}
          >
            <MaterialIcons
              name={cat.icon as any}
              size={14}
              color={categoryFilter === cat.id ? '#1a3d2e' : '#a7f3d0'}
            />
            <Text
              style={[
                styles.filterChipText,
                categoryFilter === cat.id && styles.filterChipTextActive,
              ]}
            >
              {cat.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  // Severity filter row
  const SeverityFilters = () => (
    <View style={styles.severityFiltersRow}>
      <Text style={styles.severityLabel}>Severity:</Text>
      {(['all', 'info', 'warning', 'critical'] as SeverityFilter[]).map((sev) => {
        const config =
          sev === 'all'
            ? { color: '#a7f3d0', bg: 'transparent', label: 'All' }
            : getSeverityConfig(sev);
        return (
          <TouchableOpacity
            key={sev}
            style={[
              styles.severityChip,
              severityFilter === sev && {
                backgroundColor: sev === 'all' ? 'rgba(167,243,208,0.2)' : config.bg,
              },
            ]}
            onPress={() => {
              if (Platform.OS !== 'web') {
                Haptics.selectionAsync();
              }
              setSeverityFilter(sev);
            }}
          >
            {sev !== 'all' && (
              <View
                style={[styles.severityDot, { backgroundColor: config.color }]}
              />
            )}
            <Text
              style={[
                styles.severityChipText,
                severityFilter === sev && { color: config.color },
              ]}
            >
              {config.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  // Stats summary
  const StatsSummary = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats.totalLogs}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        {stats.recentCritical > 0 && (
          <View style={[styles.statItem, styles.criticalStat]}>
            <Text style={[styles.statValue, { color: '#dc2626' }]}>
              {stats.recentCritical}
            </Text>
            <Text style={[styles.statLabel, { color: '#dc2626' }]}>
              Critical (24h)
            </Text>
          </View>
        )}
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: '#f59e0b' }]}>
            {stats.bySeverity?.warning ?? 0}
          </Text>
          <Text style={styles.statLabel}>Warnings</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={[styles.statValue, { color: colors.primary[500] }]}>
            {stats.bySeverity?.info ?? 0}
          </Text>
          <Text style={styles.statLabel}>Info</Text>
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
          placeholder="Search logs..."
          placeholderTextColor="rgba(255,254,245,0.4)"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          accessibilityLabel="Search audit logs"
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
        style={styles.exportButton}
        onPress={handleExport}
        accessibilityLabel="Export logs"
      >
        <MaterialIcons name="file-download" size={20} color="#a7f3d0" />
      </TouchableOpacity>
    </View>
  );

  // Log entry card
  const renderLogEntry = ({ item: log }: { item: AuditLogEntry }) => {
    const categoryConfig = getCategoryConfig(log.category);
    const severityConfig = getSeverityConfig(log.severity);

    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => showLogDetail(log)}
        accessibilityRole="button"
        accessibilityLabel={`${log.category} ${log.action} log entry. ${log.description}. ${formatTimestamp(log.timestamp)}`}
      >
        <AdminCard>
          <View style={styles.logEntry}>
            {/* Severity indicator */}
            <View
              style={[
                styles.severityIndicator,
                { backgroundColor: severityConfig.color },
              ]}
            />

            {/* Main content */}
            <View style={styles.logContent}>
              {/* Header row */}
              <View style={styles.logHeader}>
                <View style={styles.logHeaderLeft}>
                  <View
                    style={[
                      styles.categoryIcon,
                      { backgroundColor: categoryConfig.color + '20' },
                    ]}
                  >
                    <MaterialIcons
                      name={categoryConfig.icon as any}
                      size={16}
                      color={categoryConfig.color}
                    />
                  </View>
                  <View>
                    <Text style={styles.logAction}>
                      {log.action.replace(/_/g, ' ')}
                    </Text>
                    <Text style={styles.logTime}>
                      {formatTimestamp(log.timestamp)}
                    </Text>
                  </View>
                </View>
                <View
                  style={[styles.severityBadge, { backgroundColor: severityConfig.bg }]}
                >
                  <Text style={[styles.severityText, { color: severityConfig.color }]}>
                    {severityConfig.label}
                  </Text>
                </View>
              </View>

              {/* Description */}
              <Text style={styles.logDescription} numberOfLines={2}>
                {log.description}
              </Text>

              {/* Actor info */}
              {log.actorName && (
                <View style={styles.actorRow}>
                  <MaterialIcons
                    name="person-outline"
                    size={14}
                    color="rgba(255,254,245,0.5)"
                  />
                  <Text style={styles.actorText}>{log.actorName}</Text>
                </View>
              )}
            </View>

            {/* Chevron */}
            <MaterialIcons
              name="chevron-right"
              size={20}
              color="rgba(255,254,245,0.3)"
            />
          </View>
        </AdminCard>
      </TouchableOpacity>
    );
  };

  // Detail modal
  const LogDetailModal = () => {
    if (!selectedLog) return null;

    const categoryConfig = getCategoryConfig(selectedLog.category);
    const severityConfig = getSeverityConfig(selectedLog.severity);

    return (
      <Modal
        visible={showDetailModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowDetailModal(false)}
      >
        <View style={styles.modalContainer}>
          {/* Modal header */}
          <View style={[styles.modalHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={() => setShowDetailModal(false)}
              style={styles.modalCloseButton}
            >
              <MaterialIcons name="close" size={24} color="#fffef5" />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>Log Details</Text>
            <View style={{ width: 36 }} />
          </View>

          {/* Modal content */}
          <View style={styles.modalContent}>
            {/* Category and severity header */}
            <View style={styles.detailHeaderRow}>
              <View
                style={[
                  styles.detailCategoryBadge,
                  { backgroundColor: categoryConfig.color + '20' },
                ]}
              >
                <MaterialIcons
                  name={categoryConfig.icon as any}
                  size={18}
                  color={categoryConfig.color}
                />
                <Text style={[styles.detailCategoryText, { color: categoryConfig.color }]}>
                  {categoryConfig.label}
                </Text>
              </View>
              <View
                style={[styles.detailSeverityBadge, { backgroundColor: severityConfig.bg }]}
              >
                <Text style={[styles.detailSeverityText, { color: severityConfig.color }]}>
                  {severityConfig.label}
                </Text>
              </View>
            </View>

            {/* Action */}
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Action</Text>
              <Text style={styles.detailValue}>
                {selectedLog.action.replace(/_/g, ' ').toUpperCase()}
              </Text>
            </View>

            {/* Description */}
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Description</Text>
              <Text style={styles.detailDescription}>{selectedLog.description}</Text>
            </View>

            {/* Timestamp */}
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Timestamp</Text>
              <Text style={styles.detailValue}>
                {formatFullTimestamp(selectedLog.timestamp)}
              </Text>
            </View>

            {/* Actor */}
            {selectedLog.actorName && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Actor</Text>
                <View style={styles.detailActorRow}>
                  <View style={styles.detailActorIcon}>
                    <MaterialIcons name="person" size={16} color="#a7f3d0" />
                  </View>
                  <View>
                    <Text style={styles.detailValue}>{selectedLog.actorName}</Text>
                    {selectedLog.actorId && (
                      <Text style={styles.detailSubtext}>ID: {selectedLog.actorId}</Text>
                    )}
                  </View>
                </View>
              </View>
            )}

            {/* Target */}
            {selectedLog.targetId && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Target</Text>
                <Text style={styles.detailValue}>
                  {selectedLog.targetType?.toUpperCase()}: {selectedLog.targetId}
                </Text>
              </View>
            )}

            {/* IP Address */}
            {selectedLog.ipAddress && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>IP Address</Text>
                <Text style={styles.detailValue}>{selectedLog.ipAddress}</Text>
              </View>
            )}

            {/* Metadata */}
            {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
              <View style={styles.detailSection}>
                <Text style={styles.detailLabel}>Additional Details</Text>
                <View style={styles.metadataContainer}>
                  {Object.entries(selectedLog.metadata).map(([key, value]) => {
                    // Format key for display (camelCase to Title Case)
                    const formattedKey = key
                      .replace(/([A-Z])/g, ' $1')
                      .replace(/^./, (str) => str.toUpperCase())
                      .trim();
                    
                    // Format value based on type
                    let formattedValue: string;
                    if (value === null || value === undefined) {
                      formattedValue = '-';
                    } else if (typeof value === 'boolean') {
                      formattedValue = value ? 'Yes' : 'No';
                    } else if (typeof value === 'number') {
                      formattedValue = value.toLocaleString();
                    } else if (typeof value === 'object') {
                      // For complex objects, show a simplified representation
                      formattedValue = Array.isArray(value)
                        ? `${value.length} item${value.length !== 1 ? 's' : ''}`
                        : `${Object.keys(value).length} properties`;
                    } else {
                      formattedValue = String(value);
                    }

                    return (
                      <View key={key} style={styles.metadataRow}>
                        <Text style={styles.metadataKey}>{formattedKey}:</Text>
                        <Text style={styles.metadataValue}>{formattedValue}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Log ID */}
            <View style={styles.detailSection}>
              <Text style={styles.detailLabel}>Log ID</Text>
              <Text style={styles.detailSubtext}>{selectedLog.id}</Text>
            </View>
          </View>
        </View>
      </Modal>
    );
  };

  // Empty state
  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <MaterialIcons name="history" size={64} color={colors.primary[500]} />
      </View>
      <Text style={styles.emptyTitle}>No Logs Found</Text>
      <Text style={styles.emptySubtitle}>
        {searchQuery
          ? 'Try adjusting your search or filters.'
          : 'Audit logs will appear here as system events occur.'}
      </Text>
      {(categoryFilter !== 'all' || severityFilter !== 'all') && (
        <TouchableOpacity
          style={styles.clearFiltersButton}
          onPress={() => {
            setCategoryFilter('all');
            setSeverityFilter('all');
            setSearchQuery('');
          }}
        >
          <Text style={styles.clearFiltersText}>Clear All Filters</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  if (error && logs.length === 0) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Audit Logs" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchLogs}>
            <Text style={styles.retryButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader
        title="Audit Logs"
        onBack={() => router.back()}
        actions={
          <TouchableOpacity
            onPress={() => setShowFilters(!showFilters)}
            style={[styles.headerAction, showFilters && styles.headerActionActive]}
            accessibilityLabel="Toggle filters"
          >
            <MaterialIcons name="filter-list" size={22} color="#c8ffe0" />
          </TouchableOpacity>
        }
      />

      {/* Stats summary */}
      <StatsSummary />

      {/* Search bar */}
      <SearchBar />

      {/* Expandable filters */}
      {showFilters && (
        <View style={styles.filtersSection}>
          <CategoryFilters />
          <SeverityFilters />
        </View>
      )}

      {/* Logs list */}
      <FlatList
        data={filteredLogs}
        renderItem={renderLogEntry}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.listContent,
          { paddingBottom: insets.bottom + 16 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={fetchLogs}
            tintColor="#10b981"
            colors={['#10b981']}
          />
        }
        ListEmptyComponent={<EmptyState />}
        showsVerticalScrollIndicator={false}
        initialNumToRender={15}
        maxToRenderPerBatch={10}
        windowSize={5}
      />

      {/* Detail modal */}
      <LogDetailModal />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  headerAction: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerActionActive: {
    backgroundColor: 'rgba(0,145,44,0.3)',
  },
  statsContainer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  statItem: {
    alignItems: 'center',
  },
  criticalStat: {
    backgroundColor: 'rgba(220,38,38,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fffef5',
  },
  statLabel: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.6)',
    marginTop: 2,
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
    color: '#fffef5',
  },
  exportButton: {
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
  },
  filtersSection: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8,
  },
  filterChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 16,
  },
  filterChipActive: {
    backgroundColor: '#10b981',
  },
  filterChipText: {
    fontSize: 12,
    color: '#a7f3d0',
    fontWeight: '500',
  },
  filterChipTextActive: {
    color: '#1a3d2e',
    fontWeight: '600',
  },
  severityFiltersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  severityLabel: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
    fontWeight: '500',
  },
  severityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16,
  },
  severityDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  severityChipText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
    fontWeight: '500',
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  logEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    position: 'relative',
    overflow: 'hidden',
  },
  severityIndicator: {
    position: 'absolute',
    left: -16,
    top: -16,
    bottom: -16,
    width: 3,
  },
  logContent: {
    flex: 1,
    gap: 8,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  logHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categoryIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logAction: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fffef5',
    textTransform: 'capitalize',
  },
  logTime: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.5)',
    marginTop: 2,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  severityText: {
    fontSize: 10,
    fontWeight: '600',
  },
  logDescription: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.8)',
    lineHeight: 18,
  },
  actorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actorText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
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
    backgroundColor: 'rgba(16,185,129,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fffef5',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.6)',
    textAlign: 'center',
    lineHeight: 22,
  },
  clearFiltersButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 8,
  },
  clearFiltersText: {
    fontSize: 14,
    color: '#a7f3d0',
    fontWeight: '500',
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
    backgroundColor: '#00912C',
    borderRadius: 10,
    marginTop: 8,
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fffef5',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,145,44,0.2)',
  },
  modalCloseButton: {
    padding: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#fffef5',
  },
  modalContent: {
    flex: 1,
    padding: 20,
  },
  detailHeaderRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  detailCategoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  detailCategoryText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailSeverityBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  detailSeverityText: {
    fontSize: 14,
    fontWeight: '600',
  },
  detailSection: {
    marginBottom: 20,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.5)',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 16,
    color: '#fffef5',
    fontWeight: '500',
  },
  detailDescription: {
    fontSize: 15,
    color: '#fffef5',
    lineHeight: 22,
  },
  detailSubtext: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
  },
  detailActorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  detailActorIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,145,44,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metadataContainer: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
  },
  metadataRow: {
    flexDirection: 'row',
    gap: 8,
  },
  metadataKey: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.6)',
    fontWeight: '500',
  },
  metadataValue: {
    flex: 1,
    fontSize: 13,
    color: '#fffef5',
  },
});
