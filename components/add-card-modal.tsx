"use client"

import type React from "react"
import { View, Text, TouchableOpacity, TextInput } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"
import { useState } from "react"
import { cn } from "lib/utils"

interface AddCardModalProps {
  onBack: () => void
  onSave?: (cardData: CardData) => void
}

interface CardData {
  cardNumber: string
  cardholderName: string
  expiryDate: string
  securityCode: string
}

export function AddCardModal({ onBack, onSave }: AddCardModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [cardholderName, setCardholderName] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [securityCode, setSecurityCode] = useState("")

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, "")
    const groups = []

    for (let i = 0; i < digits.length && i < 16; i += 4) {
      groups.push(digits.slice(i, i + 4))
    }

    return groups.join(" ")
  }

  const handleCardNumberChange = (value: string) => {
    const formatted = formatCardNumber(value)
    setCardNumber(formatted)
  }

  const handleExpiryDateChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "")
    if (digitsOnly.length <= 4) {
      const month = digitsOnly.slice(0, 2)
      const year = digitsOnly.slice(2, 4)

      if (digitsOnly.length <= 2) {
        setExpiryDate(digitsOnly)
      } else {
        setExpiryDate(`${month}/${year}`)
      }
    }
  }

  const handleSave = () => {
    if (onSave) {
      onSave({
        cardNumber,
        cardholderName,
        expiryDate,
        securityCode,
      })
    }
  }

  const isFormValid =
    cardNumber.length >= 19 && cardholderName.trim() !== "" && expiryDate.length >= 5 && securityCode.length >= 3

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex items-center justify-between p-4 pt-8">
        <TouchableOpacity onPress={onBack} className="p-1">
          <MaterialIcons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
        <Text className="text-lg font-medium">Add Card</Text>
        <View className="w-5"></View> {/* Empty div for spacing */}
      </View>

      {/* Instructions */}
      <View className="px-4 py-2">
        <Text className="text-sm text-emerald-200">
          Start typing to add your credit card details.
          <br />
          Everything will update according to your data.
        </Text>
      </View>

      {/* Card Preview */}
      <View className="px-4 py-4">
        <View className="bg-emerald-700 rounded-xl p-4">
          <View className="flex justify-between items-center mb-4">
            <View className="flex items-center">
              <View className="flex h-8">
                <View className="h-8 w-8 rounded-full bg-red-500"></View>
                <View className="h-8 w-8 rounded-full bg-yellow-500 -ml-4"></View>
              </View>
            </View>
          </View>

          <View className="text-lg font-medium mb-6 tracking-wider">{cardNumber || "1244 1234 1345 3255"}</View>

          <View className="flex justify-between items-end">
            <View>
              <Text className="text-xs text-emerald-300 mb-1">Name</Text>
              <Text className="font-medium">{cardholderName || "Yessie"}</Text>
            </View>
            <View className="text-right">
              <Text className="text-xs text-emerald-300 mb-1">Expires</Text>
              <Text className="font-medium">{expiryDate || "MM/YY"}</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Form Fields */}
      <View className="px-4 py-2 flex-1">
        <View className="space-y-4">
          <View className="space-y-1">
            <Text className="text-sm text-emerald-200">Card Number</Text>
            <TextInput
              value={cardNumber}
              onChangeText={handleCardNumberChange}
              placeholder="1244 1234 1345 3255"
              maxLength={19}
              keyboardType="numeric"
              className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
            />
          </View>

          <View className="space-y-1">
            <Text className="text-sm text-emerald-200">Cardholder Name</Text>
            <TextInput
              value={cardholderName}
              onChangeText={setCardholderName}
              placeholder="Yessie"
              className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
            />
          </View>

          <View className="grid grid-cols-2 gap-4">
            <View className="space-y-1">
              <Text className="text-sm text-emerald-200">Expiry Date</Text>
              <TextInput
                value={expiryDate}
                onChangeText={handleExpiryDateChange}
                placeholder="MM/YY"
                maxLength={5}
                keyboardType="numeric"
                className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
              />
            </View>

            <View className="space-y-1">
              <Text className="text-sm text-emerald-200">Security Code</Text>
              <TextInput
                value={securityCode}
                onChangeText={(text) => setSecurityCode(text.replace(/\D/g, "").slice(0, 4))}
                placeholder="•••"
                maxLength={4}
                secureTextEntry
                keyboardType="numeric"
                className="w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white"
              />
            </View>
          </View>
        </View>
      </View>

      {/* Save Button */}
      <View className="p-4 pb-8">
        <TouchableOpacity
          onPress={handleSave}
          disabled={!isFormValid}
          style={cn(
            "w-full py-3 rounded-full text-center font-medium",
            isFormValid
              ? "bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              : "bg-gray-700/50 text-gray-300 cursor-not-allowed",
          )}
        >
          <Text className={cn(
            "text-center font-medium",
            isFormValid ? "text-white" : "text-gray-300"
          )}>Save</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
