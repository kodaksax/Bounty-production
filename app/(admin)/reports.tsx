// app/(admin)/reports.tsx - Admin Reports Management
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { AdminCard } from '../../components/admin/AdminCard';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { reportService } from '../../lib/services/report-service';

export default function AdminReportsScreen() {
  const router = useRouter();
  const [reports, setReports] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'reviewed' | 'resolved' | 'dismissed'>(
    'pending'
  );

  const fetchReports = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await reportService.getAllReports({
        status: filter === 'all' ? undefined : filter,
      });

      if (result.success && result.reports) {
        setReports(result.reports);
      } else {
        setError(result.error || 'Failed to load reports');
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
      setError('An error occurred while loading reports');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, [filter]);

  const handleUpdateStatus = async (
    reportId: string,
    status: 'reviewed' | 'resolved' | 'dismissed'
  ) => {
    try {
      const result = await reportService.updateReportStatus(reportId, status);
      if (result.success) {
        Alert.alert('Success', `Report marked as ${status}`);
        fetchReports();
      } else {
        Alert.alert('Error', result.error || 'Failed to update report');
      }
    } catch (err) {
      console.error('Error updating report:', err);
      Alert.alert('Error', 'An error occurred while updating the report');
    }
  };

  const getContentTypeIcon = (type: string) => {
    switch (type) {
      case 'bounty':
        return 'work';
      case 'profile':
        return 'person';
      case 'message':
        return 'message';
      default:
        return 'help';
    }
  };

  const getReasonColor = (reason: string) => {
    switch (reason) {
      case 'spam':
        return '#fbbf24'; // yellow
      case 'harassment':
        return '#ef4444'; // red
      case 'inappropriate':
        return '#f97316'; // orange
      case 'fraud':
        return '#dc2626'; // dark red
      default:
        return '#a7f3d0';
    }
  };

  const filterButtons = [
    { id: 'pending', label: 'Pending', icon: 'pending' },
    { id: 'all', label: 'All', icon: 'list' },
    { id: 'reviewed', label: 'Reviewed', icon: 'visibility' },
    { id: 'resolved', label: 'Resolved', icon: 'check-circle' },
    { id: 'dismissed', label: 'Dismissed', icon: 'cancel' },
  ] as const;

  if (error && reports.length === 0) {
    return (
      <View style={styles.container}>
        <AdminHeader title="Reports" onBack={() => router.back()} />
        <View style={styles.errorContainer}>
          <MaterialIcons name="error-outline" size={48} color="#ef4444" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={fetchReports}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Reports" onBack={() => router.back()} />

      {/* Filter Tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {filterButtons.map((btn) => (
          <TouchableOpacity
            key={btn.id}
            style={[styles.filterButton, filter === btn.id && styles.filterButtonActive]}
            onPress={() => setFilter(btn.id)}
          >
            <MaterialIcons
              name={btn.icon as any}
              size={18}
              color={filter === btn.id ? '#065f46' : '#a7f3d0'}
            />
            <Text
              style={[styles.filterButtonText, filter === btn.id && styles.filterButtonTextActive]}
            >
              {btn.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={fetchReports} tintColor="#10b981" />
        }
      >
        {isLoading && reports.length === 0 ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#10b981" />
            <Text style={styles.loadingText}>Loading reports...</Text>
          </View>
        ) : reports.length === 0 ? (
          <View style={styles.emptyContainer}>
            <MaterialIcons name="check-circle" size={64} color="#10b981" />
            <Text style={styles.emptyText}>
              {filter === 'pending' ? 'No pending reports' : 'No reports found'}
            </Text>
            <Text style={styles.emptySubtext}>
              {filter === 'pending'
                ? 'All caught up! No reports need your attention.'
                : 'Try changing the filter to see other reports.'}
            </Text>
          </View>
        ) : (
          reports.map((report) => (
            <AdminCard key={report.id}>
              <View style={styles.reportCard}>
                {/* Header */}
                <View style={styles.reportHeader}>
                  <View style={styles.reportHeaderLeft}>
                    <MaterialIcons
                      name={getContentTypeIcon(report.content_type) as any}
                      size={20}
                      color="#a7f3d0"
                    />
                    <Text style={styles.reportContentType}>
                      {report.content_type.charAt(0).toUpperCase() + report.content_type.slice(1)}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.reasonBadge,
                      { backgroundColor: getReasonColor(report.reason) + '20' },
                    ]}
                  >
                    <Text style={[styles.reasonText, { color: getReasonColor(report.reason) }]}>
                      {report.reason}
                    </Text>
                  </View>
                </View>

                {/* Content */}
                <View style={styles.reportContent}>
                  <Text style={styles.reportLabel}>Content ID:</Text>
                  <Text style={styles.reportValue}>{report.content_id}</Text>

                  {report.details && (
                    <>
                      <Text style={[styles.reportLabel, { marginTop: 8 }]}>Details:</Text>
                      <Text style={styles.reportValue}>{report.details}</Text>
                    </>
                  )}

                  <Text style={[styles.reportLabel, { marginTop: 8 }]}>Reported:</Text>
                  <Text style={styles.reportValue}>
                    {new Date(report.created_at).toLocaleDateString()} at{' '}
                    {new Date(report.created_at).toLocaleTimeString()}
                  </Text>
                </View>

                {/* Actions */}
                {report.status === 'pending' && (
                  <View style={styles.reportActions}>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.reviewButton]}
                      onPress={() => handleUpdateStatus(report.id, 'reviewed')}
                    >
                      <MaterialIcons name="visibility" size={16} color="#3b82f6" />
                      <Text style={styles.reviewButtonText}>Mark Reviewed</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.resolveButton]}
                      onPress={() => handleUpdateStatus(report.id, 'resolved')}
                    >
                      <MaterialIcons name="check" size={16} color="#10b981" />
                      <Text style={styles.resolveButtonText}>Resolve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.dismissButton]}
                      onPress={() => handleUpdateStatus(report.id, 'dismissed')}
                    >
                      <MaterialIcons name="close" size={16} color="#ef4444" />
                      <Text style={styles.dismissButtonText}>Dismiss</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </AdminCard>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#059669', // emerald-600
  },
  filterContainer: {
    maxHeight: 60,
    backgroundColor: '#047857', // emerald-700
  },
  filterContent: {
    padding: 12,
    gap: 8,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#05966920',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  filterButtonActive: {
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  filterButtonText: {
    fontSize: 14,
    color: '#a7f3d0',
    fontWeight: '500',
  },
  filterButtonTextActive: {
    color: '#065f46',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#a7f3d0',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorText: {
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: '#10b981',
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#065f46',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: 'white',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#a7f3d0',
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 32,
  },
  reportCard: {
    gap: 12,
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reportContentType: {
    fontSize: 16,
    fontWeight: '600',
    color: 'white',
  },
  reasonBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  reasonText: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  reportContent: {
    gap: 4,
  },
  reportLabel: {
    fontSize: 12,
    color: '#a7f3d0',
    fontWeight: '500',
  },
  reportValue: {
    fontSize: 14,
    color: 'white',
  },
  reportActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  reviewButton: {
    backgroundColor: '#3b82f620',
  },
  reviewButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#3b82f6',
  },
  resolveButton: {
    backgroundColor: '#10b98120',
  },
  resolveButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#10b981',
  },
  dismissButton: {
    backgroundColor: '#ef444420',
  },
  dismissButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#ef4444',
  },
});
