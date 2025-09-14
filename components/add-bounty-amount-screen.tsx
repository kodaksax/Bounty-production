"use client"

import { useState, useEffect } from "react"
import { Target, X } from "lucide-react"
import { cn } from "lib/utils"
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';

interface AddBountyAmountScreenProps {
  onBack: () => void
  onAddAmount: (amount: number, isForHonor: boolean) => void
  initialAmount?: number
}

export function AddBountyAmountScreen({ onBack, onAddAmount, initialAmount = 0 }: AddBountyAmountScreenProps) {
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
    }
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: '#059669', // emerald-600
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
      backgroundColor: '#10B981', // emerald-400
    },
    toggleButtonInactive: {
      backgroundColor: '#065F46', // emerald-800
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
      color: '#6EE7B7', // emerald-300
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
      backgroundColor: '#065F46', // emerald-800
    },
    addButtonDisabled: {
      backgroundColor: 'rgba(6, 95, 70, 0.5)', // emerald-800/50
    },
    addButtonText: {
      fontWeight: '500',
      color: 'white',
      fontSize: 16,
    },
    addButtonTextDisabled: {
      color: '#6EE7B7', // emerald-300
    },
  });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerButton}>
          <X color="white" size={24} />
        </TouchableOpacity>
        <View style={styles.headerContent}>
          <Target color="white" size={20} style={styles.headerIcon} />
          <Text style={styles.headerTitle}>BOUNTY</Text>
        </View>
        <View style={styles.spacer} />
      </View>

      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={styles.title}>Add Bounty Amount</Text>
      </View>

      {/* Amount Display */}
      <View style={styles.amountContainer}>
        <Animated.Text
          style={[
            styles.amountText,
            { transform: [{ scale: animateAmount }] }
          ]}
        >
          ${formattedAmount()}
        </Animated.Text>
      </View>

      {/* For Honor Toggle */}
      <View style={styles.toggleContainer}>
        <Text style={styles.toggleLabel}>For Honor</Text>
        <TouchableOpacity
          onPress={() => setIsForHonor(!isForHonor)}
          style={[
            styles.toggleButton,
            isForHonor ? styles.toggleButtonActive : styles.toggleButtonInactive,
          ]}
        >
          <View
            style={[
              styles.toggleCircle,
              isForHonor ? styles.toggleCircleActive : styles.toggleCircleInactive,
            ]}
          />
        </TouchableOpacity>
      </View>

      {isForHonor && (
        <View style={styles.honorDescription}>
          <Text style={styles.honorDescriptionText}>
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
              activeOpacity={0.7}
            >
              <Text style={styles.keypadButtonText}>{num}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={handleDecimalPress}
            activeOpacity={0.7}
          >
            <Text style={styles.keypadButtonText}>.</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={() => handleNumberPress(0)}
            activeOpacity={0.7}
          >
            <Text style={styles.keypadButtonText}>0</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.keypadButton}
            onPress={handleDeletePress}
            activeOpacity={0.7}
          >
            <Text style={styles.keypadButtonText}>⌫</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Add Button */}
      <View style={styles.addButtonContainer}>
        <TouchableOpacity
          style={[
            styles.addButton,
            (Number.parseFloat(amount) > 0 || isForHonor) ? styles.addButtonEnabled : styles.addButtonDisabled,
          ]}
          disabled={!(Number.parseFloat(amount) > 0 || isForHonor)}
          onPress={handleAddBounty}
        >
          <Text style={[
            styles.addButtonText,
            !(Number.parseFloat(amount) > 0 || isForHonor) && styles.addButtonTextDisabled
          ]}>
            Add
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}
