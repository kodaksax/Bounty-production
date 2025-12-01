// app/(admin)/settings/audit-log.tsx - Admin Audit Log
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';

interface AuditLogEntry {
  id: string;
  action: string;
  user: string;
  target?: string;
  details?: string;
  timestamp: string;
  ip?: string;
  status: 'success' | 'warning' | 'error';
}

// Mock data for demonstration
const mockAuditLog: AuditLogEntry[] = [
  {
    id: '1',
    action: 'user.login',
    user: 'admin@bountyexpo.com',
    timestamp: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    ip: '192.168.1.100',
    status: 'success',
  },
  {
    id: '2',
    action: 'bounty.status_change',
    user: 'admin@bountyexpo.com',
    target: 'Bounty #123',
    details: 'Status changed from open to in_progress',
    timestamp: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    status: 'success',
  },
  {
    id: '3',
    action: 'user.suspend',
    user: 'admin@bountyexpo.com',
    target: 'User @johndoe',
    details: 'Suspended for policy violation',
    timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    status: 'warning',
  },
  {
    id: '4',
    action: 'report.review',
    user: 'admin@bountyexpo.com',
    target: 'Report #456',
    details: 'Report dismissed',
    timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    status: 'success',
  },
  {
    id: '5',
    action: 'settings.update',
    user: 'admin@bountyexpo.com',
    details: 'Security settings updated',
    timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'success',
  },
  {
    id: '6',
    action: 'user.login_failed',
    user: 'unknown@email.com',
    details: 'Invalid credentials',
    timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    ip: '203.0.113.50',
    status: 'error',
  },
  {
    id: '7',
    action: 'transaction.refund',
    user: 'admin@bountyexpo.com',
    target: 'Transaction #789',
    details: 'Refund issued for $50.00',
    timestamp: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    status: 'success',
  },
];

const filterOptions = ['all', 'success', 'warning', 'error'] as const;
type FilterOption = typeof filterOptions[number];

export default function AdminAuditLogScreen() {
  const router = useRouter();
  const [logs, setLogs] = useState<AuditLogEntry[]>(mockAuditLog);
  const [isLoading, setIsLoading] = useState(false);
  const [filter, setFilter] = useState<FilterOption>('all');

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.status === filter);

  const fetchLogs = useCallback(async () => {
    setIsLoading(true);
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 500));
    setLogs(mockAuditLog);
    setIsLoading(false);
  }, []);

  const getActionIcon = (action: string): keyof typeof MaterialIcons.glyphMap => {
    if (action.startsWith('user.login')) return 'login';
    if (action.startsWith('user.')) return 'person';
    if (action.startsWith('bounty.')) return 'work';
    if (action.startsWith('report.')) return 'report';
    if (action.startsWith('transaction.')) return 'payment';
    if (action.startsWith('settings.')) return 'settings';
    return 'history';
  };

  const getStatusColor = (status: AuditLogEntry['status']): string => {
    switch (status) {
      case 'success': return '#4caf50';
      case 'warning': return '#ffc107';
      case 'error': return '#f44336';
      default: return '#9e9e9e';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return date.toLocaleDateString();
  };

  const formatAction = (action: string): string => {
    return action
      .replace(/_/g, ' ')
      .replace(/\./g, ' → ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  const renderLogItem = ({ item }: { item: AuditLogEntry }) => (
    <View style={styles.logCard}>
      <View style={styles.logHeader}>
        <View style={[styles.statusIndicator, { backgroundColor: getStatusColor(item.status) }]} />
        <View style={styles.iconContainer}>
          <MaterialIcons name={getActionIcon(item.action)} size={20} color="#00dc50" />
        </View>
        <View style={styles.logInfo}>
          <Text style={styles.actionText}>{formatAction(item.action)}</Text>
          <Text style={styles.userText}>{item.user}</Text>
        </View>
        <Text style={styles.timestampText}>{formatTimestamp(item.timestamp)}</Text>
      </View>
      
      {(item.target || item.details) && (
        <View style={styles.logDetails}>
          {item.target && (
            <View style={styles.detailRow}>
              <MaterialIcons name="label-outline" size={14} color="rgba(255,254,245,0.5)" />
              <Text style={styles.detailText}>{item.target}</Text>
            </View>
          )}
          {item.details && (
            <View style={styles.detailRow}>
              <MaterialIcons name="info-outline" size={14} color="rgba(255,254,245,0.5)" />
              <Text style={styles.detailText}>{item.details}</Text>
            </View>
          )}
          {item.ip && (
            <View style={styles.detailRow}>
              <MaterialIcons name="computer" size={14} color="rgba(255,254,245,0.5)" />
              <Text style={styles.detailText}>IP: {item.ip}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="history" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.emptyTitle}>No Activity Logged</Text>
      <Text style={styles.emptyText}>
        {filter !== 'all' 
          ? `No ${filter} activities found` 
          : 'No admin actions have been recorded yet'}
      </Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="Audit Log" onBack={() => router.back()} />
      
      {/* Filter Tabs */}
      <View style={styles.filterContainer}>
        {filterOptions.map((option) => (
          <TouchableOpacity
            key={option}
            style={[styles.filterTab, filter === option && styles.filterTabActive]}
            onPress={() => setFilter(option)}
          >
            <Text style={[styles.filterText, filter === option && styles.filterTextActive]}>
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </Text>
            {option !== 'all' && (
              <View style={[styles.filterDot, { backgroundColor: getStatusColor(option) }]} />
            )}
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#00dc50" />
          <Text style={styles.loadingText}>Loading activity...</Text>
        </View>
      ) : (
        <FlatList
          data={filteredLogs}
          renderItem={renderLogItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={renderEmptyState}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={fetchLogs}
              tintColor="#00dc50"
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,142,42,0.2)',
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    gap: 6,
  },
  filterTabActive: {
    backgroundColor: '#008e2a',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.7)',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  filterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  listContent: {
    padding: 16,
  },
  logCard: {
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  statusIndicator: {
    width: 4,
    height: 40,
    borderRadius: 2,
  },
  iconContainer: {
    width: 36,
    height: 36,
    backgroundColor: 'rgba(0,142,42,0.15)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logInfo: {
    flex: 1,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  userText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  timestampText: {
    fontSize: 11,
    color: 'rgba(255,254,245,0.5)',
  },
  logDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 6,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.7)',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
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
    color: '#ffffff',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
    marginTop: 8,
    textAlign: 'center',
  },
});
