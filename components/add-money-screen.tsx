"use client"

import { Target, X } from "lucide-react"
import { useState } from "react"
import { cn } from "lib/utils"

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")

  const handleNumberPress = (num: number) => {
    if (amount === "0") {
      setAmount(num.toString())
    } else {
      // Limit to 2 decimal places and reasonable length
      if (amount.includes(".")) {
        const parts = amount.split(".")
        if (parts[1].length < 2) {
          setAmount(amount + num.toString())
        }
      } else if (amount.length < 8) {
        setAmount(amount + num.toString())
      }
    }
  }

  const handleDecimalPress = () => {
    if (!amount.includes(".")) {
      setAmount(amount + ".")
    }
  }

  const handleDeletePress = () => {
    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount("0")
    }
  }

  const handleAddMoney = () => {
    const numAmount = Number.parseFloat(amount)
    if (onAddMoney && !isNaN(numAmount)) {
      onAddMoney(numAmount)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white overflow-y-auto">
      {/* Header - Fixed at top */}
      <div className="sticky top-0 z-10 bg-emerald-600 flex justify-between items-center p-4 pt-8">
        <button onClick={onBack} className="p-1">
          <X className="h-6 w-6" />
        </button>
        <div className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
        <div className="w-6"></div> {/* Empty div for spacing */}
      </div>

      {/* Title */}
      <div className="px-4 py-2">
        <h1 className="text-xl font-medium">Add Cash</h1>
      </div>

      {/* Amount Display */}
      <div className="flex justify-center items-center py-6">
        <div className="text-5xl font-bold">${amount}</div>
      </div>

      {/* Keypad - Scrollable content */}
      <div className="flex-1 px-4 pb-40">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
              onClick={() => handleNumberPress(num)}
            >
              {num}
            </button>
          ))}
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onClick={handleDecimalPress}
          >
            .
          </button>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onClick={() => handleNumberPress(0)}
          >
            0
          </button>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onClick={handleDeletePress}
          >
            &lt;
          </button>
        </div>
      </div>

      {/* Add Button - Fixed at bottom with safe area padding, moved up by 50px */}
      <div className="fixed bottom-0 left-0 right-0 bg-emerald-600 pb-safe" style={{ bottom: "50px" }}>
        <div className="p-4 pb-8">
          <button
            className={cn(
              "w-full py-4 rounded-lg font-medium text-center",
              Number.parseFloat(amount) > 0
                ? "bg-gray-700 hover:bg-gray-600 transition-colors"
                : "bg-gray-700/50 text-gray-300 cursor-not-allowed",
            )}
            disabled={Number.parseFloat(amount) <= 0}
            onClick={handleAddMoney}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  )
}
