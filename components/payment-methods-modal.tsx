"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useRef, useState } from "react"
import { Alert, Dimensions, FlatList, PanResponder, Text, TouchableOpacity, View } from "react-native"
import { stripeService } from '../lib/services/stripe-service'
import { useStripe } from '../lib/stripe-context'
import { AddCardModal } from "./add-card-modal"


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
              // Refresh payment methods
              loadPaymentMethods()
            }}
          />
        ) : (
          <View style={{ padding: 20, paddingBottom: 32, minHeight: 400 }}>
            {/* Add Card Button - larger touch target for iPhone */}
            <TouchableOpacity
              style={{ 
                flexDirection: 'row', 
                alignItems: 'center', 
                backgroundColor: '#047857', 
                borderRadius: 14,
                padding: 18,
                marginBottom: 20,
                minHeight: 56, // Comfortable touch target
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 3
              }}
              onPress={() => setShowAddCard(true)}
            >
              <MaterialIcons name="add" size={26} color="#ffffff" />
              <Text style={{ 
                color: 'white', 
                fontWeight: '600', 
                marginLeft: 10,
                fontSize: 16 
              }}>Add New Card</Text>
            </TouchableOpacity>

            {/* Payment Methods List */}
            {isLoading ? (
              <View style={{ alignItems: 'center', padding: 40 }}>
                <Text style={{ color: 'white', fontSize: 16 }}>Loading payment methods...</Text>
              </View>
            ) : paymentMethods.length === 0 ? (
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
                    <TouchableOpacity
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
