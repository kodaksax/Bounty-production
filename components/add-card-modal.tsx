"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import type React from "react"
import { useState } from "react"
import { Text, TextInput, TouchableOpacity, View, Alert, ActivityIndicator } from "react-native"
import { useStripe } from "../lib/stripe-context"
import { stripeService } from "../lib/services/stripe-service"

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
  const [isLoading, setIsLoading] = useState(false)
  const [cardErrors, setCardErrors] = useState<{[key: string]: string}>({})
  
  const { createPaymentMethod, error: stripeError } = useStripe()

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
    
    // Clear error when user starts typing
    if (cardErrors.cardNumber) {
      setCardErrors(prev => ({ ...prev, cardNumber: '' }))
    }
    
    // Basic validation
    const cleanNumber = value.replace(/\s/g, '')
    if (cleanNumber.length > 0 && !stripeService.validateCardNumber(cleanNumber)) {
      setCardErrors(prev => ({ ...prev, cardNumber: 'Invalid card number' }))
    }
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
      
      // Clear error when user starts typing
      if (cardErrors.expiryDate) {
        setCardErrors(prev => ({ ...prev, expiryDate: '' }))
      }
      
      // Validate expiry date
      if (digitsOnly.length === 4) {
        const monthNum = parseInt(month)
        const yearNum = parseInt('20' + year)
        const currentYear = new Date().getFullYear()
        const currentMonth = new Date().getMonth() + 1
        
        if (monthNum < 1 || monthNum > 12) {
          setCardErrors(prev => ({ ...prev, expiryDate: 'Invalid month' }))
        } else if (yearNum < currentYear || (yearNum === currentYear && monthNum < currentMonth)) {
          setCardErrors(prev => ({ ...prev, expiryDate: 'Card has expired' }))
        }
      }
    }
  }

  const handleSave = async () => {
    setIsLoading(true)
    setCardErrors({})
    
    try {
      // Validate all fields
      const errors: {[key: string]: string} = {}
      
      if (!cardNumber || cardNumber.length < 19) {
        errors.cardNumber = 'Please enter a valid card number'
      }
      
      if (!cardholderName.trim()) {
        errors.cardholderName = 'Please enter the cardholder name'
      }
      
      if (!expiryDate || expiryDate.length < 5) {
        errors.expiryDate = 'Please enter a valid expiry date'
      }
      
      if (!securityCode || securityCode.length < 3) {
        errors.securityCode = 'Please enter a valid security code'
      }
      
      if (Object.keys(errors).length > 0) {
        setCardErrors(errors)
        return
      }

      // Create payment method through Stripe
      const paymentMethod = await createPaymentMethod({
        cardNumber,
        cardholderName,
        expiryDate,
        securityCode,
      })

      // Call onSave callback
      if (onSave) {
        onSave({
          cardNumber,
          cardholderName,
          expiryDate,
          securityCode,
        })
      }
      
      // Show success and close modal
      Alert.alert('Success', 'Payment method added successfully!', [
        { text: 'OK', onPress: onBack }
      ])
      
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add payment method')
    } finally {
      setIsLoading(false)
    }
  }

  const isFormValid = 
    cardNumber.length >= 19 && 
    cardholderName.trim() !== "" && 
    expiryDate.length >= 5 && 
    securityCode.length >= 3 &&
    Object.keys(cardErrors).length === 0

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
        <Text className="text-sm text-emerald-200">{`Start typing to add your credit card details.\nEverything will update according to your data.`}</Text>
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
              className={cn(
                "w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white",
                cardErrors.cardNumber && "border border-red-400"
              )}
            />
            {cardErrors.cardNumber && (
              <Text className="text-xs text-red-300">{cardErrors.cardNumber}</Text>
            )}
          </View>

          <View className="space-y-1">
            <Text className="text-sm text-emerald-200">Cardholder Name</Text>
            <TextInput
              value={cardholderName}
              onChangeText={(text) => {
                setCardholderName(text)
                if (cardErrors.cardholderName) {
                  setCardErrors(prev => ({ ...prev, cardholderName: '' }))
                }
              }}
              placeholder="Yessie"
              className={cn(
                "w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white",
                cardErrors.cardholderName && "border border-red-400"
              )}
            />
            {cardErrors.cardholderName && (
              <Text className="text-xs text-red-300">{cardErrors.cardholderName}</Text>
            )}
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
                className={cn(
                  "w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white",
                  cardErrors.expiryDate && "border border-red-400"
                )}
              />
              {cardErrors.expiryDate && (
                <Text className="text-xs text-red-300">{cardErrors.expiryDate}</Text>
              )}
            </View>

            <View className="space-y-1">
              <Text className="text-sm text-emerald-200">Security Code</Text>
              <TextInput
                value={securityCode}
                onChangeText={(text) => {
                  const cleaned = text.replace(/\D/g, "").slice(0, 4)
                  setSecurityCode(cleaned)
                  if (cardErrors.securityCode) {
                    setCardErrors(prev => ({ ...prev, securityCode: '' }))
                  }
                }}
                placeholder="•••"
                maxLength={4}
                secureTextEntry
                keyboardType="numeric"
                className={cn(
                  "w-full bg-emerald-700/50 border-none rounded-lg p-3 text-white placeholder:text-emerald-400/50 focus:ring-1 focus:ring-white",
                  cardErrors.securityCode && "border border-red-400"
                )}
              />
              {cardErrors.securityCode && (
                <Text className="text-xs text-red-300">{cardErrors.securityCode}</Text>
              )}
            </View>
          </View>
        </View>
      </View>

      {/* Save Button */}
      <View className="p-4 pb-8">
        <TouchableOpacity
          onPress={handleSave}
          disabled={!isFormValid || isLoading}
          className={cn(
            "w-full py-3 rounded-full text-center font-medium flex-row items-center justify-center",
            isFormValid && !isLoading
              ? "bg-gray-700 hover:bg-gray-600 text-white transition-colors"
              : "bg-gray-700/50 text-gray-300 cursor-not-allowed"
          )}
        >
          {isLoading ? (
            <>
              <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
              <Text className="text-center font-medium text-white">Adding Card...</Text>
            </>
          ) : (
            <Text className={cn(
              "text-center font-medium",
              isFormValid ? "text-white" : "text-gray-300"
            )}>Save Card</Text>
          )}
        </TouchableOpacity>
        
        {/* Error message from Stripe */}
        {stripeError && (
          <View className="mt-2 p-2 bg-red-100 rounded-md">
            <Text className="text-red-800 text-sm text-center">{stripeError}</Text>
          </View>
        )}
      </View>
    </View>
  )
}
