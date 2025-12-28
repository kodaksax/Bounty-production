"use client"

import { MaterialIcons } from "@expo/vector-icons"
import type React from "react"
import { useEffect, useState } from "react"
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { API_BASE_URL } from "../lib/config/api"
import { stripeService } from "../lib/services/stripe-service"
import { useStripe } from "../lib/stripe-context"
import PaymentElementWrapper from "./payment-element-wrapper"

interface AddCardModalProps {
  onBack: () => void
  onSave?: (cardData: CardData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet)
   * This is used when the AddCardModal is shown inside another modal
   * (e.g. PaymentMethodsModal). Default: false
   */
  embedded?: boolean
  /**
   * When usePaymentElement is true, uses Stripe's Payment Element
   * for better PCI compliance. Requires native SDK support.
   * Default: false (falls back to manual card input)
   */
  usePaymentElement?: boolean
}

interface CardData {
  cardNumber: string
  cardholderName: string
  expiryDate: string
  securityCode: string
}

export function AddCardModal({ onBack, onSave, embedded = false, usePaymentElement = false }: AddCardModalProps) {
  const [cardNumber, setCardNumber] = useState("")
  const [cardholderName, setCardholderName] = useState("")
  const [expiryDate, setExpiryDate] = useState("")
  const [securityCode, setSecurityCode] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [cardErrors, setCardErrors] = useState<{[key: string]: string}>({})
  const [setupIntentSecret, setSetupIntentSecret] = useState<string | null>(null)
  const [isCreatingSetupIntent, setIsCreatingSetupIntent] = useState(false)
  const [isSDKAvailable, setIsSDKAvailable] = useState<boolean>(false)
  const [paymentElementFailed, setPaymentElementFailed] = useState<boolean>(false)
  
  const { createPaymentMethod, loadPaymentMethods, error: stripeError } = useStripe()
  const { session } = useAuthContext()

  // Refresh payment methods with retry logic
  // Let Stripe SDK and network stack handle timeouts naturally
  const refreshPaymentMethodsWithRetry = async (maxRetries = 2): Promise<void> => {
    let lastErr: any
    // maxRetries includes the initial attempt (e.g., maxRetries=2 means 1 initial + 2 retries = 3 total attempts)
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await loadPaymentMethods()
        return
      } catch (e) {
        lastErr = e
        // brief backoff
        await new Promise(r => setTimeout(r, 600))
      }
    }
    // Swallow final error but log for diagnostics
    console.warn('[AddCardModal] loadPaymentMethods retry failed:', lastErr)
  }

  // Determine if native Stripe SDK is available; prefer Payment Element when available
  useEffect(() => {
    let mounted = true
    const init = async () => {
      try {
        await stripeService.initialize()
        if (mounted) setIsSDKAvailable(stripeService.isSDKAvailable())
      } catch (e) {
        if (mounted) setIsSDKAvailable(false)
      }
    }
    init()
    return () => { mounted = false }
  }, [])

  const shouldUsePaymentElement = usePaymentElement || isSDKAvailable

  // Create SetupIntent for Payment Element mode
  useEffect(() => {
    if (shouldUsePaymentElement && !paymentElementFailed && !setupIntentSecret) {
      createSetupIntent()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldUsePaymentElement, paymentElementFailed])

  // Helper to timeout fetch
  const fetchWithTimeout = async (resource: RequestInfo | URL, options: RequestInit = {}, timeoutMs = 10000) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(resource, { ...options, signal: controller.signal })
      return response
    } finally {
      clearTimeout(id)
    }
  }

  const createSetupIntent = async () => {
    if (!session?.access_token) {
      Alert.alert('Error', 'Please sign in to add a payment method')
      return
    }

    setIsCreatingSetupIntent(true)
    try {
      let response: Response | null = null
      let lastErr: any
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          response = await fetchWithTimeout(`${API_BASE_URL}/payments/create-setup-intent`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              usage: 'off_session',
            }),
          }, 10000)
          if (response.ok) break
          lastErr = new Error(`HTTP ${response.status}`)
        } catch (e) {
          lastErr = e
        }
        await new Promise(r => setTimeout(r, 700))
      }
      if (!response || !response.ok) {
        throw lastErr || new Error('Failed to initialize payment setup')
      }
      const { clientSecret } = await response.json()
      setSetupIntentSecret(clientSecret)
    } catch (error) {
      console.error('[AddCardModal] SetupIntent creation error:', error)
      Alert.alert('Error', 'Failed to initialize payment setup. Please try again.')
      // Fallback to manual form if setup creation fails
      setPaymentElementFailed(true)
    } finally {
      setIsCreatingSetupIntent(false)
    }
  }

  const handlePaymentElementSuccess = async () => {
    // Refresh payment methods after successful save
    await refreshPaymentMethodsWithRetry(2, 3000)
    
    Alert.alert('Success', 'Payment method added successfully!', [
      { text: 'OK', onPress: onBack }
    ])
  }

  const handlePaymentElementError = (error: any) => {
    if (error.type === 'canceled') {
      // User cancelled, just go back
      return
    }
    Alert.alert('Error', error.message || 'Failed to add payment method')
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
      setCardErrors(prev => {
        const { cardNumber, ...rest } = prev
        return rest
      })
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
        setCardErrors(prev => {
          const { expiryDate, ...rest } = prev
          return rest
        })
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

  // Render Payment Element mode
  if (shouldUsePaymentElement && !paymentElementFailed) {
    if (isCreatingSetupIntent || !setupIntentSecret) {
      return (
        <View style={embedded ? embeddedStyles.container : styles.overlayContainer}>
          {embedded ? (
            <View style={embeddedStyles.navBar}>
              <TouchableOpacity onPress={onBack} style={embeddedStyles.backButton} accessibilityRole="button" accessibilityLabel="Back">
                <MaterialIcons name="arrow-back" size={22} color="#fff" />
              </TouchableOpacity>
              <Text style={embeddedStyles.title}>Add Card</Text>
              <View style={{ width: 44 }} />
            </View>
          ) : (
            <View style={styles.sheet}>
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
            </View>
          )}
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
            <ActivityIndicator size="large" color="#ffffff" />
            <Text style={{ color: '#ffffff', marginTop: 16, fontSize: 16 }}>
              Preparing secure payment form...
            </Text>
          </View>
        </View>
      )
    }

    // Render with PaymentElementWrapper
    const paymentElementContent = (
      <PaymentElementWrapper
        clientSecret={setupIntentSecret}
        mode="setup"
        onSuccess={handlePaymentElementSuccess}
        onError={handlePaymentElementError}
        onCancel={onBack}
        showApplePay={true}
        showGooglePay={true}
        buttonText="Save Card"
        merchantDisplayName="BountyExpo"
      />
    )

    if (embedded) {
      return (
        <View style={embeddedStyles.container}>
          <View style={embeddedStyles.navBar}>
            <TouchableOpacity onPress={onBack} style={embeddedStyles.backButton} accessibilityRole="button" accessibilityLabel="Back">
              <MaterialIcons name="arrow-back" size={22} color="#fff" />
            </TouchableOpacity>
            <Text style={embeddedStyles.title}>Add Card</Text>
            <View style={{ width: 44 }} />
          </View>
          <View style={{ backgroundColor: '#ffffff', margin: 16, borderRadius: 16, overflow: 'hidden' }}>
            {paymentElementContent}
          </View>
        </View>
      )
    }

    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlayContainer}
      >
        <View style={styles.sheet}>
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
          <View style={{ backgroundColor: '#ffffff', margin: 16, borderRadius: 16, overflow: 'hidden' }}>
            {paymentElementContent}
          </View>
        </View>
      </KeyboardAvoidingView>
    )
  }

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
                if (cardErrors.cardholderName) setCardErrors(prev => {
                  const { cardholderName, ...rest } = prev
                  return rest
                })
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
                  if (cardErrors.securityCode) setCardErrors(prev => {
                    const { securityCode, ...rest } = prev
                    return rest
                  })
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
                if (cardErrors.cardholderName) setCardErrors(prev => {
                  const { cardholderName, ...rest } = prev
                  return rest
                })
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
                  if (cardErrors.securityCode) setCardErrors(prev => {
                    const { securityCode, ...rest } = prev
                    return rest
                  })
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
    backgroundColor: '#059669',
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
  instructions: { color: '#d1fae5', fontSize: 13, marginBottom: 16 },
  previewCard: {
    backgroundColor: '#047857',
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
  previewMetaLabel: { color: '#6ee7b7', fontSize: 11, marginBottom: 4 },
  previewMetaValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  formFieldBlock: { marginBottom: 18 },
  fieldLabel: { color: '#d1fae5', fontSize: 13, marginBottom: 6, fontWeight: '500' },
  textInput: {
    backgroundColor: 'rgba(4,120,87,0.55)',
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
    backgroundColor: '#065f46',
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
