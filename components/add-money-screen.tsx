"use client"

import { Target, X } from "lucide-react"
import { useState } from "react"
import { View, Text, TouchableOpacity, ScrollView } from "react-native"
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
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white overflow-y-auto">
      {/* Header - Fixed at top */}
      <View className="sticky top-0 z-10 bg-emerald-600 flex justify-between items-center p-4 pt-8">
        <TouchableOpacity onPress={onBack} className="p-1">
          <X className="h-6 w-6" />
        </TouchableOpacity>
        <View className="flex items-center">
          <Target className="h-5 w-5 mr-2" />
          <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
        </View>
        <View className="w-6"></View> {/* Empty div for spacing */}
      </View>

      {/* Title */}
      <View className="px-4 py-2">
        <Text className="text-xl font-medium">Add Cash</Text>
      </View>

      {/* Amount Display */}
      <View className="flex justify-center items-center py-6">
        <View className="text-5xl font-bold">${amount}</View>
      </View>

      {/* Keypad - Scrollable content */}
      <View className="flex-1 px-4 pb-40">
        <View className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <button
              key={num}
              className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
              onPress={() => handleNumberPress(num)}
            >
              {num}
            </TouchableOpacity>
          ))}
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={handleDecimalPress}
          >
            .
          </TouchableOpacity>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={() => handleNumberPress(0)}
          >
            0
          </TouchableOpacity>
          <button
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={handleDeletePress}
          >
            &lt;
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button - Fixed at bottom with safe area padding, moved up by 50px */}
      <View className="fixed bottom-0 left-0 right-0 bg-emerald-600 pb-safe" style={{ bottom: "50px" }}>
        <View className="p-4 pb-8">
          <button
            className={cn(
              "w-full py-4 rounded-lg font-medium text-center",
              Number.parseFloat(amount) > 0
                ? "bg-gray-700 hover:bg-gray-600 transition-colors"
                : "bg-gray-700/50 text-gray-300 cursor-not-allowed",
            )}
            disabled={Number.parseFloat(amount) <= 0}
            onPress={handleAddMoney}
          >
            Add
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
