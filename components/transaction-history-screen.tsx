"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import { ArrowLeft, ArrowDown, ArrowUp, Target, CreditCard, CheckCircle } from "lucide-react"
import { cn } from "lib/utils"
import { format } from "date-fns"
import { TransactionDetailModal } from "./transaction-detail-modal"
import { transactionService } from "lib/services/transaction-service"
import { CURRENT_USER_ID } from "lib/utils/data-utils"

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
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [activeFilter, setActiveFilter] = useState<"all" | "deposits" | "withdrawals" | "bounties">("all")
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const loadingRef = useRef<HTMLDivElement>(null)

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
    const fetchTransactions = async () => {
      try {
        setIsLoading(true)
        setError(null)

        // Map our filter to the transaction types
        let type: string | undefined
        switch (activeFilter) {
          case "deposits":
            type = "deposit"
            break
          case "withdrawals":
            type = "withdrawal"
            break
          case "bounties":
            // For bounties, we want multiple types
            type = "bounty"
            break
          default:
            type = undefined
        }

        const {
          transactions: newTransactions,
          count,
          error,
        } = await transactionService.getTransactions(CURRENT_USER_ID, {
          page: currentPage,
          limit: 10,
          type,
        })

        if (error) {
          throw error
        }

        // If it's the first page, replace transactions, otherwise append
        setTransactions((prev) => (currentPage === 1 ? newTransactions : [...prev, ...newTransactions]))
        setHasMore(currentPage * 10 < count)
      } catch (err) {
        console.error("Error fetching transactions:", err)
        setError("Failed to load transactions. Please try again.")
      } finally {
        setIsLoading(false)
      }
    }

    fetchTransactions()
  }, [currentPage, activeFilter])

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
        return <ArrowDown className="h-5 w-5 text-emerald-400" />
      case "withdrawal":
        return <ArrowUp className="h-5 w-5 text-red-400" />
      case "bounty_posted":
        return <Target className="h-5 w-5 text-yellow-400" />
      case "bounty_completed":
        return <CheckCircle className="h-5 w-5 text-blue-400" />
      case "bounty_received":
        return <CreditCard className="h-5 w-5 text-purple-400" />
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
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-safe">
        <div className="flex items-center">
          <button onClick={onBack} className="mr-3 p-2 touch-target-min">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
      </div>

      {/* Title */}
      <div className="px-4 py-2">
        <h1 className="text-xl font-bold">Transaction History</h1>
      </div>

      {/* Filters */}
      <div className="px-4 py-2 overflow-x-auto ios-scroll no-scrollbar">
        <div className="flex space-x-3">
          <button
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "all"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onClick={() => handleFilterChange("all")}
          >
            All Transactions
          </button>
          <button
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "deposits"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onClick={() => handleFilterChange("deposits")}
          >
            Deposits
          </button>
          <button
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "withdrawals"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onClick={() => handleFilterChange("withdrawals")}
          >
            Withdrawals
          </button>
          <button
            className={cn(
              "px-4 py-2 rounded-full text-sm whitespace-nowrap touch-target-min",
              activeFilter === "bounties"
                ? "bg-emerald-700 text-white"
                : "bg-emerald-700/50 text-emerald-200 hover:bg-emerald-700/70",
            )}
            onClick={() => handleFilterChange("bounties")}
          >
            Bounties
          </button>
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mb-4 p-3 bg-red-500/70 rounded-lg text-white text-sm">
          {error}
          <button className="float-right text-white p-2 touch-target-min" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {/* Transaction list */}
      <div className="flex-1 px-4 pb-safe overflow-y-auto ios-scroll">
        {isLoading && currentPage === 1 ? (
          <div className="flex justify-center items-center py-10">
            <div className="h-8 w-8 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
          </div>
        ) : transactions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="h-16 w-16 rounded-full bg-emerald-700/50 flex items-center justify-center mb-4">
              <CreditCard className="h-8 w-8 text-emerald-300" />
            </div>
            <p className="text-emerald-200 mb-2">No transactions found</p>
            <p className="text-sm text-emerald-300">
              {activeFilter === "all"
                ? "Your transaction history will appear here"
                : `No ${activeFilter.slice(0, -1)} transactions found`}
            </p>
          </div>
        ) : (
          <>
            {groupedTransactions.map((group) => (
              <div key={group.date.toISOString()} className="mb-6">
                <div className="sticky top-0 bg-emerald-600 py-2 z-10">
                  <h2 className="text-sm font-medium text-emerald-300">{format(group.date, "EEEE, MMMM d, yyyy")}</h2>
                </div>

                <div className="space-y-3">
                  {group.transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="bg-emerald-700/50 rounded-lg p-3 touch-target-min active:bg-emerald-700/70 transition-colors"
                      onClick={() => setSelectedTransaction(transaction)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-emerald-800/80 flex items-center justify-center">
                          {getTransactionIcon(transaction.type)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex justify-between items-center">
                            <p className="text-sm font-medium text-white truncate">
                              {getTransactionTitle(transaction)}
                            </p>
                            <p
                              className={cn(
                                "text-sm font-bold",
                                transaction.amount > 0 ? "text-emerald-400" : "text-red-300",
                              )}
                            >
                              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
                            </p>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <p className="text-xs text-emerald-300">{format(transaction.date, "h:mm a")}</p>
                            {transaction.details.status && (
                              <p
                                className={cn(
                                  "text-xs",
                                  transaction.details.status === "Completed" ? "text-emerald-300" : "text-yellow-300",
                                )}
                              >
                                {transaction.details.status}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Loading indicator for infinite scroll */}
            {hasMore && (
              <div ref={loadingRef} className="py-4 flex justify-center">
                {isLoading && (
                  <div className="h-6 w-6 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                )}
              </div>
            )}

            {!hasMore && (
              <div className="py-4 text-center text-sm text-emerald-300">
                {transactions.length > 0 ? "No more transactions" : "No transactions found"}
              </div>
            )}
          </>
        )}
      </div>

      {/* Transaction Detail Modal */}
      {selectedTransaction && (
        <TransactionDetailModal transaction={selectedTransaction} onClose={() => setSelectedTransaction(null)} />
      )}
    </div>
  )
}
