"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useRef, useState } from "react"
import { Alert, Dimensions, FlatList, PanResponder, Text, TouchableOpacity, View } from "react-native"
import { stripeService } from '../lib/services/stripe-service'
import { useStripe } from '../lib/stripe-context'
import { AddBankAccountModal } from "./add-bank-account-modal"
import { AddCardModal } from "./add-card-modal"

type PaymentMethodType = 'card' | 'bank_account'

interface PaymentMethodsModalProps {
  isOpen: boolean
  onClose: () => void
  /** Preferred method type to show (optional) */
  preferredType?: PaymentMethodType
}

export function PaymentMethodsModal({ isOpen, onClose, preferredType }: PaymentMethodsModalProps) {
  const modalRef = useRef<View>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [initialY, setInitialY] = useState(0)
  const [showAddCard, setShowAddCard] = useState(false)
  const [showAddBankAccount, setShowAddBankAccount] = useState(false)
  const [selectedMethodType, setSelectedMethodType] = useState<PaymentMethodType>(preferredType || 'card')
  
  const { paymentMethods, isLoading, removePaymentMethod, loadPaymentMethods, error: stripeError, clearError } = useStripe()
  const [loadFailed, setLoadFailed] = useState(false)

  // Initialize selected method type when modal opens, honoring preferredType if provided
  React.useEffect(() => {
    if (isOpen && preferredType) {
      setSelectedMethodType(preferredType)
    }
  }, [isOpen, preferredType])

  // Refresh payment methods with retry logic
  // Let Stripe SDK and network stack handle timeouts naturally
  const refreshWithRetry = async (totalAttempts = 4, baseDelayMs = 1000) => {
    let lastErr: unknown
    setLoadFailed(false)
    for (let i = 0; i < totalAttempts; i++) {
      try {
        // Clear previous errors before attempt
        clearError()
        // Let SDK handle network timeouts without artificial limits
        await loadPaymentMethods()
        // If loadPaymentMethods resolved, success
        return
      } catch (e: unknown) {
        lastErr = e
        // Skip backoff after the last attempt
        if (i < totalAttempts - 1) {
          // Exponential backoff using provided base delay: base, 2*base, 4*base
          const backoffMs = Math.min(baseDelayMs * Math.pow(2, i), 4000)
          console.log(`[PaymentMethodsModal] Attempt ${i + 1}/${totalAttempts} failed, waiting ${backoffMs}ms before retry`)
          await new Promise(r => setTimeout(r, backoffMs))
        }
      }
    }
    console.warn('[PaymentMethodsModal] loadPaymentMethods failed after all attempts:', lastErr)
    setLoadFailed(true)
  }

  // Auto-refresh methods when modal opens
  React.useEffect(() => {
    if (isOpen) {
      refreshWithRetry(4) // Try 4 times total
    }
  }, [isOpen])

  const handleRemovePaymentMethod = (paymentMethodId: string) => {
    Alert.alert(
      'Remove Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Remove', 
          style: 'destructive',
          onPress: async () => {
            try {
              await removePaymentMethod(paymentMethodId)
            } catch (error) {
              Alert.alert('Error', 'Failed to remove payment method')
            }
          }
        }
      ]
    )
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !showAddCard && !showAddBankAccount) {
      onClose()
    }
  }

  // React Native/Expo Go: Use PanResponder for drag gestures
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt, gestureState) => {
      setIsDragging(true)
      setInitialY(gestureState.y0)
      setDragOffset(0)
    },
    onPanResponderMove: (evt, gestureState) => {
      if (!isDragging) return
      const offset = gestureState.moveY - initialY
      if (offset > 0) {
        setDragOffset(offset)
      }
    },
    onPanResponderRelease: (evt, gestureState) => {
      setIsDragging(false)
      if (dragOffset > 100) {
        onClose()
      } else {
        setDragOffset(0)
      }
    },
    onPanResponderTerminate: () => {
      setIsDragging(false)
      setDragOffset(0)
    },
  })

  if (!isOpen) return null

  return (
    <View style={{ 
      position: 'absolute', 
      left: 0, 
      right: 0, 
      bottom: 0, 
      top: 0, 
      backgroundColor: 'rgba(0,0,0,0.6)', 
      zIndex: 50, 
      justifyContent: 'flex-end', 
      alignItems: 'center' 
    }} {...panResponder.panHandlers}>
      <View
        ref={modalRef}
        style={{
          backgroundColor: '#059669', // emerald-600
          width: '100%',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          overflow: 'hidden',
          transform: [{ translateY: dragOffset }],
          maxHeight: Dimensions.get('window').height * 0.92, // Increased for iPhone
          minHeight: 400, // Ensure minimum usable height
        }}
      >
        {/* Drag handle - larger for iPhone */}
        <View style={{ 
          width: 56, 
          height: 6, 
          backgroundColor: 'rgba(255,255,255,0.3)', 
          borderRadius: 8, 
          alignSelf: 'center', 
          marginVertical: 14 
        }} />

        {/* Header - improved spacing for iPhone */}
        <View style={{ 
          flexDirection: 'row', 
          alignItems: 'center', 
          paddingHorizontal: 20, 
          paddingVertical: 12,
          paddingTop: 4
        }}>
          <TouchableOpacity 
            onPress={onClose} 
            style={{ 
              padding: 8, 
              marginRight: 4,
              minWidth: 44, 
              minHeight: 44, // iOS touch target size
              justifyContent: 'center',
              alignItems: 'center'
            }}
            accessibilityRole="button"
            accessibilityLabel="Close payment methods"
          >
            <MaterialIcons name="close" size={24} color="#ffffff" />
          </TouchableOpacity>
          <Text style={{ 
            marginLeft: 8, 
            fontSize: 20, 
            fontWeight: '600', 
            color: 'white',
            letterSpacing: 0.3 
          }}>Payment Methods</Text>
        </View>

        {/* Content */}
        {showAddCard ? (
          <AddCardModal
            embedded={true}
            onBack={() => setShowAddCard(false)}
            onSave={(cardData) => {
              // Card already added through Stripe service in AddCardModal
              setShowAddCard(false)
              // Refresh payment methods with longer timeout
              refreshWithRetry(3, 10000)
            }}
          />
        ) : showAddBankAccount ? (
          <AddBankAccountModal
            embedded={true}
            onBack={() => setShowAddBankAccount(false)}
            onSave={(bankData) => {
              // Bank account added through backend
              setShowAddBankAccount(false)
              // Refresh payment methods
              refreshWithRetry(3, 10000)
            }}
          />
        ) : (
          <View style={{ padding: 20, paddingBottom: 32, minHeight: 400 }}>
            {/* Method Type Tabs */}
            <View style={{
              flexDirection: 'row',
              marginBottom: 20,
              backgroundColor: '#047857',
              borderRadius: 12,
              padding: 4,
            }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: selectedMethodType === 'card' ? '#059669' : 'transparent',
                }}
                onPress={() => setSelectedMethodType('card')}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedMethodType === 'card' }}
                accessibilityLabel="Cards"
              >
                <Text style={{
                  color: 'white',
                  textAlign: 'center',
                  fontWeight: selectedMethodType === 'card' ? '600' : '400',
                  fontSize: 15,
                }}>
                  Cards
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: selectedMethodType === 'bank_account' ? '#059669' : 'transparent',
                }}
                onPress={() => setSelectedMethodType('bank_account')}
                accessibilityRole="tab"
                accessibilityState={{ selected: selectedMethodType === 'bank_account' }}
                accessibilityLabel="Bank Accounts"
              >
                <Text style={{
                  color: 'white',
                  textAlign: 'center',
                  fontWeight: selectedMethodType === 'bank_account' ? '600' : '400',
                  fontSize: 15,
                }}>
                  Bank Accounts
                </Text>
              </TouchableOpacity>
            </View>

            {/* Add Method Button */}
            <TouchableOpacity
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: '#047857', 
                borderRadius: 14,
                padding: 18,
                marginBottom: 20,
                minHeight: 56,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 3
              }}
              onPress={() => selectedMethodType === 'card' ? setShowAddCard(true) : setShowAddBankAccount(true)}
              accessibilityRole="button"
              accessibilityLabel={`Add new ${selectedMethodType === 'card' ? 'card' : 'bank account'}`}
            >
              <MaterialIcons name="add" size={26} color="#ffffff" />
              <Text style={{ 
                color: 'white', 
                fontWeight: '600', 
                marginLeft: 10,
                fontSize: 16 
              }}>
                {selectedMethodType === 'card' ? 'Add New Card' : 'Add Bank Account'}
              </Text>
            </TouchableOpacity>

            {/* Payment Methods List */}
            {isLoading ? (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <Text style={{ color: 'white', fontSize: 16 }}>Loading payment methods...</Text>
              </View>
            ) : selectedMethodType === 'card' && paymentMethods.length === 0 ? (
              // Show error state if load ultimately failed
              loadFailed || stripeError ? (
                <View style={{ alignItems: 'center', padding: 20 }}>
                  <MaterialIcons name="error-outline" size={48} color="#fee2e2" />
                  <Text style={{ color: '#fee2e2', textAlign: 'center', marginTop: 12, fontSize: 15, lineHeight: 22 }}>
                    {(() => {
                      if (!stripeError) {
                        return 'Unable to load payment methods. Please check your connection and try again.';
                      }

                      if (stripeError.includes('timed out') || stripeError.includes('timeout')) {
                        return 'Connection timed out. Please check your internet connection and try again.';
                      }

                      if (stripeError.includes('Network')) {
                        return 'Unable to connect. Please check your internet connection.';
                      }

                      return stripeError;
                    })()}
                  </Text>
                  <TouchableOpacity
                    onPress={() => refreshWithRetry(3, 10000)}
                    style={{ marginTop: 16, backgroundColor: '#065f46', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 }}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading payment methods"
                  >
                    <Text style={{ color: 'white', fontWeight: '600', fontSize: 15 }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <MaterialIcons name="credit-card" size={56} color="rgba(255,255,255,0.4)" />
                <Text style={{ 
                  color: 'rgba(255,255,255,0.8)', 
                  textAlign: 'center', 
                  marginTop: 16,
                  fontSize: 16,
                  lineHeight: 24
                }}>
                  No payment methods added yet.{'\n'}Add your first card to get started.
                </Text>
              </View>
              )
            ) : selectedMethodType === 'bank_account' ? (
              // Bank accounts - UI for listing will be added in future iteration
              <View style={{ alignItems: 'center', padding: 40 }}>
                <MaterialIcons name="account-balance" size={56} color="rgba(255,255,255,0.4)" />
                <Text style={{ 
                  color: 'rgba(255,255,255,0.8)', 
                  textAlign: 'center', 
                  marginTop: 16,
                  fontSize: 16,
                  lineHeight: 24
                }}>
                  No bank accounts added yet.{'\n'}Add a bank account for ACH payments.
                </Text>
              </View>
            ) : (
              <FlatList
                data={paymentMethods}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={{ 
                    flexDirection: 'row', 
                    alignItems: 'center', 
                    backgroundColor: 'rgba(16,185,129,0.25)', 
                    borderRadius: 14,
                    padding: 18,
                    marginBottom: 14,
                    minHeight: 72, // Comfortable touch target height
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.1,
                    shadowRadius: 2,
                    elevation: 2
                  }}>
                    <MaterialIcons name="credit-card" size={34} color="#ffffff" />
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={{ 
                        color: 'white', 
                        fontWeight: '600',
                        fontSize: 16,
                        marginBottom: 4
                      }}>
                        {stripeService.formatCardDisplay(item)}
                      </Text>
                      <Text style={{ 
                        color: 'rgba(255,255,255,0.75)', 
                        fontSize: 14,
                        letterSpacing: 0.2 
                      }}>
                        Expires {item.card.exp_month.toString().padStart(2, '0')}/{item.card.exp_year}
                      </Text>
                    </View>
                    <TouchableOpacity accessibilityRole="button"
                      onPress={() => handleRemovePaymentMethod(item.id)}
                      style={{ 
                        padding: 12,
                        minWidth: 44,
                        minHeight: 44,
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >
                      <MaterialIcons name="delete" size={22} color="rgba(255,255,255,0.7)" />
                    </TouchableOpacity>
                  </View>
                )}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
              />
            )}
          </View>
        )}
      </View>
    </View>
  )
}
