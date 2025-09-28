"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { format } from "date-fns"
import { cn } from "lib/utils"
import { useEffect, useRef, useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import type { Transaction } from "../app/tabs/transaction-history-screen"

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

    // In React Native, use TouchableWithoutFeedback for click outside modal.
  }, [])

  // Get transaction icon based on type
  const getTransactionIcon = () => {
    switch (transaction.type) {
      case "deposit":
        return <MaterialIcons name="keyboard-arrow-down" size={24} color="#fffef5" />
      case "withdrawal":
        return <MaterialIcons name="keyboard-arrow-up" size={24} color="#fffef5" />
      case "bounty_posted":
        return <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
      case "bounty_completed":
        return <MaterialIcons name="check-circle" size={24} color="#00912C" />
      case "bounty_received":
        return <MaterialIcons name="credit-card" size={24} color="#00912C" />
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
    <View className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <View
        ref={modalRef as any}
        className={cn(
          "relative w-full max-w-md mx-auto bg-emerald-600 rounded-xl overflow-hidden transition-all duration-300 transform",
          isClosing ? "scale-95 opacity-0" : "scale-100 opacity-100",
        )}
      >
        {/* Header */}
        <View className="flex flex-row items-center justify-between p-4 bg-emerald-700">
          <View className="flex flex-row items-center">
            <MaterialIcons name="gps-fixed" size={24} color="#fffef5" />
            <Text className="text-lg font-bold text-white ml-2">Transaction Details</Text>
          </View>
          <TouchableOpacity onPress={handleClose} className="p-2 touch-target-min">
            <MaterialIcons name="close" size={24} color="#fffef5" />
          </TouchableOpacity>
        </View>

        {/* Transaction Summary */}
        <View className="p-5 border-b border-emerald-700/50">
          <View className="flex items-center mb-4">
            <View className="h-12 w-12 rounded-full bg-emerald-800/80 flex items-center justify-center mr-4">
              {getTransactionIcon()}
            </View>
            <View>
              <Text className="text-lg font-bold text-white">{getTransactionTitle()}</Text>
              <Text className="text-sm text-emerald-200">
                {format(transaction.date, "MMMM d, yyyy")} at {format(transaction.date, "h:mm a")}
              </Text>
            </View>
          </View>

          <View className="bg-emerald-700/50 rounded-lg p-4 mb-4">
            <Text
              className={cn(
                "text-2xl font-bold text-center",
                transaction.amount > 0 ? "text-emerald-400" : "text-red-300",
              )}
            >
              {transaction.amount > 0 ? "+" : ""}${Math.abs(transaction.amount).toFixed(2)}
            </Text>
          </View>

          <Text className="text-sm text-emerald-100">{getTransactionDescription()}</Text>
        </View>

        {/* Transaction Details */}
        <View className="p-5">
          <Text className="text-sm font-medium text-emerald-300 mb-3">Details</Text>

          <View className="space-y-4">
            <View className="flex items-center">
              <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <MaterialIcons name="info" size={16} color="#86efac" />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-emerald-300">Transaction ID</Text>
                <Text className="text-sm text-white">{transaction.id}</Text>
              </View>
            </View>

            <View className="flex items-center">
              <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <MaterialIcons name="calendar-today" size={16} color="#fffef5" />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-emerald-300">Date</Text>
                <Text className="text-sm text-white">{format(transaction.date, "MMMM d, yyyy")}</Text>
              </View>
            </View>

            <View className="flex items-center">
              <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                <MaterialIcons name="schedule" size={16} color="#86efac" />
              </View>
              <View className="flex-1">
                <Text className="text-xs text-emerald-300">Time</Text>
                <Text className="text-sm text-white">{format(transaction.date, "h:mm:ss a")}</Text>
              </View>
            </View>

            {transaction.details.status && (
              <View className="flex items-center">
                <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <MaterialIcons name="check-circle" size={16} color="#86efac" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-emerald-300">Status</Text>
                  <Text className="text-sm text-white">{transaction.details.status}</Text>
                </View>
              </View>
            )}

            {transaction.details.method && (
              <View className="flex items-center">
                <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <MaterialIcons name="credit-card" size={16} color="#86efac" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-emerald-300">Method</Text>
                  <Text className="text-sm text-white">{transaction.details.method}</Text>
                </View>
              </View>
            )}

            {transaction.details.counterparty && (
              <View className="flex items-center">
                <View className="h-8 w-8 rounded-full bg-emerald-800/50 flex items-center justify-center mr-3">
                  <MaterialIcons name="gps-fixed" size={16} color="#fffef5" />
                </View>
                <View className="flex-1">
                  <Text className="text-xs text-emerald-300">
                    {transaction.type === "bounty_completed" ? "Paid to" : "From"}
                  </Text>
                  <Text className="text-sm text-white">{transaction.details.counterparty}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Action Button */}
        <View className="p-5 pt-0">
          <TouchableOpacity onPress={handleClose} className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 transition-colors rounded-lg text-white font-medium">
            <Text className="text-center text-white">Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
