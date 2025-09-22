"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import React, { useRef, useState } from "react"
import { Dimensions, PanResponder, Text, TouchableOpacity, View, ScrollView, Alert } from "react-native"
import { AddCardModal } from "./add-card-modal"


interface PaymentMethodsModalProps {
  isOpen: boolean
  onClose: () => void
}

interface PaymentMethodData {
  id: string;
  type: 'card';
  card: {
    brand: string;
    last4: string;
    exp_month: number;
    exp_year: number;
  };
  billing_details?: {
    name?: string;
    email?: string;
  };
  created: number;
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

  const handleCardAdded = (paymentMethod: any) => {
    // Mock: In a real app, this would refresh the payment methods list
    console.log('Card added:', paymentMethod)
    setShowAddCard(false)
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
          <AddCardModal
            onBack={() => setShowAddCard(false)}
            onSave={handleCardAdded}
          />
        ) : (
          <ScrollView style={{ padding: 24, minHeight: 400 }}>
            {isLoading ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 200 }}>
                <Text style={{ color: 'white', fontSize: 16 }}>Loading payment methods...</Text>
              </View>
            ) : (
              <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
                <TouchableOpacity
                  style={{ height: 64, width: 64, borderRadius: 32, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}
                  onPress={() => setShowAddCard(true)}
                >
                  <MaterialIcons name="add" size={24} color="#000000" />
                </TouchableOpacity>
                <Text style={{ color: 'white', fontWeight: '500' }}>Add Card</Text>
                <Text style={{ color: '#6ee7b7', fontSize: 12, marginTop: 4, textAlign: 'center' }}>
                  Payment methods will be loaded when backend is connected
                </Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </View>
  )
}
