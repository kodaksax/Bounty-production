// app/(admin)/transactions.tsx - Admin Transactions List (read-only)
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../components/admin/AdminHeader';
import { AdminStatusBadge } from '../../components/admin/AdminStatusBadge';
import { useAdminTransactions } from '../../hooks/useAdminTransactions';
import type { AdminTransaction, AdminTransactionFilters } from '../../lib/types-admin';

export default function AdminTransactionsScreen() {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminTransactionFilters>({ type: 'all' });
  const { transactions, isLoading, error, refetch } = useAdminTransactions(filters);

  const typeOptions: Array<AdminTransactionFilters['type']> = ['all', 'escrow', 'release', 'refund', 'deposit', 'withdrawal'];

  const getTypeIcon = (type: string): string => {
    switch (type) {
      case 'escrow': return 'lock';
      case 'release': return 'lock-open';
      case 'refund': return 'undo';
      case 'deposit': return 'add-circle';
      case 'withdrawal': return 'remove-circle';
      default: return 'swap-horiz';
    }
  };

  const renderTransactionItem = ({ item }: { item: AdminTransaction }) => (
    <View style={styles.transactionCard}>
      <View style={styles.transactionHeader}>
        <View style={styles.transactionIcon}>
          <MaterialIcons name={getTypeIcon(item.type) as any} size={24} color="#00dc50" />
        </View>
        <View style={styles.transactionInfo}>
          <Text style={styles.transactionType}>{item.type.toUpperCase()}</Text>
          {item.description && (
            <Text style={styles.transactionDescription} numberOfLines={1}>
              {item.description}
            </Text>
          )}
        </View>
        <View style={styles.transactionAmount}>
          <Text style={styles.amountText}>${item.amount.toFixed(2)}</Text>
          <AdminStatusBadge status={item.status} type="transaction" />
        </View>
      </View>
      <View style={styles.transactionMeta}>
        {item.bountyId && (
          <View style={styles.metaItem}>
            <MaterialIcons name="work" size={14} color="rgba(255,254,245,0.6)" />
            <Text style={styles.metaText}>Bounty: {item.bountyId}</Text>
          </View>
        )}
        {item.fromUserId && (
          <View style={styles.metaItem}>
            <MaterialIcons name="person" size={14} color="rgba(255,254,245,0.6)" />
            <Text style={styles.metaText}>From: {item.fromUserId}</Text>
          </View>
        )}
        {item.toUserId && (
          <View style={styles.metaItem}>
            <MaterialIcons name="person-outline" size={14} color="rgba(255,254,245,0.6)" />
            <Text style={styles.metaText}>To: {item.toUserId}</Text>
          </View>
        )}
      </View>
      <Text style={styles.dateText}>{formatDate(item.createdAt)}</Text>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <MaterialIcons name="receipt-long" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.emptyTitle}>No transactions found</Text>
      <Text style={styles.emptyText}>
        {filters.type !== 'all' ? `No ${filters.type} transactions` : 'No transactions match this filter'}
      </Text>
      <TouchableOpacity style={styles.refreshButton} onPress={refetch}>
        <Text style={styles.refreshButtonText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );

  const renderErrorState = () => (
    <View style={styles.errorContainer}>
      <MaterialIcons name="error-outline" size={64} color="rgba(255,254,245,0.3)" />
      <Text style={styles.errorTitle}>Failed to load transactions</Text>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={refetch}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <AdminHeader title="Transactions" onBack={() => router.back()} />

      {/* Filters */}
      <View style={styles.filtersContainer}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={typeOptions}
          keyExtractor={(item) => item || 'all'}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.filterChip, filters.type === item && styles.filterChipActive]}
              onPress={() => setFilters({ ...filters, type: item })}
            >
              <Text style={[styles.filterText, filters.type === item && styles.filterTextActive]}>
                {item === 'all' ? 'All' : item}
              </Text>
            </TouchableOpacity>
          )}
          contentContainerStyle={styles.filtersContent}
        />
      </View>

      {/* List */}
      {error && !transactions.length ? (
        renderErrorState()
      ) : (
        <FlatList
          data={transactions}
          renderItem={renderTransactionItem}
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
  return date.toLocaleString('en-US', { 
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#008e2a',
  },
  filtersContainer: {
    backgroundColor: '#008e2a',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,142,42,0.2)',
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
    backgroundColor: '#008e2a',
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,254,245,0.8)',
    textTransform: 'capitalize',
  },
  filterTextActive: {
    color: '#ffffff',
  },
  listContent: {
    padding: 16,
  },
  transactionCard: {
    backgroundColor: '#007523',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,142,42,0.2)',
  },
  transactionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,142,42,0.15)',
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionInfo: {
    flex: 1,
  },
  transactionType: {
    fontSize: 14,
    fontWeight: '700',
    color: '#00dc50',
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  transactionDescription: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.7)',
  },
  transactionAmount: {
    alignItems: 'flex-end',
    gap: 6,
  },
  amountText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#ffffff',
  },
  transactionMeta: {
    gap: 6,
    marginBottom: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  dateText: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.5)',
    textAlign: 'right',
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
  refreshButton: {
    backgroundColor: '#008e2a',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  refreshButtonText: {
    color: '#ffffff',
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
    color: '#ffffff',
    marginTop: 16,
  },
  errorText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
    marginTop: 8,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#008e2a',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 24,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
});
