"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
// import { transactionService } from "lib/services/transaction-service"
import { cn } from "lib/utils"
import { useWallet } from "lib/wallet-context"
import { useEffect, useMemo, useRef, useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { TransactionDetailModal } from "./transaction-detail-modal"

export interface Transaction {
  id: string
  type: "deposit" | "withdrawal" | "bounty_posted" | "bounty_completed" | "bounty_received"
  amount: number
  date: Date
  details: {
    title?: string
    method?: string
    status?: string
    counterparty?: string
    bounty_id?: number
  }
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
      else if (activeFilter === 'bounties') filtered = filtered.filter(t => t.type.startsWith('bounty_'))

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
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex flex-row items-center justify-between p-4 pt-safe">
        <View className="flex flex-row items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider ml-2 text-white">BOUNTY</Text>
        </View>
        <TouchableOpacity onPress={onBack} className="p-2 touch-target-min ml-4">
          <MaterialIcons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
      </View>

      {/* Title */}
      <View className="px-4 py-2">
        <Text className="text-xl font-bold">Transaction History</Text>
      </View>

      {/* Filters */}
      <View className="px-4 py-2 overflow-x-auto ios-scroll no-scrollbar">
        <View className="flex space-x-3">
          <TouchableOpacity
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "all"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onPress={() => handleFilterChange("all")}
          >
            All Transactions
          </TouchableOpacity>
          <TouchableOpacity
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "deposits"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onPress={() => handleFilterChange("deposits")}
          >
            Deposits
          </TouchableOpacity>
          <TouchableOpacity
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "withdrawals"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onPress={() => handleFilterChange("withdrawals")}
          >
            Withdrawals
          </TouchableOpacity>
          <TouchableOpacity
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "bounties"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onPress={() => handleFilterChange("bounties")}
          >
            Bounties
          </TouchableOpacity>
        </View>
      </View>

      {/* Error message */}
      {error && (
        <View className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg text-white text-sm">
          {error}
          <TouchableOpacity className="float-right text-white p-2 touch-target-min" onPress={() => setError(null)}>
            ✕
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
                      className="bg-emerald-700/50 rounded-lg p-3 touch-target-min active:bg-emerald-700/70 transition-colors"
                      onPress={() => setSelectedTransaction(transaction)}
                    >
                      <View className="flex items-center gap-3">
                        <View className="h-10 w-10 rounded-full bg-emerald-800/80 flex items-center justify-center">
                          {getTransactionIcon(transaction.type)}
                        </View>

                        <View className="flex-1 min-w-0">
                          <View className="flex justify-between items-center">
                            <Text className="text-sm font-medium text-white truncate">
                              {getTransactionTitle(transaction)}
                            </Text>
                            <Text
                              className={cn(
                                "text-sm font-bold",
                                transaction.amount > 0 ? "text-emerald-400" : "text-red-300",
                              )}
                            >
                              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
                            </Text>
                          </View>
                          <View className="flex justify-between items-center mt-1">
                            <View className="flex-row items-center gap-2">
                              <Text className="text-xs text-emerald-300">{format(transaction.date, "h:mm a")}</Text>
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
              <View className="py-4 text-center text-sm text-emerald-300">
                {transactions.length > 0 ? "No more transactions" : "No transactions found"}
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
