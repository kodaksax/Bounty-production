"use client"

import type React from "react"

import { ArrowLeft, Check, ChevronRight, Home, Plus, Target } from "lucide-react"
import { useState } from "react"
import { cn } from "lib/utils"

interface WithdrawScreenProps {
  onBack?: () => void
  balance: number
}

interface PaymentMethod {
  id: string
  name: string
  details: string
  icon: React.ReactNode
}

export function WithdrawScreen({ onBack, balance = 40 }: WithdrawScreenProps) {
  const [selectedMethod, setSelectedMethod] = useState<string>("bank-of-america")
  const [withdrawalAmount, setWithdrawalAmount] = useState<number>(0)

  const paymentMethods: PaymentMethod[] = [
    {
      id: "bank-of-america",
      name: "Bank Of America",
      details: "Checking XXXXXX23",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "apple-pay",
      name: "Apple Pay",
      details: "ending in 1138",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "chase-bank",
      name: "Chase Bank",
      details: "Checking XXXXXX45",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "wells-fargo",
      name: "Wells Fargo",
      details: "Savings XXXXXX78",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "venmo",
      name: "Venmo",
      details: "@username",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "paypal",
      name: "PayPal",
      details: "user@example.com",
      icon: <Home className="h-5 w-5" />,
    },
    {
      id: "cash-app",
      name: "Cash App",
      details: "$username",
      icon: <Home className="h-5 w-5" />,
    },
  ]

  return (
    <div className="flex flex-col h-screen bg-emerald-600 text-white overflow-hidden">
      {/* Fixed Header */}
      <div className="sticky top-0 z-10 bg-emerald-600">
        <div className="flex items-center p-4 pt-8">
          <button onClick={onBack} className="mr-3">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center">
            <Target className="h-5 w-5 mr-2" />
            <span className="text-lg font-bold tracking-wider">BOUNTY</span>
          </div>
        </div>

        {/* Title */}
        <div className="px-4 py-2">
          <h1 className="text-2xl font-bold tracking-wider">WITHDRAW</h1>
        </div>

        {/* Balance Info */}
        <div className="px-4 py-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-emerald-200">Your Balance:</span>
            <span className="text-sm text-emerald-200">Withdrawal: ${withdrawalAmount.toFixed(2)}</span>
          </div>
          <div className="relative h-2 bg-emerald-700/50 rounded-full overflow-hidden">
            <div
              className="absolute top-0 left-0 h-full bg-emerald-400"
              style={{ width: `${(withdrawalAmount / balance) * 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between items-center mt-1">
            <span className="text-xs text-emerald-300">$0</span>
            <span className="text-xs text-emerald-300">${balance.toFixed(2)}</span>
          </div>
        </div>

        {/* Withdrawal Amount */}
        <div className="px-4 py-2">
          <label className="block text-sm text-emerald-200 mb-1">Amount:</label>
          <input
            type="number"
            value={withdrawalAmount || ""}
            onChange={(e) =>
              setWithdrawalAmount(Math.min(balance, Math.max(0, Number.parseFloat(e.target.value) || 0)))
            }
            placeholder="Enter amount to withdraw"
            className="w-full bg-emerald-700/30 border border-emerald-500/30 rounded-lg p-2 text-white placeholder:text-emerald-300/50 focus:outline-none focus:ring-1 focus:ring-emerald-400"
          />
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 overflow-y-auto pb-24">
        {/* Payment Methods */}
        <div className="px-4 py-4">
          <h2 className="text-sm font-medium mb-3">Select Withdrawal Method</h2>
          <div className="space-y-3">
            {paymentMethods.map((method) => (
              <div
                key={method.id}
                className={cn(
                  "flex items-center justify-between p-3 rounded-lg",
                  selectedMethod === method.id ? "bg-emerald-700" : "bg-emerald-700/50",
                )}
                onClick={() => setSelectedMethod(method.id)}
              >
                <div className="flex items-center">
                  <div className="h-8 w-8 rounded-full bg-emerald-800 flex items-center justify-center mr-3">
                    {method.icon}
                  </div>
                  <div>
                    <p className="font-medium">{method.name}</p>
                    {method.details && <p className="text-xs text-emerald-300">{method.details}</p>}
                  </div>
                </div>
                <div className="h-5 w-5 rounded-full border border-emerald-400 flex items-center justify-center">
                  {selectedMethod === method.id && <Check className="h-3 w-3 text-emerald-400" />}
                </div>
              </div>
            ))}

            {/* Add New Bank Account */}
            <div className="flex items-center justify-between p-3 bg-emerald-700/50 rounded-lg">
              <div className="flex items-center">
                <div className="h-8 w-8 rounded-full bg-emerald-800 flex items-center justify-center mr-3">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">New Bank Account</p>
                  <p className="text-xs text-emerald-300">Menu description</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Fixed Button at Bottom */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-emerald-600 border-t border-emerald-500/30 shadow-lg z-10">
        <button
          className={cn(
            "w-full py-3 rounded-lg font-medium text-center",
            withdrawalAmount > 0
              ? "bg-emerald-500 hover:bg-emerald-600 transition-colors"
              : "bg-emerald-700/50 text-emerald-200 cursor-not-allowed",
          )}
          disabled={withdrawalAmount <= 0}
        >
          Begin Withdrawal
        </button>
      </div>
    </div>
  )
}
