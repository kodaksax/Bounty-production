"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useRef, useState } from "react"
import { Dimensions, PanResponder, Text, TouchableOpacity, View, FlatList, Alert } from "react-native"
import { AddCardModal } from "./add-card-modal"
import { useStripe } from '../lib/stripe-context'
import { stripeService } from '../lib/services/stripe-service'


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
  
  const { paymentMethods, isLoading, removePaymentMethod, loadPaymentMethods } = useStripe()

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
          <Text style={{ marginLeft: 12, fontSize: 18, fontWeight: '500', color: 'white' }}>Payment Methods</Text>
        </View>

        {/* Content */}
        {showAddCard ? (
          <AddCardModal
            onBack={() => setShowAddCard(false)}
            onSave={(cardData) => {
              // Card already added through Stripe service in AddCardModal
              setShowAddCard(false)
              // Refresh payment methods
              loadPaymentMethods()
            }}
          />
        ) : (
          <View style={{ padding: 16, minHeight: 400 }}>
            {/* Add Card Button */}
            <TouchableOpacity
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: '#047857', 
                borderRadius: 12,
                padding: 16,
                marginBottom: 16
              }}
              onPress={() => setShowAddCard(true)}
            >
              <MaterialIcons name="add" size={24} color="#ffffff" />
              <Text style={{ color: 'white', fontWeight: '500', marginLeft: 8 }}>Add New Card</Text>
            </TouchableOpacity>

            {/* Payment Methods List */}
            {isLoading ? (
              <View style={{ alignItems: 'center', padding: 32 }}>
                <Text style={{ color: 'white' }}>Loading payment methods...</Text>
              </View>
            ) : paymentMethods.length === 0 ? (
              <View style={{ alignItems: 'center', padding: 32 }}>
                <MaterialIcons name="credit-card" size={48} color="rgba(255,255,255,0.5)" />
                <Text style={{ color: 'rgba(255,255,255,0.7)', textAlign: 'center', marginTop: 8 }}>
                  No payment methods added yet.{'\n'}Add your first card to get started.
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
                    backgroundColor: 'rgba(16,185,129,0.2)', 
                    borderRadius: 12,
                    padding: 16,
                    marginBottom: 12
                  }}>
                    <MaterialIcons name="credit-card" size={32} color="#ffffff" />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={{ color: 'white', fontWeight: '500' }}>
                        {stripeService.formatCardDisplay(item)}
                      </Text>
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
                        Expires {item.card.exp_month.toString().padStart(2, '0')}/{item.card.exp_year}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRemovePaymentMethod(item.id)}
                      style={{ padding: 8 }}
                    >
                      <MaterialIcons name="delete" size={20} color="rgba(255,255,255,0.7)" />
                    </TouchableOpacity>
                  </View>
                )}
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>
        )}
      </View>
    </View>
  )
}
