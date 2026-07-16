"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { useMemo, useState } from "react"
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { buildDepositSuccessMessage, useWalletDeposit } from '../hooks/use-wallet-deposit'
import { SIZING, SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { hapticFeedback } from '../lib/haptic-feedback'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { getUserFriendlyError } from '../lib/utils/error-messages'
import { ErrorBanner } from './error-banner'
import { FeedbackModal } from './ui/feedback-modal'
import { PaymentMethodsModal } from './payment-methods-modal'

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
  /** Pre-fills the amount field (e.g. to match a bounty price the caller wants funded). */
  initialAmount?: string
}

// Text color used on top of the bright brand-green primary CTA, matching the
// dark-on-green convention used across onboarding/wallet (see e.g.
// lib/onboarding/onboarding-details-styles.ts nextButtonText).
const ON_PRIMARY_TEXT = '#052e1b'

const KEYPAD_ROWS: number[][] = [[1, 2, 3], [4, 5, 6], [7, 8, 9]]

export function AddMoneyScreen({ onBack, onAddMoney, initialAmount }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>(initialAmount || "0")
  const {
    isProcessing,
    isApplePayAvailable,
    error, setError,
    successInfo, setSuccessInfo,
    showPaymentMethodsModal, setShowPaymentMethodsModal,
    paymentMethods, stripeLoading, stripeError, loadPaymentMethods,
    payWithCard, payWithApplePay,
  } = useWalletDeposit()
  const { theme } = useAppThemeContext()
  const insets = useSafeAreaInsets()
  const styles = useMemo(() => makeStyles(theme), [theme])

  const handleNumberPress = (num: number) => {
    hapticFeedback.selection()
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
    hapticFeedback.selection()
    if (!amount.includes(".")) {
      setAmount(amount + ".")
    }
  }

  const handleDeletePress = () => {
    hapticFeedback.selection()
    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount("0")
    }
  }

  const numericAmount = Number.parseFloat(amount)

  const handleCardPayment = async () => {
    hapticFeedback.light()
    await payWithCard(numericAmount)
  }

  const handleApplePayPress = async () => {
    hapticFeedback.light()
    await payWithApplePay(numericAmount)
  }

  const hasPaymentMethod = paymentMethods.length > 0
  // "Visually enabled" mirrors the tap-disabled condition below so the CTA's
  // color communicates whether tapping it will do something right now.
  const primaryVisuallyEnabled = (numericAmount > 0 || !hasPaymentMethod) && !isProcessing && !stripeLoading
  const primaryDisabled = (numericAmount <= 0 && hasPaymentMethod) || isProcessing || stripeLoading

  // Apple's HIG calls for a black Apple Pay button on light backgrounds and a
  // white one on dark backgrounds, so the mark stays crisp in both themes.
  const applePayBg = theme.isDark ? '#ffffff' : '#000000'
  const applePayFg = theme.isDark ? '#000000' : '#ffffff'

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <MaterialIcons name="close" size={24} color={theme.text} />
        </TouchableOpacity>
        <BrandingLogo size="small" />
        <View style={styles.headerButton} />
      </View>

      {/* Amount + keypad. Scrolls instead of overlapping/clipping on short
          screens or with larger accessibility text sizes — the content
          below is fixed-size (64pt keys) and can't shrink to fit, so it must
          never be forced into a box smaller than its natural height. */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Amount Display */}
        <View style={styles.amountSection}>
          <Text style={styles.amountLabel}>ADD CASH</Text>
          <Text
            style={styles.amountText}
            accessibilityRole="text"
            accessibilityLabel={`Amount, $${amount}`}
          >
            ${amount}
          </Text>
        </View>

        {/* Error Display */}
        {(error || stripeError) && (
          <View style={styles.errorWrapper}>
            <ErrorBanner
              error={getUserFriendlyError(error || stripeError)}
              onDismiss={() => {
                setError(null)
                if (stripeError) loadPaymentMethods().catch(() => { })
              }}
              onAction={error?.type === 'payment' ? () => payWithCard(numericAmount) : (stripeError ? () => loadPaymentMethods() : undefined)}
            />
          </View>
        )}

        {/* Keypad */}
        <View style={styles.keypadSection}>
          {KEYPAD_ROWS.map((row, idx) => (
            <View key={idx} style={styles.keypadRow}>
              {row.map((num) => (
                <TouchableOpacity
                  key={num}
                  style={styles.keypadKey}
                  onPress={() => handleNumberPress(num)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Enter ${num}`}
                >
                  <Text style={styles.keypadKeyText}>{num}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
          <View style={styles.keypadRow}>
            <TouchableOpacity
              style={styles.keypadKey}
              onPress={handleDecimalPress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Enter decimal point"
            >
              <Text style={styles.keypadKeyText}>.</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.keypadKey}
              onPress={() => handleNumberPress(0)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Enter 0"
            >
              <Text style={styles.keypadKeyText}>0</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.keypadKey}
              onPress={handleDeletePress}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Delete last digit"
            >
              <MaterialIcons name="backspace" size={24} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Actions */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
        {/* Apple Pay button (iOS only).
            Always rendered on iOS — even when no card is provisioned in the
            Wallet app — so the Apple Pay integration is discoverable (the tap
            handler re-checks availability and guides the user to set it up).
            This keeps the integration locatable for App Store review per
            Guideline 2.1. */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.applePayButton, { backgroundColor: applePayBg }]}
            onPress={handleApplePayPress}
            disabled={numericAmount <= 0 || isProcessing}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Pay with Apple Pay"
            accessibilityState={{ disabled: numericAmount <= 0 || isProcessing, busy: isProcessing }}
          >
            {isProcessing ? (
              <>
                <ActivityIndicator size="small" color={applePayFg} style={styles.buttonSpinner} />
                <Text style={[styles.applePayButtonText, { color: applePayFg }]}>Processing...</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="apple" size={22} color={applePayFg} />
                <Text style={[styles.applePayButtonText, { color: applePayFg, marginLeft: 6 }]}>Pay</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Primary CTA: "Add Money" once a payment method exists, or
            "Link Payment Method" to set one up first. */}
        <TouchableOpacity
          style={[
            styles.primaryButton,
            !primaryVisuallyEnabled && styles.primaryButtonMuted,
          ]}
          disabled={primaryDisabled}
          onPress={!hasPaymentMethod ? () => setShowPaymentMethodsModal(true) : handleCardPayment}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={!hasPaymentMethod ? 'Link a payment method' : 'Add money to wallet'}
          accessibilityState={{ disabled: primaryDisabled, busy: isProcessing || stripeLoading }}
        >
          {isProcessing || stripeLoading ? (
            <>
              <ActivityIndicator size="small" color={ON_PRIMARY_TEXT} style={styles.buttonSpinner} />
              <Text style={styles.primaryButtonText}>
                {stripeLoading ? "Checking Methods..." : "Processing..."}
              </Text>
            </>
          ) : (
            <Text style={styles.primaryButtonText}>
              {!hasPaymentMethod ? "Link Payment Method" : "Add Money"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Hint for new users */}
        {!hasPaymentMethod && !stripeLoading && !stripeError && (
          <Text style={styles.hintText}>
            Link a credit card or bank account to add funds to your wallet.
          </Text>
        )}
      </View>

      {/* Payment Methods Modal */}
      {showPaymentMethodsModal && (
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => {
            setShowPaymentMethodsModal(false)
            // Refresh payment methods after closing
            loadPaymentMethods()
          }}
          onBackdropPress={() => {
            // If user taps the shaded area, close modal and return to wallet screen
            setShowPaymentMethodsModal(false)
            loadPaymentMethods()
            onBack?.()
          }}
        />
      )}

      {/* Success confirmation — blocks like the Alert.alert it replaced;
          onAddMoney/onBack only fire once the user acknowledges. */}
      <FeedbackModal
        visible={!!successInfo}
        variant="success"
        title="Success!"
        message={successInfo ? buildDepositSuccessMessage(successInfo) : ''}
        actionLabel="OK"
        onDismiss={() => {
          const info = successInfo
          setSuccessInfo(null)
          if (info) {
            onAddMoney?.(info.amount)
            onBack?.()
          }
        }}
      />
    </View>
  )
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingBottom: SPACING.COMPACT_GAP,
    },
    headerButton: {
      width: SIZING.MIN_TOUCH_TARGET,
      height: SIZING.MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingBottom: SPACING.COMPACT_GAP,
    },
    amountSection: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: SPACING.ELEMENT_GAP,
      gap: SPACING.COMPACT_GAP,
    },
    amountLabel: {
      color: theme.primaryLight,
      fontSize: TYPOGRAPHY.SIZE_SMALL,
      fontWeight: 'bold',
      letterSpacing: TYPOGRAPHY.LETTER_SPACING_WIDER,
      textTransform: 'uppercase',
    },
    amountText: {
      color: theme.text,
      fontSize: 56,
      fontWeight: '800',
    },
    errorWrapper: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    // Note: no flex:1 / justifyContent:'center' here — this section's content
    // (four rows of fixed 64pt keys) can't shrink to fit a squeezed box, and a
    // shrunk flex box with overflow:'visible' (RN's default) lets fixed-size
    // children spill into neighboring sections instead of resizing. Centering
    // is handled by the parent ScrollView's contentContainerStyle instead,
    // which centers when there's extra room and scrolls when there isn't.
    keypadSection: {
      paddingHorizontal: 32,
      paddingVertical: SPACING.SECTION_GAP,
      gap: 12,
    },
    keypadRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    keypadKey: {
      width: 64,
      height: 64,
      borderRadius: 32,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceSecondary,
    },
    keypadKeyText: {
      color: theme.text,
      fontSize: 24,
      fontWeight: '600',
    },
    actions: {
      paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
      paddingTop: SPACING.COMPACT_GAP,
    },
    applePayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: SIZING.BUTTON_HEIGHT_LARGE,
      borderRadius: 999,
      marginBottom: SPACING.ELEMENT_GAP,
    },
    applePayButtonText: {
      fontSize: TYPOGRAPHY.SIZE_BODY,
      fontWeight: '600',
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: SIZING.BUTTON_HEIGHT_LARGE,
      borderRadius: 999,
      backgroundColor: theme.primary,
    },
    primaryButtonMuted: {
      opacity: 0.45,
    },
    primaryButtonText: {
      color: ON_PRIMARY_TEXT,
      fontSize: TYPOGRAPHY.SIZE_BODY,
      fontWeight: 'bold',
    },
    buttonSpinner: {
      marginRight: 8,
    },
    hintText: {
      color: theme.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      textAlign: 'center',
      marginTop: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.SECTION_GAP,
    },
  })
}
