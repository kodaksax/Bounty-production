"use client"

import { useState, useRef, useEffect } from "react"
import { X, ArrowDown, ArrowUp, Target, CheckCircle, CreditCard, Calendar, Clock, Info } from "lucide-react"
import { cn } from "lib/utils"
import { format } from "date-fns"
import type { Transaction } from "./transaction-history-screen"

interface TransactionDetailModalProps {
  transaction: Transaction
  onClose: () => void
}

export function TransactionDetailModal({ transaction, onClose }: TransactionDetailModalProps) {
  const [isClosing, setIsClosing] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  // Handle close animation
  const handleClose = () => {
    setIsClosing(true)
    setTimeout(() => {
      onClose()
    }, 300)
  }

  // Handle click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        handleClose()
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [])

  // Get transaction icon based on type
  const getTransactionIcon = () => {
    switch (transaction.type) {
      case "deposit":
        return <ArrowDown className="h-6 w-6 text-emerald-400" />
      case "withdrawal":
        return <ArrowUp className="h-6 w-6 text-red-400" />
      case "bounty_posted":
        return <Target className="h-6 w-6 text-yellow-400" />
      case "bounty_completed":
        return <CheckCircle className="h-6 w-6 text-blue-400" />
      case "bounty_received":
        return <CreditCard className="h-6 w-6 text-purple-400" />
    }
  }

  // Get transaction title based on type
  const getTransactionTitle = () => {
    switch (transaction.type) {
      case "deposit":
        return `Deposit via ${transaction.details.method}`
      case "withdrawal":
        return `Withdrawal to ${transaction.details.method}`
      case "bounty_posted":
        return `Posted Bounty: ${transaction.details.title}`
      case "bounty_completed":
        return `Completed Bounty: ${transaction.details.title}`
      case "bounty_received":
        return `Received Bounty Payment: ${transaction.details.title}`
    }
  }

  // Get transaction description based on type
  const getTransactionDescription = () => {
    switch (transaction.type) {
      case "deposit":
        return `You added funds to your account using ${transaction.details.method}.`
      case "withdrawal":
        return `You withdrew funds from your account to ${transaction.details.method}.`
      case "bounty_posted":
        return `You posted a bounty titled "${transaction.details.title}" and the funds were reserved from your account.`
      case "bounty_completed":
        return `You completed the bounty "${transaction.details.title}" posted by ${transaction.details.counterparty}.`
      case "bounty_received":
        return `You received payment for the bounty "${transaction.details.title}" from ${transaction.details.counterparty}.`
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div
        ref={modalRef}
        className={cn(
          "relative w-full max-w-md mx-auto bg-emerald-600 rounded-xl overflow-hidden transition-all duration-300 transform",
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-emerald-700">
          <h2 className="text-lg font-bold text-white">Transaction Details</h2>
          <button onClick={handleClose} className="text-white p-2 touch-target-min">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Transaction Summary */}
        <div className="p-5 border-b border-emerald-700/50">
          <div className="flex items-center mb-4">
            <div className="h-12 w-12 rounded-full bg-emerald-800/80 flex items-center justify-center mr-4">
              {getTransactionIcon()}
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">{getTransactionTitle()}</h3>
              <p className="text-sm text-emerald-200">
                {format(transaction.date, "MMMM d, yyyy")} at {format(transaction.date, "h:mm a")}
              </p>
            </div>
          </div>

          <div className="bg-emerald-700/50 rounded-lg p-4 mb-4">
            <p
              className={cn(
                "text-2xl font-bold text-center",
                transaction.amount > 0 ? "text-emerald-400" : "text-red-300",
              )}
            >
              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
            </p>
          </div>

          <p className="text-sm text-emerald-100">{getTransactionDescription()}</p>
        </div>

        {/* Transaction Details */}
        <div className="p-5">
          <h3 className="text-sm font-medium text-emerald-300 mb-3">Details</h3>

          <div className="space-y-4">
            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <Info className="h-4 w-4 text-emerald-300" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-emerald-300">Transaction ID</p>
                <p className="text-sm text-white">{transaction.id}</p>
              </div>
            </div>

            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <Calendar className="h-4 w-4 text-emerald-300" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-emerald-300">Date</p>
                <p className="text-sm text-white">{format(transaction.date, "MMMM d, yyyy")}</p>
              </div>
            </div>

            <div className="flex items-center">
              <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <Clock className="h-4 w-4 text-emerald-300" />
              </div>
              <div className="flex-1">
                <p className="text-xs text-emerald-300">Time</p>
                <p className="text-sm text-white">{format(transaction.date, "h:mm:ss a")}</p>
              </div>
            </div>

            {transaction.details.status && (
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <CheckCircle className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-emerald-300">Status</p>
                  <p className="text-sm text-white">{transaction.details.status}</p>
                </div>
              </div>
            )}

            {transaction.details.method && (
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <CreditCard className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-emerald-300">Method</p>
                  <p className="text-sm text-white">{transaction.details.method}</p>
                </div>
              </div>
            )}

            {transaction.details.counterparty && (
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <Target className="h-4 w-4 text-emerald-300" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-emerald-300">
                    {transaction.type === "bounty_completed" ? "Paid to" : "From"}
                  </p>
                  <p className="text-sm text-white">{transaction.details.counterparty}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Action Button */}
        <div className="p-5 pt-0">
          <button
            onClick={handleClose}
            className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 transition-colors rounded-lg text-white font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
