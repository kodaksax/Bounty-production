"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import { useState } from "react"
import { Alert, Text, TouchableOpacity, View, Platform } from "react-native"

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")
  const [isProcessing, setIsProcessing] = useState(false)

  // Mock customer ID - in a real app, this would come from your user authentication
  const customerId = "cus_mock_customer_id"

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
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount')
      return
    }

    // For now, show mock success on all platforms since we need backend integration
    Alert.alert('Success', `Successfully added $${numAmount.toFixed(2)} to your wallet!`)
    if (onAddMoney) {
      onAddMoney(numAmount)
    }
    return

    // TODO: Uncomment this section when backend is ready and remove the mock above
    /*
    // If on web, show mock success
    if (Platform.OS === 'web') {
      Alert.alert('Success', `Mock: Successfully added $${numAmount.toFixed(2)} to your wallet!`)
      if (onAddMoney) {
        onAddMoney(numAmount)
      }
      return
    }

    // For native platforms, use Stripe
    setIsProcessing(true)

    try {
      // Dynamically import Stripe hooks only on native platforms
      const { useConfirmPayment } = await import('../lib/services/stripe-service')
      const confirmPayment = useConfirmPayment?.()?.confirmPayment

      if (!confirmPayment) {
        Alert.alert('Error', 'Payment service not available')
        return
      }

      // Step 1: Create payment intent from your backend
      const { paymentIntent, error: intentError } = await stripeService.createPaymentIntent(
        numAmount,
        'usd',
        customerId
      )
      
      if (intentError || !paymentIntent) {
        Alert.alert('Error', intentError?.message || 'Failed to prepare payment')
        return
      }

      // Step 2: Confirm the payment with Stripe
      const { paymentIntent: confirmedPayment, error: confirmError } = await confirmPayment(
        paymentIntent.client_secret,
        {
          paymentMethodType: 'Card',
        }
      )

      if (confirmError) {
        Alert.alert('Payment Failed', confirmError.message || 'Failed to process payment')
        return
      }

      if (confirmedPayment?.status === 'Succeeded') {
        Alert.alert('Success', `Successfully added $${numAmount.toFixed(2)} to your wallet!`)
        
        // Update the balance in the parent component
        if (onAddMoney) {
          onAddMoney(numAmount)
        }
      } else {
        Alert.alert('Payment Failed', 'Payment was not completed. Please try again.')
      }
    } catch (error) {
      console.error('Error processing payment:', error)
      Alert.alert('Error', 'An unexpected error occurred')
    } finally {
      setIsProcessing(false)
    }
    */
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white overflow-y-auto">
      {/* Header - Fixed at top */}
      <View className="sticky top-0 z-10 bg-emerald-600 flex justify-between items-center p-4 pt-8">
        <TouchableOpacity onPress={onBack} className="p-1">
          <MaterialIcons name="close" size={24} color="#000000" />
        </TouchableOpacity>
        <View className="flex items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
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
            <TouchableOpacity
              key={num}
              className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
              onPress={() => handleNumberPress(num)}
            >
              <Text className="text-2xl font-medium text-white">{num}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={handleDecimalPress}
          >
            <Text className="text-2xl font-medium text-white">.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={() => handleNumberPress(0)}
          >
            <Text className="text-2xl font-medium text-white">0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="h-14 md:h-16 rounded-full flex items-center justify-center text-2xl font-medium hover:bg-emerald-700/50 transition-colors"
            onPress={handleDeletePress}
          >
            <Text className="text-2xl font-medium text-white">{"<"}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button - Fixed at bottom with safe area padding, moved up by 50px */}
  <View className="fixed bottom-0 left-0 right-0 bg-emerald-600 pb-safe" style={{ bottom: 50 } as any}>
        <View className="p-4 pb-8">
          <TouchableOpacity
            className={cn(
              "w-full py-4 rounded-lg font-medium text-center",
              Number.parseFloat(amount) > 0 && !isProcessing
                ? "bg-gray-700 hover:bg-gray-600 transition-colors"
                : "bg-gray-700/50 text-gray-300 cursor-not-allowed",
            )}
            disabled={Number.parseFloat(amount) <= 0 || isProcessing}
            onPress={handleAddMoney}
          >
            <Text className={cn(
              "font-medium text-center",
              Number.parseFloat(amount) > 0 && !isProcessing ? "text-white" : "text-gray-300"
            )}>
              {isProcessing ? "Processing..." : "Add"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
