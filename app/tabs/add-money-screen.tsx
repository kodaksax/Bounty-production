"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import { useState } from "react"
import { ActivityIndicator, Alert, Text, TouchableOpacity, View } from "react-native"
import { useTheme } from '../../components/theme-provider'
import { useStripe } from '../../lib/stripe-context'
import { useWallet } from '../../lib/wallet-context'
// Local fallback semantic colors (small subset used by this screen).
// This avoids depending on path aliases or bundler resolution in dev envs.
const fallbackSemantic = {
  backgroundPrimary: '#1a3d2e',
  backgroundSecondary: '#2d5240',
  textPrimary: '#fffef5',
  textSecondary: 'rgba(255, 254, 245, 0.8)',
  textMuted: 'rgba(255, 254, 245, 0.6)',
  accent: '#00912C',
  accentSubtle: 'rgba(0,145,44,0.15)',
  textInverted: '#1a3d2e',
  borderMuted: 'rgba(0,145,44,0.2)'
} as const

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
        // Process payment through Stripe
        const result = await processPayment(numAmount)
        
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
      } catch (error) {
        Alert.alert(
          'Error', 
          'Something went wrong. Please try again.',
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

  // Read theme safely — ThemeProviderState may not include `semanticColors`.
  // Try `semanticColors`, then `colors`, then fall back to our lib/theme default.
  const theme = useTheme() as any
  const sc = theme?.semanticColors ?? theme?.colors ?? fallbackSemantic

  return (
    <View className="flex-1" style={{ backgroundColor: sc.backgroundPrimary }}>
      {/* Header */}
      <View className="sticky top-0 z-10 px-4 pt-safe pb-2" style={{ backgroundColor: sc.backgroundPrimary }}>
        <View className="flex-row items-center justify-between">
          <TouchableOpacity onPress={onBack} className="p-2 touch-target-min">
            <MaterialIcons name="close" size={24} color={sc.textPrimary} />
          </TouchableOpacity>
          <View className="flex-row items-center gap-2">
            <MaterialIcons name="gps-fixed" size={22} color={sc.textPrimary} />
            <Text className="font-bold tracking-wider" style={{ color: sc.textPrimary }}>BOUNTY</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>
        <Text className="text-base text-center mt-1" style={{ color: sc.textSecondary }}>Add Cash</Text>
      </View>

      {/* Amount Display */}
      <View className="items-center justify-center py-6">
        <Text style={{ fontSize: 56, fontWeight: '800', color: sc.textPrimary }}>${amount}</Text>
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
                <Text style={{ fontSize: 24, fontWeight: '600', color: sc.textPrimary }}>{num}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
        <View className="flex-row justify-between">
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64, backgroundColor: 'transparent' }}
            onPress={handleDecimalPress}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 24, fontWeight: '600', color: sc.textPrimary }}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64, backgroundColor: 'transparent' }}
            onPress={() => handleNumberPress(0)}
            activeOpacity={0.7}
          >
            <Text style={{ fontSize: 24, fontWeight: '600', color: sc.textPrimary }}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="rounded-full items-center justify-center"
            style={{ width: 64, height: 64, backgroundColor: 'transparent' }}
            onPress={handleDeletePress}
            activeOpacity={0.7}
          >
            <MaterialIcons name="backspace" size={26} color={sc.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button - fixed above home indicator */}
      <View className="fixed left-0 right-0 pb-safe" style={{ position: 'absolute', bottom: 86, backgroundColor: sc.backgroundPrimary }}>
        <View className="px-4">
          <TouchableOpacity
            className={cn(
              "w-full py-4 rounded-full flex-row items-center justify-center"
            )}
            style={{ backgroundColor: Number.parseFloat(amount) > 0 && !isProcessing ? sc.accent : sc.accentSubtle }}
            disabled={Number.parseFloat(amount) <= 0 || isProcessing}
            onPress={handleAddMoney}
            activeOpacity={0.8}
          >
            {isProcessing ? (
              <>
                <ActivityIndicator size="small" color={sc.textInverted} style={{ marginRight: 8 }} />
                <Text className="text-center text-base font-medium" style={{ color: sc.textInverted }}>Processing...</Text>
              </>
            ) : (
              <Text className="text-center text-base font-medium" style={{ color: Number.parseFloat(amount) > 0 ? sc.textInverted : sc.textMuted }}>Add Money</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  )
}
