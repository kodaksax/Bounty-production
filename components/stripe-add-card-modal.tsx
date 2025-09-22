"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { CardField, useStripe } from '../lib/services/stripe-service'
import { cn } from "lib/utils"
import { stripeService } from "lib/services/stripe-service"
import type React from "react"
import { useState } from "react"
import { Alert, Text, TouchableOpacity, View, Platform } from "react-native"

interface StripeAddCardModalProps {
  onBack: () => void
  onSave?: (paymentMethod: any) => void
  customerId?: string
}

export function StripeAddCardModal({ onBack, onSave, customerId }: StripeAddCardModalProps) {
  const { confirmSetupIntent } = useStripe() || {}
  const [cardDetails, setCardDetails] = useState<any>(null)
  const [isLoading, setIsLoading] = useState(false)

  // If on web or Stripe not available, show fallback
  if (Platform.OS === 'web' || !CardField) {
    return (
      <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
        <View className="flex items-center justify-between p-4 pt-8">
          <TouchableOpacity onPress={onBack} className="p-1">
            <MaterialIcons name="arrow-back" size={24} color="#000000" />
          </TouchableOpacity>
          <View className="flex items-center">
            <MaterialIcons name="gps-fixed" size={24} color="#000000" />
            <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
          </View>
          <View className="w-6"></View>
        </View>
        
        <View className="px-4 py-6 flex-1 justify-center items-center">
          <MaterialIcons name="credit-card" size={64} color="#6ee7b7" />
          <Text className="text-white text-xl mt-4 text-center">
            Stripe payment integration is only available on mobile devices
          </Text>
          <Text className="text-green-300 text-sm mt-2 text-center">
            Please use the mobile app to add payment methods
          </Text>
        </View>
        
        <View className="px-4 pb-8">
          <TouchableOpacity
            className="w-full py-4 rounded-lg bg-gray-700"
            onPress={onBack}
          >
            <Text className="font-medium text-center text-white">Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  const handleAddCard = async () => {
    if (!cardDetails?.complete) {
      Alert.alert('Error', 'Please enter complete card details')
      return
    }

    setIsLoading(true)

    try {
      // Step 1: Create setup intent from your backend
      const { setupIntent, error: setupError } = await stripeService.createSetupIntent(customerId)
      
      if (setupError || !setupIntent) {
        Alert.alert('Error', setupError?.message || 'Failed to prepare card setup')
        return
      }

      // Step 2: Confirm the setup intent with the card
      const { setupIntent: confirmedSetupIntent, error: confirmError } = await confirmSetupIntent(
        setupIntent.client_secret,
        {
          paymentMethodType: 'Card',
        }
      )

      if (confirmError) {
        Alert.alert('Error', confirmError.message || 'Failed to add card')
        return
      }

      if (confirmedSetupIntent?.status === 'Succeeded') {
        Alert.alert('Success', 'Card added successfully!')
        
        // Call the onSave callback with the payment method
        if (onSave && confirmedSetupIntent.paymentMethod) {
          onSave(confirmedSetupIntent.paymentMethod)
        }
        
        onBack()
      } else {
        Alert.alert('Error', 'Failed to save card. Please try again.')
      }
    } catch (error) {
      console.error('Error adding card:', error)
      Alert.alert('Error', 'An unexpected error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-emerald-600 text-white">
      {/* Header */}
      <View className="flex items-center justify-between p-4 pt-8">
        <TouchableOpacity onPress={onBack} className="p-1">
          <MaterialIcons name="arrow-back" size={24} color="#000000" />
        </TouchableOpacity>
        <View className="flex items-center">
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text className="text-lg font-bold tracking-wider">BOUNTY</Text>
        </View>
        <View className="w-6"></View> {/* Empty div for spacing */}
      </View>

      {/* Title */}
      <View className="px-4 py-2">
        <Text className="text-xl font-medium text-white">Add Payment Method</Text>
      </View>

      {/* Card Input */}
      <View className="px-4 py-6">
        <Text className="text-white text-base mb-4">Card Information</Text>
        <View className="bg-white rounded-lg p-4">
          <CardField
            postalCodeEnabled={true}
            placeholders={{
              number: '4242 4242 4242 4242',
            }}
            cardStyle={{
              backgroundColor: '#FFFFFF',
              textColor: '#000000',
              fontSize: 16,
              placeholderColor: '#999999',
            }}
            style={{
              width: '100%',
              height: 50,
              marginVertical: 8,
            }}
            onCardChange={(cardDetails: any) => {
              setCardDetails(cardDetails)
            }}
          />
        </View>
        
        {/* Card security info */}
        <View className="flex-row items-center mt-4 px-2">
          <MaterialIcons name="lock" size={16} color="#6ee7b7" />
          <Text className="text-green-300 text-sm ml-2">
            Your card information is encrypted and secure
          </Text>
        </View>
      </View>

      {/* Add Button */}
      <View className="px-4 pb-8 mt-auto">
        <TouchableOpacity
          className={cn(
            "w-full py-4 rounded-lg font-medium text-center",
            cardDetails?.complete && !isLoading
              ? "bg-gray-700 hover:bg-gray-600 transition-colors"
              : "bg-gray-700/50 text-gray-300",
          )}
          disabled={!cardDetails?.complete || isLoading}
          onPress={handleAddCard}
        >
          <Text className={cn(
            "font-medium text-center",
            cardDetails?.complete && !isLoading ? "text-white" : "text-gray-300"
          )}>
            {isLoading ? "Adding Card..." : "Add Card"}
          </Text>
        </TouchableOpacity>
        
        <Text className="text-center text-green-300 text-xs mt-4">
          By adding a payment method, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </View>
  )
}