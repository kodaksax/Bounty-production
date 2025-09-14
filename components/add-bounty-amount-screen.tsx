"use client"

import { useState, useEffect } from "react"
import { Target, X } from "lucide-react"
import { cn } from "lib/utils"

interface AddBountyAmountScreenProps {
  onBack: () => void
  onAddAmount: (amount: number, isForHonor: boolean) => void
  initialAmount?: number
}

export function AddBountyAmountScreen({ onBack, onAddAmount, initialAmount = 0 }: AddBountyAmountScreenProps) {
  const [amount, setAmount] = useState<string>(initialAmount.toString())
  const [isForHonor, setIsForHonor] = useState<boolean>(false)
  const [animateAmount, setAnimateAmount] = useState<boolean>(false)

  // Format the amount with commas for thousands
  const formattedAmount = () => {
    if (amount === "0") return "0"

    // Format with commas for thousands
    const parts = amount.split(".")
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")

    return parts.join(".")
  }

  const handleNumberPress = (num: number) => {
    setAnimateAmount(true)

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
    setAnimateAmount(true)
    if (!amount.includes(".")) {
      setAmount(amount + ".")
    }
  }

  const handleDeletePress = () => {
    setAnimateAmount(true)
    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount("0")
    }
  }

  const handleAddBounty = () => {
    const numAmount = Number.parseFloat(amount)
    if (!isNaN(numAmount)) {
      onAddAmount(numAmount, isForHonor)
    }
  }

  // Reset animation state after animation completes
  useEffect(() => {
    if (animateAmount) {
      const timer = setTimeout(() => {
        setAnimateAmount(false)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [animateAmount])

  return (
    <div className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <div className="flex justify-between items-center p-4 pt-8">
        <button onClick={onBack} className="p-1">
          <X className="h-6 w-6 text-white" />
        </button>
        <div className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <span className="text-lg font-bold tracking-wider">BOUNTY</span>
        </div>
        <div className="w-6"></div> {/* Empty div for spacing */}
      </div>

      {/* Title */}
      <div className="px-4 py-2">
        <h1 className="text-xl font-medium">Add Bounty Amount</h1>
      </div>

      {/* Amount Display */}
      <div className="flex justify-center items-center py-6">
        <div
          className={cn(
            "text-5xl font-bold transition-transform duration-300",
            animateAmount ? "scale-110" : "scale-100",
          )}
        >
          ${formattedAmount()}
        </div>
      </div>

      {/* For Honor Toggle */}
      <div className="px-4 py-2 flex items-center justify-between">
        <span className="text-sm font-medium">For Honor</span>
        <button
          onClick={() => setIsForHonor(!isForHonor)}
          className={cn(
            "w-12 h-6 rounded-full relative transition-colors",
            isForHonor ? "bg-emerald-400" : "bg-emerald-800",
          )}
        >
          <span
            className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
              isForHonor ? "translate-x-7" : "translate-x-1",
            )}
          />
        </button>
      </div>

      {isForHonor && (
        <div className="px-4 py-1">
          <p className="text-xs text-emerald-300">
            This bounty will be posted without monetary reward. People will complete it for honor and reputation.
          </p>
        </div>
      )}

      {/* Keypad */}
      <div className="flex-1 px-4 mt-4">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
              onClick={() => handleNumberPress(num)}
            >
              {num}
            </button>
          ))}
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onClick={handleDecimalPress}
          >
            .
          </button>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onClick={() => handleNumberPress(0)}
          >
            0
          </button>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onClick={handleDeletePress}
          >
            &lt;
          </button>
        </div>
      </div>

      {/* Add Button */}
      <div className="p-4 pb-8">
        <button
          className={cn(
            "w-full py-4 rounded-lg font-medium text-center",
            Number.parseFloat(amount) > 0 || isForHonor
              ? "bg-emerald-800 hover:bg-emerald-700 active:bg-emerald-900 transition-colors"
              : "bg-emerald-800/50 text-emerald-300 cursor-not-allowed",
          )}
          disabled={!(Number.parseFloat(amount) > 0 || isForHonor)}
          onClick={handleAddBounty}
        >
          Add
        </button>
      </div>
    </div>
  )
}
