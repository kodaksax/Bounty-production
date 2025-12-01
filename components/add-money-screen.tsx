"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { cn } from "lib/utils"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, Platform, Text, TouchableOpacity, View } from "react-native"
import { useAuthContext } from '../hooks/use-auth-context'
import { applePayService } from '../lib/services/apple-pay-service'
import { useStripe } from '../lib/stripe-context'
import { getPaymentErrorMessage, getUserFriendlyError } from '../lib/utils/error-messages'
import { useWallet } from '../lib/wallet-context'
import { ErrorBanner } from './error-banner'
import { PaymentMethodsModal } from './payment-methods-modal'

import { API_BASE_URL } from 'lib/config/api'

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")
  const [isProcessing, setIsProcessing] = useState(false)
  const [showPaymentMethodsModal, setShowPaymentMethodsModal] = useState(false)
  const [isApplePayAvailable, setIsApplePayAvailable] = useState(false)
  const [error, setError] = useState<any>(null)
  const { deposit } = useWallet()
  const { processPayment, paymentMethods, isLoading: stripeLoading, error: stripeError, loadPaymentMethods } = useStripe()
  const { session } = useAuthContext()

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
          'You need to add a payment method before you can add money to your wallet.',
          [
            { text: 'Cancel', style: 'cancel' },
            { 
              text: 'Add Payment Method', 
              onPress: () => setShowPaymentMethodsModal(true)
            }
          ]
        )
        return
      }

      setIsProcessing(true)
      setError(null)
      
      try {
        // Get auth token
        if (!session?.access_token) {
          throw new Error('Not authenticated. Please sign in again.')
        }

          // Call backend to create PaymentIntent
          const amountCents = Math.round(numAmount * 100)
        
          const endpoint = `${API_BASE_URL}/payments/create-payment-intent`
          console.log('Creating PaymentIntent at', endpoint, { amountCents })
          const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
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
        
        // Use existing processPayment - this will use the clientSecret internally
        // The backend webhook will handle updating the wallet balance when payment succeeds
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
          // Get user-friendly payment error message
          const errorMsg = getPaymentErrorMessage(result.error)
          setError({ message: errorMsg, type: 'payment' })
        }
      } catch (err: any) {
        console.error('Payment error:', err)
        setError(err)
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

  // Check Apple Pay availability on mount
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const available = await applePayService.isAvailable()
        if (mounted) setIsApplePayAvailable(available)
      } catch (e) {
        // ignore
      }
    })()
    return () => { mounted = false }
  }, [])

  const handleApplePayPress = async () => {
    const numAmount = Number.parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount')
      return
    }

    if (numAmount < 0.5) {
      Alert.alert('Minimum Amount', 'Amount must be at least $0.50')
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const result = await applePayService.processPayment({
        amount: numAmount,
        description: 'Add Money to Wallet',
      }, session?.access_token)

      if (result.success) {
        await deposit(numAmount, {
          method: 'Apple Pay',
          title: 'Added Money via Apple Pay',
          status: 'completed',
        })

        Alert.alert(
          'Success!',
          `$${numAmount.toFixed(2)} has been added to your wallet via Apple Pay.`,
          [
            {
              text: 'OK',
              onPress: () => {
                onAddMoney?.(numAmount)
                onBack?.()
              },
            },
          ]
        )
      } else if (result.errorCode === 'cancelled') {
        // user cancelled - no alert
        console.log('Apple Pay cancelled by user')
      } else {
        // Show error banner instead of alert
        setError({ message: result.error || 'Unable to process Apple Pay payment.', type: 'payment' })
      }
    } catch (err) {
      console.error('Apple Pay error:', err)
      setError(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleCardPayment = async () => {
    // Reuse existing card flow
    await handleAddMoney()
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
            <BrandingLogo size="small" />
          </View>
          <View style={{ width: 40 }} />
        </View>
        <Text className="text-white text-base text-center mt-1">Add Cash</Text>
      </View>

      {/* Amount Display */}
      <View className="items-center justify-center py-6">
        <Text className="text-white" style={{ fontSize: 56, fontWeight: '800' }}>${amount}</Text>
      </View>

      {/* Error Display */}
      {error && (
        <View className="px-4 mb-4">
          <ErrorBanner
            error={getUserFriendlyError(error)}
            onDismiss={() => setError(null)}
            onAction={error.type === 'payment' ? () => handleAddMoney() : undefined}
          />
        </View>
      )}

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
            {/* Apple Pay button (iOS only) */}
            {Platform.OS === 'ios' && isApplePayAvailable && (
              <TouchableOpacity
                className="w-full py-4 rounded-full flex-row items-center justify-center mb-3"
                style={{ backgroundColor: '#000000' }}
                onPress={handleApplePayPress}
                disabled={Number.parseFloat(amount) <= 0 || isProcessing}
                activeOpacity={0.8}
              >
                {isProcessing ? (
                  <>
                    <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                    <Text className="text-center text-base font-medium text-white">Processing...</Text>
                  </>
                ) : (
                  <>
                    <MaterialIcons name="apple" size={22} color="#ffffff" />
                    <Text className="text-white text-base font-medium ml-2">Pay</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {/* Pay with Card removed per request */}

            {/* Original Add Money button (keeps compatibility) */}
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

      {/* Payment Methods Modal */}
      {showPaymentMethodsModal && (
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => {
            setShowPaymentMethodsModal(false)
            // Refresh payment methods after closing
            loadPaymentMethods()
          }}
        />
      )}
    </View>
  )
}
