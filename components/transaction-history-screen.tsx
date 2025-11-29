"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
import { useWallet } from "lib/wallet-context"
import { useCallback, useEffect, useMemo, useState } from "react"
import { FlatList, RefreshControl, Text, TouchableOpacity, View, ScrollView, StyleSheet } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { TransactionDetailModal } from "./transaction-detail-modal"
import { TransactionsListSkeleton } from "./ui/skeleton-loaders"

export interface Transaction {
  id: string
  type: "deposit" | "withdrawal" | "bounty_posted" | "bounty_completed" | "bounty_received" | "escrow" | "release" | "refund"
  amount: number
  date: Date
  details: {
    title?: string
    method?: string
    status?: string
    counterparty?: string
    bounty_id?: number
  }
  // Optional runtime-only fields for UI badges
  escrowStatus?: string
  disputeStatus?: "none" | "pending" | "resolved"
}

export function TransactionHistoryScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets()
  // Local view of transactions (sourced from wallet context for now)
  const { transactions: walletTransactions, refresh, isLoading: walletLoading } = useWallet()
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState<"all" | "deposits" | "withdrawals" | "bounties">("all")
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Filter and sort transactions
  const filteredTransactions = useMemo(() => {
    let filtered = walletTransactions as Transaction[]
    if (activeFilter === 'deposits') filtered = filtered.filter(t => t.type === 'deposit')
    else if (activeFilter === 'withdrawals') filtered = filtered.filter(t => t.type === 'withdrawal')
    else if (activeFilter === 'bounties') filtered = filtered.filter(t => t.type.startsWith('bounty_') || t.type === 'escrow' || t.type === 'release' || t.type === 'refund')

    // Sort newest first
    return [...filtered].sort((a, b) => b.date.getTime() - a.date.getTime())
  }, [walletTransactions, activeFilter])

  // Set loading state based on wallet loading
  useEffect(() => {
    setIsLoading(walletLoading)
  }, [walletLoading])

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)
    try {
      await refresh()
    } catch (e) {
      setError('Failed to refresh transactions.')
    } finally {
      setIsRefreshing(false)
    }
  }, [refresh])

  // Group transactions by date for section list rendering
  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {}

    filteredTransactions.forEach((transaction) => {
      const dateKey = format(transaction.date, "yyyy-MM-dd")
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(transaction)
    })

    // Sort dates in descending order (newest first)
    return Object.entries(groups)
      .sort(([dateA], [dateB]) => new Date(dateB).getTime() - new Date(dateA).getTime())
      .map(([date, txs]) => ({
        date: new Date(date),
        transactions: txs,
      }))
  }, [filteredTransactions])

  // Handle filter change
  const handleFilterChange = (filter: "all" | "deposits" | "withdrawals" | "bounties") => {
    if (filter === activeFilter) return
    setActiveFilter(filter)
  }

  // Get transaction icon based on type
  const getTransactionIcon = (type: Transaction["type"]) => {
    switch (type) {
      case "deposit":
        return <MaterialIcons name="keyboard-arrow-down" size={24} color="#000000" />
      case "withdrawal":
        return <MaterialIcons name="keyboard-arrow-up" size={24} color="#000000" />
      case "bounty_posted":
        return <MaterialIcons name="gps-fixed" size={24} color="#000000" />
      case "bounty_completed":
        return <MaterialIcons name="check-circle" size={20} color="#60a5fa" />
      case "bounty_received":
        return <MaterialIcons name="credit-card" size={20} color="#a78bfa" />
      case "escrow":
        return <MaterialIcons name="lock" size={20} color="#f59e0b" />
      case "release":
        return <MaterialIcons name="lock-open" size={20} color="#10b981" />
      case "refund":
        return <MaterialIcons name="refresh" size={20} color="#6366f1" />
    }
  }

  // Get transaction title based on type
  const getTransactionTitle = (transaction: Transaction) => {
    switch (transaction.type) {
      case "deposit":
        return `Deposit via ${transaction.details.method || "Card"}`
      case "withdrawal":
        return `Withdrawal to ${transaction.details.method || "Bank Account"}`
      case "bounty_posted":
        return `Posted Bounty: ${transaction.details.title || "Bounty"}`
      case "bounty_completed":
        return `Completed Bounty: ${transaction.details.title || "Bounty"}`
      case "bounty_received":
        return `Received Payment: ${transaction.details.title || "Bounty"}`
      case "escrow":
        return `Escrow Hold: ${transaction.details.title || "Bounty"}`
      case "release":
        return `Escrow Released: ${transaction.details.title || "Bounty"}`
      case "refund":
        return `Refund: ${transaction.details.title || "Bounty"}`
    }
  }

  // Render a single transaction item
  const renderTransactionItem = useCallback(({ item: transaction }: { item: Transaction }) => (
    <TouchableOpacity
      key={transaction.id}
      style={styles.transactionCard}
      onPress={() => setSelectedTransaction(transaction)}
      activeOpacity={0.7}
    >
      <View style={styles.transactionRow}>
        <View style={styles.iconContainer}>
          {getTransactionIcon(transaction.type)}
        </View>

        <View style={styles.transactionDetails}>
          <View style={styles.transactionHeader}>
            <Text style={styles.transactionTitle} numberOfLines={2}>
              {getTransactionTitle(transaction)}
            </Text>
            <Text
              style={[
                styles.transactionAmount,
                { color: transaction.amount > 0 ? '#6ee7b7' : '#fca5a5' }
              ]}
            >
              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
            </Text>
          </View>
          <View style={styles.transactionMeta}>
            <View style={styles.metaRow}>
              <Text style={styles.timeText}>{format(transaction.date, "h:mm a")}</Text>
              {transaction.escrowStatus && (
                <View style={styles.escrowBadge}>
                  <MaterialIcons name="lock" size={10} color="#fff" />
                  <Text style={styles.badgeText}>{transaction.escrowStatus.toUpperCase()}</Text>
                </View>
              )}
              {transaction.disputeStatus === "pending" && (
                <View style={styles.disputeBadge}>
                  <MaterialIcons name="warning" size={10} color="#fff" />
                  <Text style={styles.badgeText}>DISPUTE</Text>
                </View>
              )}
            </View>
            {transaction.details.status && (
              <Text
                style={[
                  styles.statusText,
                  { color: transaction.details.status === "Completed" ? '#6ee7b7' : '#fde68a' }
                ]}
              >
                {transaction.details.status}
              </Text>
            )}
          </View>
        </View>
      </View>
    </TouchableOpacity>
  ), [])

  // Render date header for a group
  const renderDateHeader = useCallback((date: Date) => (
    <View style={styles.dateHeader}>
      <Text style={styles.dateText}>{format(date, "EEEE, MMMM d, yyyy")}</Text>
    </View>
  ), [])

  // Flatten grouped transactions for FlatList with section headers
  const flatListData = useMemo(() => {
    const data: Array<{ type: 'header'; date: Date } | { type: 'transaction'; transaction: Transaction }> = []
    groupedTransactions.forEach(group => {
      data.push({ type: 'header', date: group.date })
      group.transactions.forEach(tx => {
        data.push({ type: 'transaction', transaction: tx })
      })
    })
    return data
  }, [groupedTransactions])

  // Render FlatList item
  const renderItem = useCallback(({ item }: { item: typeof flatListData[0] }) => {
    if (item.type === 'header') {
      return renderDateHeader(item.date)
    }
    return renderTransactionItem({ item: item.transaction })
  }, [renderDateHeader, renderTransactionItem])

  // Key extractor for FlatList
  const keyExtractor = useCallback((item: typeof flatListData[0], index: number) => {
    if (item.type === 'header') {
      return `header-${item.date.toISOString()}`
    }
    return item.transaction.id
  }, [])

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header - improved spacing for iPhone */}
      <View className="flex flex-row items-center justify-between p-5 pt-safe">
        <View className="flex flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#ffffff" />
          <Text className="text-xl font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
        </View>
        <TouchableOpacity 
          onPress={onBack} 
          style={{ 
            padding: 10, 
            minWidth: 44, 
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center' 
          }}
        >
          <MaterialIcons name="arrow-back" size={24} color="#ffffff" />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View className="px-5 py-3">
        <Text className="text-2xl font-bold text-white">Transaction History</Text>
      </View>

      {/* Filters - horizontal scrollable carousel */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8 }}
        style={{ maxHeight: 70 }}
      >
        <TouchableOpacity
          style={{
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: activeFilter === "all" ? '#047857' : 'rgba(4,120,87,0.4)',
            minHeight: 44, // iOS touch target
            justifyContent: 'center',
            alignItems: 'center'
          }}
          onPress={() => handleFilterChange("all")}
        >
          <Text style={{ 
            color: activeFilter === 'all' ? '#fff' : '#d1fae5',
            fontWeight: activeFilter === 'all' ? '600' : '500',
            fontSize: 15
          }}>All Transactions</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: activeFilter === "deposits" ? '#047857' : 'rgba(4,120,87,0.4)',
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 10
          }}
          onPress={() => handleFilterChange("deposits")}
        >
          <Text style={{ 
            color: activeFilter === 'deposits' ? '#fff' : '#d1fae5',
            fontWeight: activeFilter === 'deposits' ? '600' : '500',
            fontSize: 15
          }}>Deposits</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: activeFilter === "withdrawals" ? '#047857' : 'rgba(4,120,87,0.4)',
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 10
          }}
          onPress={() => handleFilterChange("withdrawals")}
        >
          <Text style={{ 
            color: activeFilter === 'withdrawals' ? '#fff' : '#d1fae5',
            fontWeight: activeFilter === 'withdrawals' ? '600' : '500',
            fontSize: 15
          }}>Withdrawals</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={{
            paddingHorizontal: 18,
            paddingVertical: 10,
            borderRadius: 20,
            backgroundColor: activeFilter === "bounties" ? '#047857' : 'rgba(4,120,87,0.4)',
            minHeight: 44,
            justifyContent: 'center',
            alignItems: 'center',
            marginLeft: 10
          }}
          onPress={() => handleFilterChange("bounties")}
        >
          <Text style={{ 
            color: activeFilter === 'bounties' ? '#fff' : '#d1fae5',
            fontWeight: activeFilter === 'bounties' ? '600' : '500',
            fontSize: 15
          }}>Bounties</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Error message */}
      {error && (
        <View className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg">
          <Text style={{ color: '#fff', fontSize: 14 }}>{error}</Text>
          <TouchableOpacity style={{ position: 'absolute', right: 8, top: 8, padding: 8 }} onPress={() => setError(null)}>
            <Text style={{ color: '#fff', fontSize: 16 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Transaction list - Using FlatList for better scroll performance */}
      <View style={[styles.listContainer, { paddingBottom: insets.bottom }]}>
        {isLoading && filteredTransactions.length === 0 ? (
          <View style={styles.loadingContainer}>
            <TransactionsListSkeleton count={5} />
          </View>
        ) : filteredTransactions.length === 0 ? (
          <View style={styles.emptyContainer}>
            <View style={styles.emptyIcon}>
              <MaterialIcons name="receipt-long" size={32} color="#86efac" />
            </View>
            <Text style={styles.emptyTitle}>No transactions found</Text>
            <Text style={styles.emptySubtitle}>
              {activeFilter === "all"
                ? "Your transaction history will appear here when you make deposits, withdrawals, or complete bounties."
                : `No ${activeFilter.slice(0, -1)} transactions found`}
            </Text>
          </View>
        ) : (
          <FlatList
            data={flatListData}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={styles.flatListContent}
            showsVerticalScrollIndicator={true}
            initialNumToRender={15}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor="#6ee7b7"
                colors={['#6ee7b7']}
              />
            }
            ListFooterComponent={
              <View style={styles.listFooter}>
                <Text style={styles.footerText}>
                  {filteredTransactions.length} transaction{filteredTransactions.length !== 1 ? 's' : ''}
                </Text>
              </View>
            }
          />
        )}
      </View>

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransactionDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  listContainer: {
    flex: 1,
    paddingHorizontal: 16,
  },
  loadingContainer: {
    paddingVertical: 24,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    paddingHorizontal: 20,
  },
  emptyIcon: {
    height: 64,
    width: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(4,120,87,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    color: '#d1fae5',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    color: '#a7f3d0',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  flatListContent: {
    paddingBottom: 20,
  },
  dateHeader: {
    backgroundColor: '#059669',
    paddingVertical: 8,
  },
  dateText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#a7f3d0',
  },
  transactionCard: {
    backgroundColor: 'rgba(4,120,87,0.4)',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    minHeight: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  transactionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    height: 44,
    width: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(5,150,105,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  transactionDetails: {
    flex: 1,
    marginLeft: 14,
  },
  transactionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  transactionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    marginRight: 8,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  transactionMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeText: {
    fontSize: 12,
    color: '#a7f3d0',
  },
  escrowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245,158,11,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  disputeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239,68,68,0.8)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 10,
    color: '#ffffff',
    fontWeight: '700',
    marginLeft: 4,
  },
  statusText: {
    fontSize: 12,
  },
  listFooter: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  footerText: {
    color: '#a7f3d0',
    fontSize: 13,
  },
})
