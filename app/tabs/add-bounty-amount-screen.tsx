"use client"

import { useState, useEffect } from "react"
import { View, Text, TouchableOpacity, StyleSheet, Animated } from "react-native"
import { MaterialIcons } from "@expo/vector-icons"

interface AddBountyAmountScreenProps {
  onBack: () => void
  onAddAmount: (amount: number, isForHonor: boolean) => void
  onProceedToConfirmation?: () => void
  initialAmount?: number
  showProceedButton?: boolean
}

export function AddBountyAmountScreen({ 
  onBack, 
  onAddAmount, 
  onProceedToConfirmation,
  initialAmount = 0,
  showProceedButton = false
}: AddBountyAmountScreenProps) {
  const [amount, setAmount] = useState<string>(initialAmount.toString())
  const [isForHonor, setIsForHonor] = useState<boolean>(false)
  const [animateAmount] = useState<Animated.Value>(new Animated.Value(1))

  // Format the amount with commas for thousands
  const formattedAmount = () => {
    if (amount === "0") return "0"

    // Format with commas for thousands
    const parts = amount.split(".")
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",")

    return parts.join(".")
  }

  const handleNumberPress = (num: number) => {
    // Animate the amount display
    Animated.sequence([
      Animated.timing(animateAmount, { toValue: 1.1, duration: 150, useNativeDriver: true }),
      Animated.timing(animateAmount, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start()

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
    // Animate the amount display
    Animated.sequence([
      Animated.timing(animateAmount, { toValue: 1.1, duration: 150, useNativeDriver: true }),
      Animated.timing(animateAmount, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start()

    if (!amount.includes(".")) {
      setAmount(amount + ".")
    }
  }

  const handleDeletePress = () => {
    // Animate the amount display
    Animated.sequence([
      Animated.timing(animateAmount, { toValue: 1.1, duration: 150, useNativeDriver: true }),
      Animated.timing(animateAmount, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start()

    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount("0")
    }
  }

  const handleAddBounty = () => {
    const numAmount = Number.parseFloat(amount)
    if (!isNaN(numAmount)) {
      onAddAmount(numAmount, isForHonor)
      
      // If we should proceed to confirmation, do that instead of going back
      if (showProceedButton && onProceedToConfirmation) {
        onProceedToConfirmation()
      }
    }
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#1a3d2e', // Updated to use new primary background
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: 16,
      paddingTop: 32,
    },
    headerButton: {
      padding: 4,
    },
    headerContent: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    headerIcon: {
      marginRight: 8,
    },
    headerTitle: {
      fontSize: 18,
      fontWeight: 'bold',
      color: 'white',
      letterSpacing: 2,
    },
    spacer: {
      width: 24,
    },
    titleContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
    },
    title: {
      fontSize: 20,
      fontWeight: '500',
      color: 'white',
    },
    amountContainer: {
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 24,
    },
    amountText: {
      fontSize: 48,
      fontWeight: 'bold',
      color: 'white',
    },
    toggleContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toggleLabel: {
      fontSize: 14,
      fontWeight: '500',
      color: 'white',
    },
    toggleButton: {
      width: 48,
      height: 24,
      borderRadius: 12,
      position: 'relative',
      justifyContent: 'center',
    },
    toggleButtonActive: {
      backgroundColor: '#00912C', // Company specified primary green base
    },
    toggleButtonInactive: {
      backgroundColor: '#61656b', // Company specified trim color
    },
    toggleCircle: {
      position: 'absolute',
      top: 4,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: 'white',
    },
    toggleCircleActive: {
      right: 4,
    },
    toggleCircleInactive: {
      left: 4,
    },
    honorDescription: {
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    honorDescriptionText: {
      fontSize: 12,
      color: '#c3c3c4', // Company specified subtle highlight color
    },
    keypadContainer: {
      flex: 1,
      paddingHorizontal: 16,
      marginTop: 16,
    },
    keypadGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    keypadButton: {
      width: '30%',
      height: 56,
      borderRadius: 28,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
      backgroundColor: 'transparent',
    },
    keypadButtonPressed: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-700/50
    },
    keypadButtonText: {
      fontSize: 24,
      fontWeight: '500',
      color: 'white',
    },
    addButtonContainer: {
      padding: 16,
      paddingBottom: 32,
    },
    addButton: {
      width: '100%',
      paddingVertical: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonEnabled: {
      backgroundColor: '#2d5240', // Updated to use new secondary background
    },
    addButtonDisabled: {
      backgroundColor: 'rgba(97, 101, 107, 0.5)', // Company specified trim color with transparency
    },
    addButtonText: {
      fontWeight: '500',
      color: '#fffef5', // Company specified header text/logos color
      fontSize: 16,
    },
    addButtonTextDisabled: {
      color: '#929497', // Company specified highlight color
    },
    // Style aliases to match JSX usage
    toggle: {
      width: 48,
      height: 24,
      borderRadius: 12,
      position: 'relative',
      justifyContent: 'center',
    },
    toggleActive: {
      backgroundColor: '#00912C', // Company specified primary green base
    },
    toggleInactive: {
      backgroundColor: '#61656b', // Company specified trim color
    },
    toggleSlider: {
      position: 'absolute',
      top: 4,
      width: 16,
      height: 16,
      borderRadius: 8,
      backgroundColor: 'white',
    },
    toggleSliderActive: {
      right: 4,
    },
    toggleSliderInactive: {
      left: 4,
    },
    honorTextContainer: {
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    honorText: {
      fontSize: 12,
      color: '#c3c3c4', // Company specified subtle highlight color
    },
    bottomButtonContainer: {
      padding: 16,
      paddingBottom: 32,
    },
    bottomButton: {
      width: '100%',
      paddingVertical: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    progressContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    progressText: {
      fontSize: 12,
      color: '#c3c3c4', // Company specified subtle highlight color
    },
    progressDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    progressDotComplete: {
      backgroundColor: '#00912C', // Company specified primary green base
    },
    progressDotActive: {
      backgroundColor: '#00912C', // Company specified primary green base
    },
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerButton}>
          <MaterialIcons name="close" size={24} color="#000000" />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <MaterialIcons name="gps-fixed" size={24} color="#000000" />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        <View style={{ width: 24 }} /> {/* Empty view for spacing */}
      </View>

      {/* Title */}
      <View style={styles.titleContainer}>
        {showProceedButton && (
          <View style={[styles.progressContainer, { marginBottom: 12 }]}>
            <Text style={styles.progressText}>Step 2 of 2: Set Amount</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={[styles.progressDot, styles.progressDotComplete]}></View>
              <View style={[styles.progressDot, styles.progressDotActive]}></View>
            </View>
          </View>
        )}
        <Text style={styles.title}>
          {showProceedButton ? "Set Your Bounty Amount" : "Add Bounty Amount"}
        </Text>
      </View>

      {/* Amount Display */}
      <View style={styles.amountContainer}>
        <Text style={styles.amountText}>
          ${formattedAmount()}
        </Text>
      </View>

      {/* For Honor Toggle */}
      <View style={styles.toggleContainer}>
        <Text style={styles.toggleLabel}>For Honor</Text>
        <TouchableOpacity
          onPress={() => setIsForHonor(!isForHonor)}
          style={[
            styles.toggle,
            isForHonor ? styles.toggleActive : styles.toggleInactive,
          ]}
        >
          <View 
            style={[
              styles.toggleSlider,
              isForHonor ? styles.toggleSliderActive : styles.toggleSliderInactive,
            ]}
          />
        </TouchableOpacity>
      </View>

      {isForHonor && (
        <View style={styles.honorTextContainer}>
          <Text style={styles.honorText}>
            This bounty will be posted without monetary reward. People will complete it for honor and reputation.
          </Text>
        </View>
      )}

      {/* Keypad */}
      <View style={styles.keypadContainer}>
        <View style={styles.keypadGrid}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
            <TouchableOpacity
              key={num}
              style={styles.keypadButton}
              onPress={() => handleNumberPress(num)}
            >
              <Text style={styles.keypadButtonText}>{num}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={handleDecimalPress}
          >
            <Text style={styles.keypadButtonText}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={() => handleNumberPress(0)}
          >
            <Text style={styles.keypadButtonText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={handleDeletePress}
          >
            <Text style={styles.keypadButtonText}>&lt;</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button */}
      <View style={styles.bottomButtonContainer}>
        <TouchableOpacity
          style={[
            styles.bottomButton,
            Number.parseFloat(amount) > 0 || isForHonor
              ? styles.addButtonEnabled
              : styles.addButtonDisabled,
          ]}
          disabled={!(Number.parseFloat(amount) > 0 || isForHonor)}
          onPress={handleAddBounty}
        >
          <Text style={[
            styles.addButtonText,
            !(Number.parseFloat(amount) > 0 || isForHonor) && styles.addButtonTextDisabled
          ]}>
            {showProceedButton ? "Continue" : "Add"}
          </Text>

        </TouchableOpacity>
      </View>
    </View>
  )
}
