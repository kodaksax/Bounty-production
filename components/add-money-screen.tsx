"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import { useState } from "react"
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from "react-native"
import { useStripe } from '../lib/stripe-context'
import { useWallet } from '../lib/wallet-context'

// API base URL from environment or default to localhost
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001'

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")
  const [isProcessing, setIsProcessing] = useState(false)
  const { deposit } = useWallet()
  const { processPayment, paymentMethods, isLoading: stripeLoading, error: stripeError } = useStripe()

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

  const handleAddMoney = async () => {
    const numAmount = Number.parseFloat(amount)
    if (!isNaN(numAmount) && numAmount > 0) {
      
      // Check if we have payment methods
      if (paymentMethods.length === 0) {
        Alert.alert(
          'No Payment Method', 
          'Please add a payment method first to add money to your wallet.',
          [{ text: 'OK' }]
        )
        return
      }

      setIsProcessing(true)
      
      try {
        // Call backend to create PaymentIntent
        const amountCents = Math.round(numAmount * 100)
        
        const response = await fetch(`${API_BASE_URL}/payments/create-payment-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amountCents,
            currency: 'usd',
            metadata: {
              purpose: 'wallet_deposit',
              amount: numAmount
            }
          })
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || 'Failed to create payment intent')
        }

        const { clientSecret, paymentIntentId } = await response.json()
        
        // Use existing processPayment if it can handle clientSecret directly,
        // or fallback to mock behavior
        const result = await processPayment(numAmount, paymentMethods[0]?.id)
        
        if (result.success) {
          // Add to local wallet balance
          await deposit(numAmount, { 
            method: 'Credit Card',
            title: 'Added Money via Stripe',
            status: 'completed'
          })
          
          // Show success message
          Alert.alert(
            'Success!', 
            `$${numAmount.toFixed(2)} has been added to your wallet.`,
            [{
              text: 'OK',
              onPress: () => {
                onAddMoney?.(numAmount)
                onBack?.()
              }
            }]
          )
        } else {
          Alert.alert(
            'Payment Failed', 
            result.error || 'Unable to process payment. Please try again.',
            [{ text: 'OK' }]
          )
        }
      } catch (error: any) {
        console.error('Payment error:', error)
        Alert.alert(
          'Error', 
          error.message || 'Something went wrong. Please try again.',
          [{ text: 'OK' }]
        )
      } finally {
        setIsProcessing(false)
      }
    } else {
      Alert.alert(
        'Invalid Amount', 
        'Please enter a valid amount greater than $0.',
        [{ text: 'OK' }]
      )
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
  <View className="fixed left-0 right-0 bg-emerald-600 pb-safe" style={{ position: 'absolute', bottom: 66 }}>
        <View className="px-4">
          <TouchableOpacity
            className={cn(
              "w-full py-4 rounded-full flex-row items-center justify-center",
              Number.parseFloat(amount) > 0 && !isProcessing ? "bg-gray-700" : "bg-gray-700/50"
            )}
            disabled={Number.parseFloat(amount) <= 0 || isProcessing}
            onPress={handleAddMoney}
            activeOpacity={0.8}
          >
            {isProcessing ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text className="text-center text-base font-medium text-white">Processing...</Text>
              </>
            ) : (
              <Text className={cn(
                "text-center text-base font-medium",
                Number.parseFloat(amount) > 0 ? "text-white" : "text-gray-300"
              )}>Add Money</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
