"use client"

import { useState, useEffect } from "react"
import { View, Text, TouchableOpacity } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"
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
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex justify-between items-center p-4 pt-8">
        <TouchableOpacity onPress={onBack} className="p-1">
          <MaterialIcons name="close" size={24} color="#000000" />
        </TouchableOpacity>
        <View className="flex items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider text-white">BOUNTY</Text>
        </View>
        <View className="w-6" /> {/* Empty view for spacing */}
      </View>

      {/* Title */}
      <View className="px-4 py-2">
        <Text className="text-xl font-medium text-white">Add Bounty Amount</Text>
      </View>

      {/* Amount Display */}
      <View className="flex justify-center items-center py-6">
        <Text
          className={cn(
            "text-5xl font-bold transition-transform duration-300 text-white",
            animateAmount ? "scale-110" : "scale-100",
          )}
        >
          ${formattedAmount()}
        </Text>
      </View>

      {/* For Honor Toggle */}
      <View className="px-4 py-2 flex items-center justify-between">
        <Text className="text-sm font-medium text-white">For Honor</Text>
        <TouchableOpacity
          onPress={() => setIsForHonor(!isForHonor)}
          className={cn(
            "w-12 h-6 rounded-full relative transition-colors",
            isForHonor ? "bg-emerald-400" : "bg-emerald-800",
          )}
        >
          <View
            className={cn(
              "absolute top-1 w-4 h-4 rounded-full bg-white transition-transform",
              isForHonor ? "translate-x-7" : "translate-x-1",
            )}
          />
        </TouchableOpacity>
      </View>

      {isForHonor && (
        <View className="px-4 py-1">
          <Text className="text-xs text-emerald-300">
            This bounty will be posted without monetary reward. People will complete it for honor and reputation.
          </Text>
        </View>
      )}

      {/* Keypad */}
      <View className="flex-1 px-4 mt-4">
        <View className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <TouchableOpacity
              key={num}
              className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
              onPress={() => handleNumberPress(num)}
            >
              <Text className="text-2xl font-medium text-white">{num}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onPress={handleDecimalPress}
          >
            <Text className="text-2xl font-medium text-white">.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onPress={() => handleNumberPress(0)}
          >
            <Text className="text-2xl font-medium text-white">0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 active:bg-emerald-700/70 transition-colors"
            onPress={handleDeletePress}
          >
            <Text className="text-2xl font-medium text-white">&lt;</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button */}
      <View className="p-4 pb-8">
        <TouchableOpacity
          className={cn(
            "w-full py-4 rounded-lg font-medium text-center",
            Number.parseFloat(amount) > 0 || isForHonor
              ? "bg-emerald-800 hover:bg-emerald-700 active:bg-emerald-900 transition-colors"
              : "bg-emerald-800/50 text-emerald-300 cursor-not-allowed",
          )}
          disabled={!(Number.parseFloat(amount) > 0 || isForHonor)}
          onPress={handleAddBounty}
        >
          <Text className="text-white font-medium text-center">Add</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
