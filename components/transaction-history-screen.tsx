"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
// import { transactionService } from "lib/services/transaction-service"
import { cn } from "lib/utils"
import { useWallet } from "lib/wallet-context"
import { useEffect, useMemo, useRef, useState } from "react"
import { Text, TouchableOpacity, View, ScrollView } from "react-native"
import { TransactionDetailModal } from "./transaction-detail-modal"

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
  // Local view of transactions (sourced from wallet context for now)
  const { transactions: walletTransactions } = useWallet()
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [activeFilter, setActiveFilter] = useState<"all" | "deposits" | "withdrawals" | "bounties">("all")
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef<any>(null)

  // Use intersection observer for infinite scrolling
  useEffect(() => {
    if (!loadingRef.current || !hasMore) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoading && hasMore) {
          setCurrentPage((prev) => prev + 1)
        }
      },
      { threshold: 0.5 },
    )

    observer.observe(loadingRef.current)
    return () => observer.disconnect()
  }, [isLoading, hasMore])

  // Fetch transactions when page or filter changes
  useEffect(() => {
    // Simulate pagination on in-memory list
    setIsLoading(true)
    try {
      let filtered = walletTransactions as Transaction[]
      if (activeFilter === 'deposits') filtered = filtered.filter(t => t.type === 'deposit')
      else if (activeFilter === 'withdrawals') filtered = filtered.filter(t => t.type === 'withdrawal')
      else if (activeFilter === 'bounties') filtered = filtered.filter(t => t.type.startsWith('bounty_') || t.type === 'escrow' || t.type === 'release' || t.type === 'refund')

      // Sort newest first
      filtered = [...filtered].sort((a,b) => b.date.getTime() - a.date.getTime())
      const pageSize = 10
      const slice = filtered.slice(0, currentPage * pageSize)
      setTransactions(slice)
      setHasMore(slice.length < filtered.length)
      setError(null)
    } catch (e) {
      setError('Failed to load transactions.')
    } finally {
      setIsLoading(false)
    }
  }, [walletTransactions, activeFilter, currentPage])

  // Group transactions by date
  const groupedTransactions = useMemo(() => {
    const groups: { [key: string]: Transaction[] } = {}

    transactions.forEach((transaction) => {
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
  }, [transactions])

  // Handle filter change
  const handleFilterChange = (filter: "all" | "deposits" | "withdrawals" | "bounties") => {
    if (filter === activeFilter) return
    setActiveFilter(filter)
    setTransactions([])
    setCurrentPage(1)
    setHasMore(true)
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
        return `Deposit via ${transaction.details.method || "Unknown"}`
      case "withdrawal":
        return `Withdrawal to ${transaction.details.method || "Unknown"}`
      case "bounty_posted":
        return `Posted Bounty: ${transaction.details.title || "Unknown"}`
      case "bounty_completed":
        return `Completed Bounty: ${transaction.details.title || "Unknown"}`
      case "bounty_received":
        return `Received Bounty Payment: ${transaction.details.title || "Unknown"}`
      case "escrow":
        return `Escrow Hold: ${transaction.details.title || "Unknown"}`
      case "release":
        return `Escrow Released: ${transaction.details.title || "Unknown"}`
      case "refund":
        return `Refund: ${transaction.details.title || "Unknown"}`
    }
  }

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
        contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 8, gap: 10 }}
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

      {/* Transaction list */}
      <View className="flex-1 px-4 pb-safe overflow-y-auto ios-scroll">
        {isLoading && currentPage === 1 ? (
          <View className="flex justify-center items-center py-10">
            <View className="h-8 w-8 rounded-full border-2 border-white border-t-transparent animate-spin"></View>
          </View>
        ) : transactions.length === 0 ? (
          <View className="flex flex-col items-center justify-center py-10 text-center">
            <View className="h-16 w-16 rounded-full bg-emerald-700/50 flex items-center justify-center mb-4">
              <MaterialIcons name="credit-card" size={32} color="#86efac" />
            </View>
            <Text className="text-emerald-200 mb-2">No transactions found</Text>
            <Text className="text-sm text-emerald-300">
              {activeFilter === "all"
                ? "Your transaction history will appear here"
                : `No ${activeFilter.slice(0, -1)} transactions found`}
            </Text>
          </View>
        ) : (
          <>
            {groupedTransactions.map((group) => (
              <View key={group.date.toISOString()} className="mb-6">
                <View className="sticky top-0 bg-emerald-600 py-2 z-10">
                  <Text className="text-sm font-medium text-emerald-300">{format(group.date, "EEEE, MMMM d, yyyy")}</Text>
                </View>

                <View className="space-y-3">
                  {group.transactions.map((transaction) => (
                    <TouchableOpacity
                      key={transaction.id}
                      style={{
                        backgroundColor: 'rgba(4,120,87,0.4)',
                        borderRadius: 14,
                        padding: 16,
                        marginBottom: 12,
                        minHeight: 80, // Comfortable touch target
                        shadowColor: '#000',
                        shadowOffset: { width: 0, height: 1 },
                        shadowOpacity: 0.1,
                        shadowRadius: 2,
                        elevation: 2
                      }}
                      onPress={() => setSelectedTransaction(transaction)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{
                          height: 44,
                          width: 44,
                          borderRadius: 22,
                          backgroundColor: 'rgba(5,150,105,0.5)',
                          justifyContent: 'center',
                          alignItems: 'center'
                        }}>
                          {getTransactionIcon(transaction.type)}
                        </View>

                        <View style={{ flex: 1, marginLeft: 14 }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                            <Text style={{
                              fontSize: 15,
                              fontWeight: '600',
                              color: '#ffffff',
                              flex: 1,
                              marginRight: 8
                            }} numberOfLines={2}>
                              {getTransactionTitle(transaction)}
                            </Text>
                            <Text
                              style={{
                                fontSize: 16,
                                fontWeight: '700',
                                color: transaction.amount > 0 ? '#6ee7b7' : '#fca5a5',
                                letterSpacing: 0.3
                              }}
                            >
                              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
                            </Text>
                          </View>
                          <View className="flex justify-between items-center mt-1">
                            <View className="flex-row items-center gap-2">
                              <Text className="text-xs text-emerald-300">{format(transaction.date, "h:mm a")}</Text>
                              {(transaction as any).escrowStatus && (
                                <View className="flex-row items-center bg-amber-500/80 px-2 py-0.5 rounded-full">
                                  <MaterialIcons name="lock" size={10} color="#fff" />
                                  <Text className="text-[10px] text-white font-bold ml-1">{(transaction as any).escrowStatus.toUpperCase()}</Text>
                                </View>
                              )}
                              {(transaction as any).disputeStatus === "pending" && (
                                <View className="flex-row items-center bg-red-500/80 px-2 py-0.5 rounded-full">
                                  <MaterialIcons name="warning" size={10} color="#fff" />
                                  <Text className="text-[10px] text-white font-bold ml-1">DISPUTE</Text>
                                </View>
                              )}
                            </View>
                            {transaction.details.status && (
                              <Text
                                className={cn(
                                  "text-xs",
                                  transaction.details.status === "Completed" ? "text-emerald-300" : "text-yellow-300",
                                )}
                              >
                                {transaction.details.status}
                              </Text>
                            )}
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}

            {/* Loading indicator for infinite scroll */}
            {hasMore && (
              <View ref={loadingRef} className="py-4 flex justify-center">
                {isLoading && (
                  <View className="h-6 w-6 rounded-full border-2 border-white border-t-transparent animate-spin"></View>
                )}
              </View>
            )}

            {!hasMore && (
              <View className="py-4 text-center">
                <Text style={{ color: '#bbf7d0' }}>{transactions.length > 0 ? 'No more transactions' : 'No transactions found'}</Text>
              </View>
            )}
          </>
        )}
      </View>

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransactionDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      )}
    </View>
  )
}
