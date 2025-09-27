"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useState, useRef } from "react"
import { StyleSheet, Text, TouchableOpacity, View, Animated, PanResponder } from "react-native"
import { BountyDetailModal } from "./bountydetailmodal"

export interface BountyListItemProps {
  id: number
  title: string
  username: string
  price: number
  distance: number
  description?: string
}

export function BountyListItem({ id, title, username, price, distance, description }: BountyListItemProps) {
  const [showDetail, setShowDetail] = useState(false)
  const scaleValue = useRef(new Animated.Value(1)).current
  const opacityValue = useRef(new Animated.Value(1)).current

  // Enhanced touch interactions
  const handlePressIn = () => {
    Animated.parallel([
      Animated.timing(scaleValue, {
        toValue: 0.98,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityValue, {
        toValue: 0.8,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start()
  }

  const handlePressOut = () => {
    Animated.parallel([
      Animated.timing(scaleValue, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityValue, {
        toValue: 1,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start()
  }

  return (
    <>
      <Animated.View
        style={[
          { transform: [{ scale: scaleValue }], opacity: opacityValue }
        ]}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.row}
          onPress={() => setShowDetail(true)}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Bounty: ${title}, by ${username}, ${distance} miles away, $${price}`}
          accessibilityHint="Tap to view bounty details and apply"
          accessibilityState={{ expanded: showDetail }}
        >
        {/* Leading icon/avatar */}
        <View style={styles.leadingIconWrap} accessibilityElementsHidden={true}>
          <MaterialIcons name="paid" size={18} color="#a7f3d0" />
        </View>

        {/* Main content */}
        <View style={styles.mainContent}>
          <Text style={styles.title} numberOfLines={2} accessibilityRole="header">{title}</Text>
          <View style={styles.metaRow} accessibilityElementsHidden={true}>
            <Text style={styles.username}>{username}</Text>
            <View style={styles.dot} />
            <Text style={styles.distance}>{distance} mi</Text>
          </View>
        </View>

        {/* Trailing price and chevron */}
        <View style={styles.trailing} accessibilityElementsHidden={true}>
          <Text style={styles.price}>${price}</Text>
          <MaterialIcons name="chevron-right" size={20} color="#d1fae5" />
        </View>
        </TouchableOpacity>
      </Animated.View>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username, title, price, distance, description }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 97, 62, 0.75)', // lighter emerald surface for better fog contrast
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)', // slightly more visible emerald border
    // Enhanced shadows and glass-morphism
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    // Backdrop blur effect simulation
    overflow: 'hidden',
  },
  leadingIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.12)', // spy-glow tinted
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(16, 185, 129, 0.25)',
    // Add subtle inner glow
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 2,
  },
  mainContent: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 16,
    marginBottom: 6,
    letterSpacing: 0.3,
    lineHeight: 22,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    color: '#a7f3d0', // emerald-200 with slight opacity
    fontSize: 13,
    fontWeight: '500',
    opacity: 0.9,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(167, 243, 208, 0.6)',
    marginHorizontal: 8,
  },
  distance: {
    color: 'rgba(209, 250, 229, 0.8)', // emerald-100 with opacity
    fontSize: 13,
    fontWeight: '400',
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 16,
  },
  price: {
    color: '#fbbf24', // Enhanced amber for premium feel
    fontWeight: '800',
    fontSize: 18,
    marginBottom: 4,
    // Add subtle glow to price
    textShadowColor: 'rgba(251, 191, 36, 0.3)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
})

export default BountyListItem
