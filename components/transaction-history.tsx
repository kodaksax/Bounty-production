/**
 * Transaction History Component with Enhanced Status Display
 * Shows payment history with detailed status information
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
} from 'lucide-react-native';

export interface Transaction {
  id: string;
  type: 'payment' | 'refund' | 'transfer' | 'deposit' | 'withdrawal';
  amount: number;
  currency: string;
  status: 'succeeded' | 'pending' | 'failed' | 'canceled' | 'processing';
  createdAt: Date;
  description: string;
  paymentMethod?: {
    type: string;
    last4?: string;
    brand?: string;
  };
  metadata?: Record<string, string>;
}

interface TransactionHistoryProps {
  userId: string;
  authToken?: string;
  onTransactionPress?: (transaction: Transaction) => void;
  onLoadMore?: () => void;
  limit?: number;
}

export function TransactionHistory({
  userId,
  authToken,
  onTransactionPress,
  onLoadMore,
  limit = 20,
}: TransactionHistoryProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const loadTransactions = useCallback(async (isRefresh: boolean = false) => {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      setError(null);

      // TODO (Post-Launch): Replace with actual API call
      // const response = await fetch(`/api/wallet/transactions?userId=${userId}&limit=${limit}`, {
      //   headers: {
      //     Authorization: `Bearer ${authToken}`,
      //   },
      // });
      // const data = await response.json();

      // Mock data for now
      const mockTransactions: Transaction[] = [
        {
          id: 'txn_001',
          type: 'deposit',
          amount: 100.00,
          currency: 'USD',
          status: 'succeeded',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2), // 2 hours ago
          description: 'Wallet deposit',
          paymentMethod: {
            type: 'card',
            brand: 'Visa',
            last4: '4242',
          },
        },
        {
          id: 'txn_002',
          type: 'payment',
          amount: 50.00,
          currency: 'USD',
          status: 'succeeded',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24), // 1 day ago
          description: 'Bounty payment for "Fix bug in dashboard"',
        },
        {
          id: 'txn_003',
          type: 'withdrawal',
          amount: 25.00,
          currency: 'USD',
          status: 'processing',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2), // 2 days ago
          description: 'Withdrawal to bank account',
          paymentMethod: {
            type: 'bank_account',
            last4: '1234',
          },
        },
        {
          id: 'txn_004',
          type: 'refund',
          amount: 15.00,
          currency: 'USD',
          status: 'succeeded',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3), // 3 days ago
          description: 'Refund for cancelled bounty',
        },
        {
          id: 'txn_005',
          type: 'payment',
          amount: 75.00,
          currency: 'USD',
          status: 'failed',
          createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 4), // 4 days ago
          description: 'Bounty payment attempt',
        },
      ];

      setTransactions(mockTransactions);
      setHasMore(mockTransactions.length >= limit);
    } catch (err: any) {
      console.error('Error loading transactions:', err);
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, authToken, limit]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  const handleRefresh = () => {
    loadTransactions(true);
  };

  const formatCurrency = (amount: number, currency: string = 'USD'): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  const formatDate = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffHours < 1) {
      return 'Just now';
    } else if (diffHours < 24) {
      return `${Math.floor(diffHours)}h ago`;
    } else if (diffDays < 7) {
      return `${Math.floor(diffDays)}d ago`;
    } else {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      }).format(date);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'succeeded':
        return <CheckCircle2 size={20} color="#10b981" />;
      case 'pending':
      case 'processing':
        return <Clock size={20} color="#f59e0b" />;
      case 'failed':
        return <XCircle size={20} color="#ef4444" />;
      case 'canceled':
        return <AlertCircle size={20} color="#6b7280" />;
      default:
        return <Clock size={20} color="#6b7280" />;
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'succeeded':
        return '#10b981';
      case 'pending':
      case 'processing':
        return '#f59e0b';
      case 'failed':
        return '#ef4444';
      case 'canceled':
        return '#6b7280';
      default:
        return '#6b7280';
    }
  };

  const getTransactionIcon = (type: string, status: string) => {
    const color = status === 'succeeded' ? '#047857' : '#6b7280';
    
    if (type === 'deposit' || type === 'refund') {
      return <ArrowDownLeft size={24} color={color} />;
    } else {
      return <ArrowUpRight size={24} color={color} />;
    }
  };

  const getAmountPrefix = (type: string): string => {
    if (type === 'deposit' || type === 'refund') {
      return '+';
    } else {
      return '-';
    }
  };

  const renderTransaction = ({ item }: { item: Transaction }) => (
    <Pressable
      style={styles.transactionItem}
      onPress={() => onTransactionPress?.(item)}
    >
      <View style={styles.transactionIcon}>
        {getTransactionIcon(item.type, item.status)}
      </View>

      <View style={styles.transactionDetails}>
        <Text style={styles.transactionDescription} numberOfLines={2}>
          {item.description}
        </Text>
        <View style={styles.transactionMeta}>
          {getStatusIcon(item.status)}
          <Text style={[styles.transactionStatus, { color: getStatusColor(item.status) }]}>
            {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
          </Text>
          <Text style={styles.transactionDate}> • {formatDate(item.createdAt)}</Text>
        </View>
        {item.paymentMethod && (
          <Text style={styles.paymentMethod}>
            {item.paymentMethod.brand || item.paymentMethod.type} 
            {item.paymentMethod.last4 && ` •••• ${item.paymentMethod.last4}`}
          </Text>
        )}
      </View>

      <View style={styles.transactionAmount}>
        <Text
          style={[
            styles.amount,
            {
              color:
                item.type === 'deposit' || item.type === 'refund'
                  ? '#10b981'
                  : '#111827',
            },
          ]}
        >
          {getAmountPrefix(item.type)}
          {formatCurrency(item.amount, item.currency)}
        </Text>
        <ChevronRight size={20} color="#9ca3af" />
      </View>
    </Pressable>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyState}>
      <Text style={styles.emptyStateTitle}>No transactions yet</Text>
      <Text style={styles.emptyStateText}>
        Your payment history will appear here
      </Text>
    </View>
  );

  const renderFooter = () => {
    if (!hasMore) return null;

    return (
      <Pressable style={styles.loadMore} onPress={onLoadMore}>
        <Text style={styles.loadMoreText}>Load More</Text>
      </Pressable>
    );
  };

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#047857" />
        <Text style={styles.loadingText}>Loading transactions...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <XCircle size={48} color="#ef4444" />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={() => loadTransactions()}>
          <Text style={styles.retryButtonText}>Try Again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={transactions}
        renderItem={renderTransaction}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={renderEmptyState}
        ListFooterComponent={renderFooter}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#047857"
            colors={['#047857']}
          />
        }
        contentContainerStyle={
          transactions.length === 0 ? styles.emptyContainer : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f0fdf4',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  transactionDetails: {
    flex: 1,
    marginRight: 12,
  },
  transactionDescription: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 4,
  },
  transactionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  transactionStatus: {
    fontSize: 13,
    fontWeight: '500',
    marginLeft: 4,
  },
  transactionDate: {
    fontSize: 13,
    color: '#6b7280',
  },
  paymentMethod: {
    fontSize: 12,
    color: '#9ca3af',
  },
  transactionAmount: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  amount: {
    fontSize: 16,
    fontWeight: '700',
    marginRight: 4,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6b7280',
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#ef4444',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 24,
    backgroundColor: '#047857',
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
  },
  emptyContainer: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  emptyStateText: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  loadMore: {
    padding: 16,
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#047857',
  },
});
