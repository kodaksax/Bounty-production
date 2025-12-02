"use client"

import { MaterialIcons } from "@expo/vector-icons"
import type React from "react"
import { useState } from "react"
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { stripeService } from "../lib/services/stripe-service"
import { useStripe } from "../lib/stripe-context"

interface AddCardModalProps {
  onBack: () => void
  onSave?: (cardData: CardData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet)
   * This is used when the AddCardModal is shown inside another modal
   * (e.g. PaymentMethodsModal). Default: false
   */
  embedded?: boolean
}

interface CardData {
  cardNumber: string
  cardholderName: string
  expiryDate: string
  securityCode: string
}

export function AddCardModal({ onBack, onSave, embedded = false }: AddCardModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [cardholderName, setCardholderName] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [securityCode, setSecurityCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [cardErrors, setCardErrors] = useState<{[key: string]: string}>({})
  
  const { createPaymentMethod, error: stripeError } = useStripe()

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
        { text: 'OK', onPress: onBack }
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

  if (embedded) {
    // Render inline when embedded inside another modal
    return (
      <View style={embeddedStyles.container}>
        <View style={embeddedStyles.navBar}>
          <TouchableOpacity onPress={onBack} style={embeddedStyles.backButton} accessibilityRole="button" accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={embeddedStyles.title}>Add Card</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
          <Text style={styles.instructions}>Enter your card details. Data updates as you type.</Text>

          <View style={styles.previewCard}>
            <View style={styles.previewLogosRow}>
              <View style={styles.brandLogoPrimary} />
              <View style={styles.brandLogoSecondary} />
            </View>
            <Text style={styles.previewNumber}>{cardNumber || '1244 1234 1345 3255'}</Text>
            <View style={styles.previewFooterRow}>
              <View style={styles.previewMetaBlock}>
                <Text style={styles.previewMetaLabel}>Name</Text>
                <Text style={styles.previewMetaValue}>{cardholderName || 'Yessie'}</Text>
              </View>
              <View style={styles.previewMetaBlock}>
                <Text style={styles.previewMetaLabel}>Expires</Text>
                <Text style={styles.previewMetaValue}>{expiryDate || 'MM/YY'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Card Number</Text>
            <TextInput
              value={cardNumber}
              onChangeText={handleCardNumberChange}
              placeholder="1244 1234 1345 3255"
              maxLength={19}
              keyboardType="numeric"
              style={[styles.textInput, cardErrors.cardNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            {cardErrors.cardNumber && <Text style={styles.errorText}>{cardErrors.cardNumber}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Cardholder Name</Text>
            <TextInput
              value={cardholderName}
              onChangeText={(text) => {
                setCardholderName(text)
                if (cardErrors.cardholderName) setCardErrors(prev => ({ ...prev, cardholderName: '' }))
              }}
              placeholder="Yessie"
              style={[styles.textInput, cardErrors.cardholderName && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            {cardErrors.cardholderName && <Text style={styles.errorText}>{cardErrors.cardholderName}</Text>}
          </View>

          <View style={styles.inlineRow}>
            <View style={[styles.formFieldBlock, styles.inlineHalf]}>
              <Text style={styles.fieldLabel}>Expiry Date</Text>
              <TextInput
                value={expiryDate}
                onChangeText={handleExpiryDateChange}
                placeholder="MM/YY"
                maxLength={5}
                keyboardType="numeric"
                style={[styles.textInput, cardErrors.expiryDate && styles.textInputError]}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              {cardErrors.expiryDate && <Text style={styles.errorText}>{cardErrors.expiryDate}</Text>}
            </View>
            <View style={[styles.formFieldBlock, styles.inlineHalf]}>
              <Text style={styles.fieldLabel}>Security Code</Text>
              <TextInput
                value={securityCode}
                onChangeText={(text) => {
                  const cleaned = text.replace(/\D/g, '').slice(0, 4)
                  setSecurityCode(cleaned)
                  if (cardErrors.securityCode) setCardErrors(prev => ({ ...prev, securityCode: '' }))
                }}
                placeholder="•••"
                maxLength={4}
                secureTextEntry
                keyboardType="numeric"
                style={[styles.textInput, cardErrors.securityCode && styles.textInputError]}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              {cardErrors.securityCode && <Text style={styles.errorText}>{cardErrors.securityCode}</Text>}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!isFormValid || isLoading}
            style={[styles.primaryButton, (!isFormValid || isLoading) && styles.primaryButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Save card"
          >
            {isLoading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonText}>Adding Card...</Text>
              </>
            ) : (
              <Text style={styles.primaryButtonText}>Save Card</Text>
            )}
          </TouchableOpacity>
          {stripeError && (
            <View style={styles.inlineErrorBanner}>
              <Text style={styles.inlineErrorText}>{stripeError}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    )
  }

  // Non-embedded: render as overlay bottom sheet
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.overlayContainer}
    >
      <View style={styles.sheet}>
        {/* iOS-style nav bar */}
        <View style={styles.navBar}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close add card"
            onPress={onBack}
            style={styles.navButton}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Add Card</Text>
          <View style={styles.navButtonPlaceholder} />
        </View>

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.instructions}>Enter your card details. Data updates as you type.</Text>

          <View style={styles.previewCard}>
            <View style={styles.previewLogosRow}>
              <View style={styles.brandLogoPrimary} />
              <View style={styles.brandLogoSecondary} />
            </View>
            <Text style={styles.previewNumber}>{cardNumber || '1244 1234 1345 3255'}</Text>
            <View style={styles.previewFooterRow}>
              <View style={styles.previewMetaBlock}>
                <Text style={styles.previewMetaLabel}>Name</Text>
                <Text style={styles.previewMetaValue}>{cardholderName || 'Yessie'}</Text>
              </View>
              <View style={styles.previewMetaBlock}>
                <Text style={styles.previewMetaLabel}>Expires</Text>
                <Text style={styles.previewMetaValue}>{expiryDate || 'MM/YY'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Card Number</Text>
            <TextInput
              value={cardNumber}
              onChangeText={handleCardNumberChange}
              placeholder="1244 1234 1345 3255"
              maxLength={19}
              keyboardType="numeric"
              style={[styles.textInput, cardErrors.cardNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            {cardErrors.cardNumber && <Text style={styles.errorText}>{cardErrors.cardNumber}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Cardholder Name</Text>
            <TextInput
              value={cardholderName}
              onChangeText={(text) => {
                setCardholderName(text)
                if (cardErrors.cardholderName) setCardErrors(prev => ({ ...prev, cardholderName: '' }))
              }}
              placeholder="Yessie"
              style={[styles.textInput, cardErrors.cardholderName && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
            />
            {cardErrors.cardholderName && <Text style={styles.errorText}>{cardErrors.cardholderName}</Text>}
          </View>

          <View style={styles.inlineRow}>
            <View style={[styles.formFieldBlock, styles.inlineHalf]}>
              <Text style={styles.fieldLabel}>Expiry Date</Text>
              <TextInput
                value={expiryDate}
                onChangeText={handleExpiryDateChange}
                placeholder="MM/YY"
                maxLength={5}
                keyboardType="numeric"
                style={[styles.textInput, cardErrors.expiryDate && styles.textInputError]}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              {cardErrors.expiryDate && <Text style={styles.errorText}>{cardErrors.expiryDate}</Text>}
            </View>
            <View style={[styles.formFieldBlock, styles.inlineHalf]}>
              <Text style={styles.fieldLabel}>Security Code</Text>
              <TextInput
                value={securityCode}
                onChangeText={(text) => {
                  const cleaned = text.replace(/\D/g, '').slice(0, 4)
                  setSecurityCode(cleaned)
                  if (cardErrors.securityCode) setCardErrors(prev => ({ ...prev, securityCode: '' }))
                }}
                placeholder="•••"
                maxLength={4}
                secureTextEntry
                keyboardType="numeric"
                style={[styles.textInput, cardErrors.securityCode && styles.textInputError]}
                placeholderTextColor="rgba(255,255,255,0.35)"
              />
              {cardErrors.securityCode && <Text style={styles.errorText}>{cardErrors.securityCode}</Text>}
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!isFormValid || isLoading}
            style={[styles.primaryButton, (!isFormValid || isLoading) && styles.primaryButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Save card"
          >
            {isLoading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonText}>Adding Card...</Text>
              </>
            ) : (
              <Text style={styles.primaryButtonText}>Save Card</Text>
            )}
          </TouchableOpacity>
          {stripeError && (
            <View style={styles.inlineErrorBanner}>
              <Text style={styles.inlineErrorText}>{stripeError}</Text>
            </View>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  )
}

const embeddedStyles = StyleSheet.create({
  container: { paddingBottom: 24 },
  navBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 },
  backButton: { padding: 8, minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  title: { color: '#fff', fontSize: 18, fontWeight: '600', textAlign: 'center', flex: 1 },
})

const styles = StyleSheet.create({
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#008e2a',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingBottom: 12,
    maxHeight: '92%',
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 20 : 12,
    paddingBottom: 12,
  },
  navButton: {
    padding: 8,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonPlaceholder: { width: 44, height: 44 },
  navTitle: { color: '#fff', fontSize: 18, fontWeight: '600', letterSpacing: 0.5 },
  contentScroll: { flex: 1 },
  contentContainer: { paddingHorizontal: 20, paddingBottom: 40 },
  instructions: { color: '#d5ecdc', fontSize: 13, marginBottom: 16 },
  previewCard: {
    backgroundColor: '#007523',
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  previewLogosRow: { flexDirection: 'row', marginBottom: 12 },
  brandLogoPrimary: { height: 32, width: 32, borderRadius: 16, backgroundColor: '#ef4444' },
  brandLogoSecondary: { height: 32, width: 32, borderRadius: 16, backgroundColor: '#f59e0b', marginLeft: -10 },
  previewNumber: { color: '#fff', fontSize: 18, letterSpacing: 2, fontWeight: '600', marginBottom: 20 },
  previewFooterRow: { flexDirection: 'row', justifyContent: 'space-between' },
  previewMetaBlock: {},
  previewMetaLabel: { color: '#80c795', fontSize: 11, marginBottom: 4 },
  previewMetaValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  formFieldBlock: { marginBottom: 18 },
  fieldLabel: { color: '#d5ecdc', fontSize: 13, marginBottom: 6, fontWeight: '500' },
  textInput: {
    backgroundColor: 'rgba(0,92,28,0.55)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 15,
  },
  textInputError: { borderWidth: 1, borderColor: '#f87171' },
  errorText: { color: '#fca5a5', fontSize: 11, marginTop: 6 },
  inlineRow: { flexDirection: 'row', gap: 16 },
  inlineHalf: { flex: 1 },
  primaryButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#005c1c',
    borderRadius: 28,
    paddingVertical: 14,
    marginTop: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  inlineErrorBanner: { marginTop: 10, padding: 10, backgroundColor: '#fee2e2', borderRadius: 10 },
  inlineErrorText: { color: '#b91c1c', textAlign: 'center', fontSize: 13 },
});
