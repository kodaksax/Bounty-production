"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { cn } from "lib/utils"
import type React from "react"
import { useState } from "react"
import { 
  Text, 
  TextInput, 
  TouchableOpacity, 
  View, 
  Alert, 
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform
} from "react-native"
import { useStripe } from "../lib/stripe-context"
import { stripeService } from "../lib/services/stripe-service"

interface AddCardModalProps {
  visible: boolean
  onClose: () => void
  onSave?: (cardData: CardData) => void
}

interface CardData {
  cardNumber: string
  cardholderName: string
  expiryDate: string
  securityCode: string
}

export function AddCardModal({ visible, onClose, onSave }: AddCardModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [cardholderName, setCardholderName] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [securityCode, setSecurityCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [cardErrors, setCardErrors] = useState<{[key: string]: string}>({})
  
  const { createPaymentMethod, error: stripeError } = useStripe()

  const handleClose = () => {
    if (!isLoading) {
      onClose()
    }
  }

  const formatCardNumber = (value: string) => {
    const digits = value.replace(/\D/g, "")
    const groups = []

    for (let i = 0; i < digits.length && i < 16; i += 4) {
      groups.push(digits.slice(i, i + 4))
    }

    return groups.join(" ")
  }

  const handleCardNumberChange = (value: string) => {
    const formatted = formatCardNumber(value)
    setCardNumber(formatted)
    
    // Clear error when user starts typing
    if (cardErrors.cardNumber) {
      setCardErrors(prev => ({ ...prev, cardNumber: '' }))
    }
    
    // Basic validation
    const cleanNumber = value.replace(/\s/g, '')
    if (cleanNumber.length > 0 && !stripeService.validateCardNumber(cleanNumber)) {
      setCardErrors(prev => ({ ...prev, cardNumber: 'Invalid card number' }))
    }
  }

  const handleExpiryDateChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "")
    if (digitsOnly.length <= 4) {
      const month = digitsOnly.slice(0, 2)
      const year = digitsOnly.slice(2, 4)

      if (digitsOnly.length <= 2) {
        setExpiryDate(digitsOnly)
      } else {
        setExpiryDate(`${month}/${year}`)
      }
      
      // Clear error when user starts typing
      if (cardErrors.expiryDate) {
        setCardErrors(prev => ({ ...prev, expiryDate: '' }))
      }
      
      // Validate expiry date
      if (digitsOnly.length === 4) {
        const monthNum = parseInt(month)
        const yearNum = parseInt('20' + year)
        const currentYear = new Date().getFullYear()
        const currentMonth = new Date().getMonth() + 1
        
        if (monthNum < 1 || monthNum > 12) {
          setCardErrors(prev => ({ ...prev, expiryDate: 'Invalid month' }))
        } else if (yearNum < currentYear || (yearNum === currentYear && monthNum < currentMonth)) {
          setCardErrors(prev => ({ ...prev, expiryDate: 'Card has expired' }))
        }
      }
    }
  }

  const handleSave = async () => {
    setIsLoading(true)
    setCardErrors({})
    
    try {
      // Validate all fields
      const errors: {[key: string]: string} = {}
      
      if (!cardNumber || cardNumber.length < 19) {
        errors.cardNumber = 'Please enter a valid card number'
      }
      
      if (!cardholderName.trim()) {
        errors.cardholderName = 'Please enter the cardholder name'
      }
      
      if (!expiryDate || expiryDate.length < 5) {
        errors.expiryDate = 'Please enter a valid expiry date'
      }
      
      if (!securityCode || securityCode.length < 3) {
        errors.securityCode = 'Please enter a valid security code'
      }
      
      if (Object.keys(errors).length > 0) {
        setCardErrors(errors)
        return
      }

      // Create payment method through Stripe
      const paymentMethod = await createPaymentMethod({
        cardNumber,
        cardholderName,
        expiryDate,
        securityCode,
      })

      // Call onSave callback
      if (onSave) {
        onSave({
          cardNumber,
          cardholderName,
          expiryDate,
          securityCode,
        })
      }
      
      // Show success and close modal
      Alert.alert('Success', 'Payment method added successfully!', [
        { text: 'OK', onPress: onClose }
      ])
      
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add payment method')
    } finally {
      setIsLoading(false)
    }
  }

  const isFormValid = 
    cardNumber.length >= 19 && 
    cardholderName.trim() !== "" && 
    expiryDate.length >= 5 && 
    securityCode.length >= 3 &&
    Object.keys(cardErrors).length === 0

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView 
        style={styles.keyboardAvoid}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.overlay}>
          <View style={styles.modal}>
            {/* Header */}
            <View style={styles.header}>
              <TouchableOpacity onPress={handleClose} disabled={isLoading} style={styles.backButton}>
                <MaterialIcons name="arrow-back" size={24} color="#fff" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Add Card</Text>
              <View style={styles.headerSpacer} />
            </View>

            <ScrollView 
              style={styles.content}
              contentContainerStyle={styles.contentContainer}
              keyboardShouldPersistTaps="handled"
            >
              {/* Instructions */}
              <View style={styles.instructions}>
                <Text style={styles.instructionsText}>
                  Start typing to add your credit card details.{'\n'}Everything will update according to your data.
                </Text>
              </View>

              {/* Card Preview */}
              <View style={styles.cardPreviewContainer}>
                <View style={styles.cardPreview}>
                  <View style={styles.cardChipContainer}>
                    <View style={styles.cardChipCircle1} />
                    <View style={styles.cardChipCircle2} />
                  </View>

                  <Text style={styles.cardNumber}>
                    {cardNumber || "1244 1234 1345 3255"}
                  </Text>

                  <View style={styles.cardDetailsRow}>
                    <View>
                      <Text style={styles.cardLabel}>Name</Text>
                      <Text style={styles.cardValue}>{cardholderName || "Yessie"}</Text>
                    </View>
                    <View style={styles.cardExpiryContainer}>
                      <Text style={styles.cardLabel}>Expires</Text>
                      <Text style={styles.cardValue}>{expiryDate || "MM/YY"}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* Form Fields */}
              <View style={styles.formContainer}>
                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Card Number</Text>
                  <TextInput
                    value={cardNumber}
                    onChangeText={handleCardNumberChange}
                    placeholder="1244 1234 1345 3255"
                    placeholderTextColor="rgba(167, 243, 208, 0.5)"
                    maxLength={19}
                    keyboardType="numeric"
                    style={[
                      styles.input,
                      cardErrors.cardNumber && styles.inputError
                    ]}
                  />
                  {cardErrors.cardNumber && (
                    <Text style={styles.errorText}>{cardErrors.cardNumber}</Text>
                  )}
                </View>

                <View style={styles.fieldContainer}>
                  <Text style={styles.fieldLabel}>Cardholder Name</Text>
                  <TextInput
                    value={cardholderName}
                    onChangeText={(text) => {
                      setCardholderName(text)
                      if (cardErrors.cardholderName) {
                        setCardErrors(prev => ({ ...prev, cardholderName: '' }))
                      }
                    }}
                    placeholder="Yessie"
                    placeholderTextColor="rgba(167, 243, 208, 0.5)"
                    style={[
                      styles.input,
                      cardErrors.cardholderName && styles.inputError
                    ]}
                  />
                  {cardErrors.cardholderName && (
                    <Text style={styles.errorText}>{cardErrors.cardholderName}</Text>
                  )}
                </View>

                <View style={styles.rowContainer}>
                  <View style={styles.halfFieldContainer}>
                    <Text style={styles.fieldLabel}>Expiry Date</Text>
                    <TextInput
                      value={expiryDate}
                      onChangeText={handleExpiryDateChange}
                      placeholder="MM/YY"
                      placeholderTextColor="rgba(167, 243, 208, 0.5)"
                      maxLength={5}
                      keyboardType="numeric"
                      style={[
                        styles.input,
                        cardErrors.expiryDate && styles.inputError
                      ]}
                    />
                    {cardErrors.expiryDate && (
                      <Text style={styles.errorText}>{cardErrors.expiryDate}</Text>
                    )}
                  </View>

                  <View style={styles.halfFieldContainer}>
                    <Text style={styles.fieldLabel}>Security Code</Text>
                    <TextInput
                      value={securityCode}
                      onChangeText={(text) => {
                        const cleaned = text.replace(/\D/g, "").slice(0, 4)
                        setSecurityCode(cleaned)
                        if (cardErrors.securityCode) {
                          setCardErrors(prev => ({ ...prev, securityCode: '' }))
                        }
                      }}
                      placeholder="•••"
                      placeholderTextColor="rgba(167, 243, 208, 0.5)"
                      maxLength={4}
                      secureTextEntry
                      keyboardType="numeric"
                      style={[
                        styles.input,
                        cardErrors.securityCode && styles.inputError
                      ]}
                    />
                    {cardErrors.securityCode && (
                      <Text style={styles.errorText}>{cardErrors.securityCode}</Text>
                    )}
                  </View>
                </View>
              </View>

              {/* Error message from Stripe */}
              {stripeError && (
                <View style={styles.stripeErrorContainer}>
                  <Text style={styles.stripeErrorText}>{stripeError}</Text>
                </View>
              )}

              {/* Save Button */}
              <View style={styles.buttonContainer}>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={!isFormValid || isLoading}
                  style={[
                    styles.saveButton,
                    (!isFormValid || isLoading) && styles.saveButtonDisabled
                  ]}
                >
                  {isLoading ? (
                    <View style={styles.loadingContainer}>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.saveButtonText}>Adding Card...</Text>
                    </View>
                  ) : (
                    <Text style={[
                      styles.saveButtonText,
                      !isFormValid && styles.saveButtonTextDisabled
                    ]}>Save Card</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const styles = StyleSheet.create({
  keyboardAvoid: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modal: {
    backgroundColor: "#059669", // emerald-600
    borderRadius: 16,
    width: "100%",
    maxWidth: 500,
    maxHeight: "90%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    paddingTop: 24,
    backgroundColor: "#047857", // emerald-700
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  headerSpacer: {
    width: 32,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 16,
  },
  instructions: {
    paddingVertical: 8,
    marginBottom: 8,
  },
  instructionsText: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
    lineHeight: 20,
  },
  cardPreviewContainer: {
    paddingVertical: 16,
  },
  cardPreview: {
    backgroundColor: "#047857", // emerald-700
    borderRadius: 12,
    padding: 16,
  },
  cardChipContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
    height: 32,
  },
  cardChipCircle1: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "#ef4444", // red-500
  },
  cardChipCircle2: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "#eab308", // yellow-500
    marginLeft: -16,
  },
  cardNumber: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
    letterSpacing: 2,
    marginBottom: 24,
  },
  cardDetailsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  cardExpiryContainer: {
    alignItems: "flex-end",
  },
  cardLabel: {
    fontSize: 12,
    color: "#6ee7b7", // emerald-300
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  formContainer: {
    paddingVertical: 8,
  },
  fieldContainer: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 14,
    color: "#a7f3d0", // emerald-200
    marginBottom: 8,
  },
  input: {
    width: "100%",
    backgroundColor: "rgba(4, 120, 87, 0.5)", // emerald-700/50
    borderRadius: 8,
    padding: 12,
    color: "#fff",
    fontSize: 16,
    borderWidth: 1,
    borderColor: "transparent",
  },
  inputError: {
    borderColor: "#f87171", // red-400
  },
  errorText: {
    fontSize: 12,
    color: "#fca5a5", // red-300
    marginTop: 4,
  },
  rowContainer: {
    flexDirection: "row",
    gap: 16,
  },
  halfFieldContainer: {
    flex: 1,
  },
  stripeErrorContainer: {
    marginTop: 8,
    padding: 12,
    backgroundColor: "#fee2e2", // red-100
    borderRadius: 8,
  },
  stripeErrorText: {
    fontSize: 14,
    color: "#991b1b", // red-800
    textAlign: "center",
  },
  buttonContainer: {
    paddingTop: 16,
    paddingBottom: 8,
  },
  saveButton: {
    width: "100%",
    paddingVertical: 12,
    borderRadius: 9999, // full rounded
    backgroundColor: "#374151", // gray-700
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonDisabled: {
    backgroundColor: "rgba(55, 65, 81, 0.5)", // gray-700/50
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
  saveButtonTextDisabled: {
    color: "#d1d5db", // gray-300
  },
  loadingContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
})
