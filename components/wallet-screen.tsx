"use client"

import { useState } from "react"
import { CreditCard, Plus, ArrowDown, ArrowLeft } from "lucide-react"
import { Target } from "lucide-react"
import { WithdrawScreen } from "./withdraw-screen"
import { AddMoneyScreen } from "./add-money-screen"
import { PaymentMethodsModal } from "./payment-methods-modal"
import { TransactionHistoryScreen } from "./transaction-history-screen"

interface WalletScreenProps {
  onBack?: () => void
}

export function WalletScreen({ onBack }: WalletScreenProps = {}) {
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [showPaymentMethods, setShowPaymentMethods] = useState(false)
  const [showTransactionHistory, setShowTransactionHistory] = useState(false)
  const [balance, setBalance] = useState(40)

  const handleAddMoney = (amount: number) => {
    setBalance((prev) => prev + amount)
    setShowAddMoney(false)
  }

  if (showWithdraw) {
    return <WithdrawScreen onBack={() => setShowWithdraw(false)} balance={balance} />
  }

  if (showAddMoney) {
    return <AddMoneyScreen onBack={() => setShowAddMoney(false)} onAddMoney={handleAddMoney} />
  }

  if (showTransactionHistory) {
    return <TransactionHistoryScreen onBack={() => setShowTransactionHistory(false)} />
  }

  return (
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header - iPhone optimized with safe area inset */}
      <div className="flex justify-between items-center p-4 pt-safe">
        <div className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
        {onBack && (
          <button onClick={onBack} className="p-2 touch-target-min">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Balance Card */}
      <div className="px-4 mb-6">
        <div className="bg-emerald-700 rounded-xl p-5 shadow-lg">
          <div className="text-center mb-4">
            <p className="text-sm text-emerald-300 uppercase font-medium">BALANCE</p>
            <h1 className="text-4xl font-bold mt-1">${balance.toFixed(2)}</h1>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <button
              className="bg-emerald-800 hover:bg-emerald-900 transition-colors py-3 rounded-lg text-base font-medium flex items-center justify-center touch-target-min"
              onClick={() => setShowAddMoney(true)}
            >
              <Plus className="h-5 w-5 mr-2" />
              Add Money
            </button>
            <button
              className="bg-emerald-800 hover:bg-emerald-900 transition-colors py-3 rounded-lg text-base font-medium flex items-center justify-center touch-target-min"
              onClick={() => setShowWithdraw(true)}
            >
              <ArrowDown className="h-5 w-5 mr-2" />
              Withdraw
            </button>
          </div>
        </div>
      </div>

      {/* Linked Accounts Section */}
      <div className="px-4 mb-4">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-base font-medium">Linked Accounts</h2>
          <button className="text-sm text-emerald-300 p-2 touch-target-min" onClick={() => setShowPaymentMethods(true)}>
            Manage
          </button>
        </div>

        <div className="bg-emerald-700/80 rounded-xl p-4 mb-3 shadow-md">
          <div className="flex items-center">
            <div className="h-12 w-12 bg-emerald-800 rounded-lg flex items-center justify-center mr-3">
              <CreditCard className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="text-base font-medium">VISA **** **** 3456</p>
              <p className="text-sm text-emerald-300">Default Payment Method</p>
            </div>
          </div>
        </div>

        <div className="bg-emerald-700/80 rounded-xl p-4 shadow-md">
          <div className="flex items-center">
            <div className="h-12 w-12 bg-emerald-800 rounded-lg flex items-center justify-center mr-3">
              <CreditCard className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <p className="text-base font-medium">AMEX **** **** 7890</p>
              <p className="text-sm text-emerald-300">Added 02/15/2025</p>
            </div>
          </div>
        </div>
      </div>

      {/* Bounty Postings Section */}
      <div className="px-4 mb-4 flex-1 ios-scroll">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-base font-medium">Bounty Postings</h2>
          <button
            className="text-sm text-emerald-300 p-2 touch-target-min"
            onClick={() => setShowTransactionHistory(true)}
          >
            View All
          </button>
        </div>

        <div className="bg-emerald-700/80 rounded-xl p-4 mb-3 shadow-md">
          <div className="flex justify-between items-center">
            <p className="text-base font-medium">Bounty</p>
            <p className="text-base font-medium">$15.00</p>
          </div>
        </div>

        <div className="bg-emerald-700/80 rounded-xl p-4 shadow-md">
          <div className="flex justify-between items-center">
            <p className="text-base font-medium">Bounty</p>
            <p className="text-base font-medium">$25.00</p>
          </div>
        </div>
      </div>

      {/* Bottom Navigation Indicator - With safe area inset */}
      <div className="flex justify-center pb-safe pt-4">
        <div className="h-1 w-1 rounded-full bg-white mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
        <div className="h-1 w-1 rounded-full bg-white/50 mx-1"></div>
      </div>

      {/* Payment Methods Modal */}
      <PaymentMethodsModal isOpen={showPaymentMethods} onClose={() => setShowPaymentMethods(false)} />
    </div>
  )
}
