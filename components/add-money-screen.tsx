"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import { useState } from "react"
import { Text, TouchableOpacity, View } from "react-native"
import { useWallet } from '../lib/wallet-context'

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")
  const { deposit } = useWallet()

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
    if (!isNaN(numAmount) && numAmount > 0) {
      deposit(numAmount)
      onAddMoney?.(numAmount)
      onBack?.()
    }
  }

  return (
    <View className="flex-1 bg-emerald-600">
      {/* Header */}
      <View className="sticky top-0 z-10 bg-emerald-600 px-4 pt-safe pb-2">
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={onBack} className="p-2 touch-target-min">
            <MaterialIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="gps-fixed" size={22} color="#ffffff" />
            <Text className="text-white font-bold tracking-wider">BOUNTY</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <Text className="text-white text-base text-center mt-1">Add Cash</Text>
      </View>

      {/* Amount Display */}
      <View className="items-center justify-center py-6">
        <Text className="text-white" style={{ fontSize: 56, fontWeight: '800' }}>${amount}</Text>
      </View>

      {/* Keypad */}
      <View className="flex-1 px-8 pb-40">
        {[ [1,2,3], [4,5,6], [7,8,9] ].map((row, idx) => (
          <View key={idx} className="flex-row justify-between mb-4">
            {row.map((num) => (
              <TouchableOpacity
                key={num}
                className="rounded-full items-center justify-center"
                style={{ width: 64, height: 64, backgroundColor: 'transparent' }}
                onPress={() => handleNumberPress(num)}
                activeOpacity={0.7}
              >
                <Text className="text-white" style={{ fontSize: 24, fontWeight: '600' }}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View className="flex-row justify-between">
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64 }}
            onPress={handleDecimalPress}
            activeOpacity={0.7}
          >
            <Text className="text-white" style={{ fontSize: 24, fontWeight: '600' }}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64 }}
            onPress={() => handleNumberPress(0)}
            activeOpacity={0.7}
          >
            <Text className="text-white" style={{ fontSize: 24, fontWeight: '600' }}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64 }}
            onPress={handleDeletePress}
            activeOpacity={0.7}
          >
            <MaterialIcons name="backspace" size={26} color="#ffffff" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button - fixed above home indicator */}
      <View className="fixed left-0 right-0 bg-emerald-600 pb-safe" style={{ position: 'absolute', bottom: 16 }}>
        <View className="px-4">
          <TouchableOpacity
            className={cn(
              "w-full py-4 rounded-full",
              Number.parseFloat(amount) > 0 ? "bg-gray-700" : "bg-gray-700/50"
            )}
            disabled={Number.parseFloat(amount) <= 0}
            onPress={handleAddMoney}
            activeOpacity={0.8}
          >
            <Text className={cn(
              "text-center text-base font-medium",
              Number.parseFloat(amount) > 0 ? "text-white" : "text-gray-300"
            )}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
