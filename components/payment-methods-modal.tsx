"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useEffect, useRef, useState } from "react"
import { Dimensions, PanResponder, Text, TouchableOpacity, View, ScrollView, Alert } from "react-native"
import { StripeAddCardModal } from "./stripe-add-card-modal"
import { stripeService, PaymentMethodData } from "../lib/services/stripe-service"


interface PaymentMethodsModalProps {
  isOpen: boolean
  onClose: () => void
}

export function PaymentMethodsModal({ isOpen, onClose }: PaymentMethodsModalProps) {

  const modalRef = useRef<View>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState(0)
  const [initialY, setInitialY] = useState(0)
  const [showAddCard, setShowAddCard] = useState(false)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodData[]>([])
  const [isLoading, setIsLoading] = useState(false)

  // Mock customer ID - in a real app, this would come from your user authentication
  const customerId = "cus_mock_customer_id"

  // Load payment methods when modal opens
  useEffect(() => {
    if (isOpen) {
      loadPaymentMethods()
    }
  }, [isOpen])

  const loadPaymentMethods = async () => {
    setIsLoading(true)
    try {
      const { paymentMethods: methods, error } = await stripeService.getPaymentMethods(customerId)
      if (error) {
        console.error('Error loading payment methods:', error)
        Alert.alert('Error', 'Failed to load payment methods')
      } else {
        setPaymentMethods(methods)
      }
    } catch (error) {
      console.error('Error loading payment methods:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeletePaymentMethod = async (paymentMethodId: string) => {
    Alert.alert(
      'Delete Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { success, error } = await stripeService.deletePaymentMethod(paymentMethodId)
            if (success) {
              setPaymentMethods(prev => prev.filter(pm => pm.id !== paymentMethodId))
              Alert.alert('Success', 'Payment method removed')
            } else {
              Alert.alert('Error', error?.message || 'Failed to delete payment method')
            }
          },
        },
      ]
    )
  }

  const handleSetAsDefault = async (paymentMethodId: string) => {
    const { success, error } = await stripeService.setDefaultPaymentMethod(customerId, paymentMethodId)
    if (success) {
      Alert.alert('Success', 'Default payment method updated')
      loadPaymentMethods() // Reload to show updated default status
    } else {
      Alert.alert('Error', error?.message || 'Failed to set default payment method')
    }
  }

  const handleCardAdded = (paymentMethod: any) => {
    // Refresh the payment methods list
    loadPaymentMethods()
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !showAddCard) {
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
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 50, justifyContent: 'flex-end', alignItems: 'center' }} {...panResponder.panHandlers}>
      <View
        ref={modalRef}
        style={{
          backgroundColor: '#059669', // emerald-600
          width: '100%',
          maxWidth: 400,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          overflow: 'hidden',
          transform: [{ translateY: dragOffset }],
          maxHeight: Dimensions.get('window').height * 0.9,
        }}
      >
        {/* Drag handle */}
        <View style={{ width: 48, height: 6, backgroundColor: 'rgba(16,185,129,0.5)', borderRadius: 8, alignSelf: 'center', marginVertical: 12 }} />

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
          <TouchableOpacity onPress={onClose} style={{ padding: 4, backgroundColor: 'transparent', borderWidth: 0 }}>
            <MaterialIcons name="arrow-back" size={24} color="#000000" />
          </TouchableOpacity>
          <Text style={{ marginLeft: 12, fontSize: 18, fontWeight: '500', color: 'white' }}>Add Payment Method</Text>
        </View>

        {/* Content */}
        {showAddCard ? (
          <StripeAddCardModal
            onBack={() => setShowAddCard(false)}
            onSave={handleCardAdded}
            customerId={customerId}
          />
        ) : (
          <ScrollView style={{ padding: 24, minHeight: 400 }}>
            {isLoading ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                <Text style={{ color: 'white', fontSize: 16 }}>Loading payment methods...</Text>
              </View>
            ) : paymentMethods.length > 0 ? (
              <>
                {paymentMethods.map((paymentMethod) => (
                  <View
                    key={paymentMethod.id}
                    style={{
                      backgroundColor: '#047857cc',
                      borderRadius: 12,
                      padding: 16,
                      marginBottom: 12,
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                      <View style={{
                        height: 48,
                        width: 48,
                        backgroundColor: '#065f46',
                        borderRadius: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginRight: 12,
                      }}>
                        <MaterialIcons name="credit-card" size={24} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 16, fontWeight: 'bold' }}>
                          {paymentMethod.card.brand.toUpperCase()} •••• {paymentMethod.card.last4}
                        </Text>
                        <Text style={{ color: '#6ee7b7', fontSize: 13 }}>
                          Expires {paymentMethod.card.exp_month}/{paymentMethod.card.exp_year}
                        </Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <TouchableOpacity
                        onPress={() => handleSetAsDefault(paymentMethod.id)}
                        style={{ marginRight: 12, padding: 8 }}
                      >
                        <MaterialIcons name="star-border" size={20} color="#6ee7b7" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => handleDeletePaymentMethod(paymentMethod.id)}
                        style={{ padding: 8 }}
                      >
                        <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
                
                <TouchableOpacity
                  style={{
                    backgroundColor: '#047857',
                    borderRadius: 12,
                    padding: 16,
                    marginTop: 12,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onPress={() => setShowAddCard(true)}
                >
                  <MaterialIcons name="add" size={24} color="#fff" />
                  <Text style={{ color: 'white', fontWeight: '500', marginLeft: 8 }}>Add Another Card</Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
                <TouchableOpacity
                  style={{ height: 64, width: 64, borderRadius: 32, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}
                  onPress={() => setShowAddCard(true)}
                >
                  <MaterialIcons name="add" size={24} color="#000000" />
                </TouchableOpacity>
                <Text style={{ color: 'white', fontWeight: '500' }}>Add Card</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  )
}
