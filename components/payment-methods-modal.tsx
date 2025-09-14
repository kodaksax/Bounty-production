"use client"

import type React from "react"

import { ArrowLeft, Plus } from "lucide-react"
import { useRef, useState } from "react"
import { Dimensions, PanResponder, View } from "react-native"
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
          <button onClick={onClose} style={{ padding: 4, backgroundColor: 'transparent', borderWidth: 0 }}>
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h2 style={{ marginLeft: 12, fontSize: 18, fontWeight: '500', color: 'white' }}>Add Payment Method</h2>
        </View>

        {/* Content */}
        {showAddCard ? (
          <AddCardModal
            onBack={() => setShowAddCard(false)}
            onSave={(cardData) => {
              // Handle saving card data
              setShowAddCard(false)
            }}
          />
        ) : (
          <View style={{ padding: 24, alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
            <button
              style={{ height: 64, width: 64, borderRadius: 32, backgroundColor: '#047857', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}
              onClick={() => setShowAddCard(true)}
            >
              <Plus className="h-8 w-8 text-white" />
            </button>
            <p style={{ color: 'white', fontWeight: '500' }}>Add Card</p>
          </View>
        )}
      </View>
    </View>
  )
}
