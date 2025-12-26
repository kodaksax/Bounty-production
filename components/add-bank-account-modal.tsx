"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useState } from "react"
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { API_BASE_URL } from "../lib/config/api"

interface AddBankAccountModalProps {
  onBack: () => void
  onSave?: (bankData: BankAccountData) => void
  /**
   * When embedded is true the component renders inline (no backdrop/sheet)
   * This is used when the AddBankAccountModal is shown inside another modal
   * (e.g. PaymentMethodsModal). Default: false
   */
  embedded?: boolean
}

export interface BankAccountData {
  accountHolderName: string
  accountNumber: string
  routingNumber: string
  accountType: 'checking' | 'savings'
}

export function AddBankAccountModal({ onBack, onSave, embedded = false }: AddBankAccountModalProps) {
  const [accountHolderName, setAccountHolderName] = useState("")
  const [routingNumber, setRoutingNumber] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [accountNumberConfirm, setAccountNumberConfirm] = useState("")
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking')
  const [isLoading, setIsLoading] = useState(false)
  const [errors, setErrors] = useState<{[key: string]: string}>({})
  const { session } = useAuthContext()

  const validateRoutingNumber = (value: string): boolean => {
    // US routing numbers are 9 digits
    if (value.length !== 9) return false
    
    // ABA routing number checksum validation
    const digits = value.split('').map(Number)
    const checksum = (
      3 * (digits[0] + digits[3] + digits[6]) +
      7 * (digits[1] + digits[4] + digits[7]) +
      (digits[2] + digits[5] + digits[8])
    ) % 10
    
    return checksum === 0
  }

  const handleRoutingNumberChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 9)
    setRoutingNumber(digitsOnly)
    
    if (errors.routingNumber) {
      setErrors(prev => {
        const { routingNumber, ...rest } = prev
        return rest
      })
    }
    
    if (digitsOnly.length === 9 && !validateRoutingNumber(digitsOnly)) {
      setErrors(prev => ({ ...prev, routingNumber: 'Invalid routing number' }))
    }
  }

  const handleAccountNumberChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 17) // Max 17 digits for US accounts
    setAccountNumber(digitsOnly)
    
    if (errors.accountNumber) {
      setErrors(prev => {
        const { accountNumber, ...rest } = prev
        return rest
      })
    }
  }

  const handleAccountNumberConfirmChange = (value: string) => {
    const digitsOnly = value.replace(/\D/g, "").slice(0, 17)
    setAccountNumberConfirm(digitsOnly)
    
    if (errors.accountNumberConfirm) {
      setErrors(prev => {
        const { accountNumberConfirm, ...rest } = prev
        return rest
      })
    }
    
    if (digitsOnly.length > 0 && accountNumber !== digitsOnly) {
      setErrors(prev => ({ ...prev, accountNumberConfirm: 'Account numbers do not match' }))
    }
  }

  const handleSave = async () => {
    setIsLoading(true)
    setErrors({})
    
    try {
      // Validate all fields
      const validationErrors: {[key: string]: string} = {}
      
      if (!accountHolderName.trim()) {
        validationErrors.accountHolderName = 'Please enter the account holder name'
      }
      
      if (!routingNumber || routingNumber.length !== 9) {
        validationErrors.routingNumber = 'Please enter a valid 9-digit routing number'
      } else if (!validateRoutingNumber(routingNumber)) {
        validationErrors.routingNumber = 'Invalid routing number checksum'
      }
      
      if (!accountNumber || accountNumber.length < 4) {
        validationErrors.accountNumber = 'Please enter a valid account number'
      }
      
      if (accountNumber !== accountNumberConfirm) {
        validationErrors.accountNumberConfirm = 'Account numbers must match'
      }
      
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors)
        return
      }

      if (!session?.access_token) {
        throw new Error('Not authenticated. Please sign in again.')
      }

      // Create bank account token via backend
      const response = await fetch(`${API_BASE_URL}/payments/bank-accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          accountHolderName,
          routingNumber,
          accountNumber,
          accountType,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to add bank account')
      }

      // Parse response to get tokenized data
      const responseData = await response.json()

      // Call onSave callback with non-sensitive tokenized data only
      if (onSave) {
        onSave({
          accountHolderName,
          // Only pass non-sensitive fields - no raw account or routing numbers
          accountNumber: '', // Empty string for interface compatibility
          routingNumber: '', // Empty string for interface compatibility
          accountType,
        })
      }
      
      // Show success and close modal
      Alert.alert('Success', 'Bank account added successfully! Verification may take 1-2 business days.', [
        { text: 'OK', onPress: onBack }
      ])
      
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'Failed to add bank account')
    } finally {
      setIsLoading(false)
    }
  }

  const isFormValid = 
    accountHolderName.trim() !== "" && 
    routingNumber.length === 9 && 
    accountNumber.length >= 4 && 
    accountNumber === accountNumberConfirm &&
    Object.keys(errors).length === 0

  if (embedded) {
    // Render inline when embedded inside another modal
    return (
      <View style={embeddedStyles.container}>
        <View style={embeddedStyles.navBar}>
          <TouchableOpacity onPress={onBack} style={embeddedStyles.backButton} accessibilityRole="button" accessibilityLabel="Back">
            <MaterialIcons name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={embeddedStyles.title}>Add Bank Account</Text>
          <View style={{ width: 44 }} />
        </View>

        <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={20} color="#10b981" />
            <Text style={styles.infoText}>
              Bank accounts are verified via micro-deposits. This typically takes 1-2 business days.
            </Text>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Holder Name</Text>
            <TextInput
              value={accountHolderName}
              onChangeText={(text) => {
                setAccountHolderName(text)
                if (errors.accountHolderName) {
                  setErrors(prev => {
                    const { accountHolderName, ...rest } = prev
                    return rest
                  })
                }
              }}
              placeholder="John Doe"
              autoComplete="name"
              style={[styles.textInput, errors.accountHolderName && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Account holder name"
              accessibilityHint="Enter the name on your bank account"
            />
            {errors.accountHolderName && <Text style={styles.errorText}>{errors.accountHolderName}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Routing Number</Text>
            <TextInput
              value={routingNumber}
              onChangeText={handleRoutingNumberChange}
              placeholder="123456789"
              maxLength={9}
              keyboardType="numeric"
              autoComplete="off"
              style={[styles.textInput, errors.routingNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Routing number"
              accessibilityHint="Enter your 9-digit bank routing number"
            />
            {errors.routingNumber && <Text style={styles.errorText}>{errors.routingNumber}</Text>}
            <Text style={styles.helperText}>Found on your check or bank statement</Text>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Number</Text>
            <TextInput
              value={accountNumber}
              onChangeText={handleAccountNumberChange}
              placeholder="000123456789"
              maxLength={17}
              keyboardType="numeric"
              autoComplete="off"
              secureTextEntry
              style={[styles.textInput, errors.accountNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Account number"
              accessibilityHint="Enter your bank account number"
            />
            {errors.accountNumber && <Text style={styles.errorText}>{errors.accountNumber}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Confirm Account Number</Text>
            <TextInput
              value={accountNumberConfirm}
              onChangeText={handleAccountNumberConfirmChange}
              placeholder="000123456789"
              maxLength={17}
              keyboardType="numeric"
              autoComplete="off"
              secureTextEntry
              style={[styles.textInput, errors.accountNumberConfirm && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Confirm account number"
              accessibilityHint="Re-enter your bank account number to confirm"
            />
            {errors.accountNumberConfirm && <Text style={styles.errorText}>{errors.accountNumberConfirm}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Type</Text>
            <View style={styles.accountTypeContainer}>
              <TouchableOpacity
                style={[styles.accountTypeButton, accountType === 'checking' && styles.accountTypeButtonActive]}
                onPress={() => setAccountType('checking')}
                accessibilityRole="radio"
                accessibilityState={{ checked: accountType === 'checking' }}
                accessibilityLabel="Checking account"
              >
                <MaterialIcons 
                  name={accountType === 'checking' ? 'radio-button-checked' : 'radio-button-unchecked'} 
                  size={22} 
                  color="#fff" 
                />
                <Text style={styles.accountTypeText}>Checking</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.accountTypeButton, accountType === 'savings' && styles.accountTypeButtonActive]}
                onPress={() => setAccountType('savings')}
                accessibilityRole="radio"
                accessibilityState={{ checked: accountType === 'savings' }}
                accessibilityLabel="Savings account"
              >
                <MaterialIcons 
                  name={accountType === 'savings' ? 'radio-button-checked' : 'radio-button-unchecked'} 
                  size={22} 
                  color="#fff" 
                />
                <Text style={styles.accountTypeText}>Savings</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!isFormValid || isLoading}
            style={[styles.primaryButton, (!isFormValid || isLoading) && styles.primaryButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Add bank account"
            accessibilityState={{ disabled: !isFormValid || isLoading }}
          >
            {isLoading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonText}>Adding Account...</Text>
              </>
            ) : (
              <Text style={styles.primaryButtonText}>Add Bank Account</Text>
            )}
          </TouchableOpacity>

          <View style={styles.securityNotice}>
            <MaterialIcons name="lock" size={16} color="#6ee7b7" />
            <Text style={styles.securityText}>
              Your bank details are encrypted and securely transmitted to Stripe. We never store your full account number.
            </Text>
          </View>
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
            accessibilityLabel="Close add bank account"
            onPress={onBack}
            style={styles.navButton}
          >
            <MaterialIcons name="close" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.navTitle}>Add Bank Account</Text>
          <View style={styles.navButtonPlaceholder} />
        </View>

        <ScrollView
          style={styles.contentScroll}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.infoBox}>
            <MaterialIcons name="info-outline" size={20} color="#10b981" />
            <Text style={styles.infoText}>
              Bank accounts are verified via micro-deposits. This typically takes 1-2 business days.
            </Text>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Holder Name</Text>
            <TextInput
              value={accountHolderName}
              onChangeText={(text) => {
                setAccountHolderName(text)
                if (errors.accountHolderName) {
                  setErrors(prev => {
                    const { accountHolderName, ...rest } = prev
                    return rest
                  })
                }
              }}
              placeholder="John Doe"
              autoComplete="name"
              style={[styles.textInput, errors.accountHolderName && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Account holder name"
              accessibilityHint="Enter the name on your bank account"
            />
            {errors.accountHolderName && <Text style={styles.errorText}>{errors.accountHolderName}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Routing Number</Text>
            <TextInput
              value={routingNumber}
              onChangeText={handleRoutingNumberChange}
              placeholder="123456789"
              maxLength={9}
              keyboardType="numeric"
              autoComplete="off"
              style={[styles.textInput, errors.routingNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Routing number"
              accessibilityHint="Enter your 9-digit bank routing number"
            />
            {errors.routingNumber && <Text style={styles.errorText}>{errors.routingNumber}</Text>}
            <Text style={styles.helperText}>Found on your check or bank statement</Text>
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Number</Text>
            <TextInput
              value={accountNumber}
              onChangeText={handleAccountNumberChange}
              placeholder="000123456789"
              maxLength={17}
              keyboardType="numeric"
              autoComplete="off"
              secureTextEntry
              style={[styles.textInput, errors.accountNumber && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Account number"
              accessibilityHint="Enter your bank account number"
            />
            {errors.accountNumber && <Text style={styles.errorText}>{errors.accountNumber}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Confirm Account Number</Text>
            <TextInput
              value={accountNumberConfirm}
              onChangeText={handleAccountNumberConfirmChange}
              placeholder="000123456789"
              maxLength={17}
              keyboardType="numeric"
              autoComplete="off"
              secureTextEntry
              style={[styles.textInput, errors.accountNumberConfirm && styles.textInputError]}
              placeholderTextColor="rgba(255,255,255,0.35)"
              accessibilityLabel="Confirm account number"
              accessibilityHint="Re-enter your bank account number to confirm"
            />
            {errors.accountNumberConfirm && <Text style={styles.errorText}>{errors.accountNumberConfirm}</Text>}
          </View>

          <View style={styles.formFieldBlock}>
            <Text style={styles.fieldLabel}>Account Type</Text>
            <View style={styles.accountTypeContainer}>
              <TouchableOpacity
                style={[styles.accountTypeButton, accountType === 'checking' && styles.accountTypeButtonActive]}
                onPress={() => setAccountType('checking')}
                accessibilityRole="radio"
                accessibilityState={{ checked: accountType === 'checking' }}
                accessibilityLabel="Checking account"
              >
                <MaterialIcons 
                  name={accountType === 'checking' ? 'radio-button-checked' : 'radio-button-unchecked'} 
                  size={22} 
                  color="#fff" 
                />
                <Text style={styles.accountTypeText}>Checking</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[styles.accountTypeButton, accountType === 'savings' && styles.accountTypeButtonActive]}
                onPress={() => setAccountType('savings')}
                accessibilityRole="radio"
                accessibilityState={{ checked: accountType === 'savings' }}
                accessibilityLabel="Savings account"
              >
                <MaterialIcons 
                  name={accountType === 'savings' ? 'radio-button-checked' : 'radio-button-unchecked'} 
                  size={22} 
                  color="#fff" 
                />
                <Text style={styles.accountTypeText}>Savings</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            onPress={handleSave}
            disabled={!isFormValid || isLoading}
            style={[styles.primaryButton, (!isFormValid || isLoading) && styles.primaryButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Add bank account"
            accessibilityState={{ disabled: !isFormValid || isLoading }}
          >
            {isLoading ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={styles.primaryButtonText}>Adding Account...</Text>
              </>
            ) : (
              <Text style={styles.primaryButtonText}>Add Bank Account</Text>
            )}
          </TouchableOpacity>

          <View style={styles.securityNotice}>
            <MaterialIcons name="lock" size={16} color="#6ee7b7" />
            <Text style={styles.securityText}>
              Your bank details are encrypted and securely transmitted to Stripe. We never store your full account number.
            </Text>
          </View>
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
  infoBox: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16,185,129,0.2)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  infoText: {
    flex: 1,
    color: '#d1fae5',
    fontSize: 13,
    lineHeight: 18,
    marginLeft: 8,
  },
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
  helperText: { color: '#6ee7b7', fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  accountTypeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  accountTypeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,120,87,0.55)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  accountTypeButtonActive: {
    backgroundColor: '#047857',
    borderWidth: 2,
    borderColor: '#10b981',
  },
  accountTypeText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
    marginLeft: 8,
  },
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
  securityNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    paddingHorizontal: 8,
  },
  securityText: {
    flex: 1,
    color: '#6ee7b7',
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 8,
  },
});
