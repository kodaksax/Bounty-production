"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { BrandingLogo } from "components/ui/branding-logo"
import { formatCurrency } from "lib/utils"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, Alert, LayoutChangeEvent, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuthContext } from '../hooks/use-auth-context'
import { config } from '../lib/config'
import { API_BASE_URL } from '../lib/config/api'
import { BOTTOM_NAV_BASE_OFFSET } from '../lib/constants/navigation'
import { applePayService } from '../lib/services/apple-pay-service'
import { useStripe } from '../lib/stripe-context'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { getPaymentErrorMessage, getUserFriendlyError } from '../lib/utils/error-messages'
import { useWallet } from '../lib/wallet-context'
import { ErrorBanner } from './error-banner'
import { PaymentMethodsModal } from './payment-methods-modal'

interface AddMoneyScreenProps {
  onBack?: () => void
  onAddMoney?: (amount: number) => void
}

// Helper to persist a deposit to the server. Extracted to avoid duplicated logic.
// Retries up to 3 times with exponential back-off so transient network blips
// don't silently drop the server-side balance update.
async function persistDeposit(paymentIntentId: string | undefined, amount: number, accessToken?: string, source?: string): Promise<boolean> {
  if (!paymentIntentId || !accessToken) return false
  const MAX_RETRIES = 3
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/wallet/deposit`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
        },
        body: JSON.stringify({ amount, paymentIntentId }),
      })

      if (res.ok) {
        return true
      }

      let bodyText = ''
      try {
        const contentType = res.headers.get('content-type') || ''
        if (contentType.includes('application/json')) {
          const data = await res.json()
          bodyText = JSON.stringify(data)
        } else {
          bodyText = await res.text()
        }
      } catch (e) {
        bodyText = '<unable to read response body>'
      }
      console.warn(`[AddMoney] Persist ${source ? `${source} ` : ''}deposit attempt ${attempt}/${MAX_RETRIES} responded with ${res.status} ${res.statusText}:`, bodyText)

      // Don't retry on 4xx client errors (except 408/429) — they won't succeed
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return false
      }
    } catch (e) {
      console.warn(`[AddMoney] Persist ${source ? `${source} ` : ''}deposit attempt ${attempt}/${MAX_RETRIES} failed:`, e)
    }
    // Exponential back-off: 1s, 2s, 4s
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
  return false
}

// Computes the keypad digit-button diameter and inter-button gap that
// exactly fill the *measured* keypad area (4 rows x 3 columns), capped at
// the app's normal digit size (so tall screens don't get oversized keys)
// and floored at Apple's 44pt minimum touch target (so keys never become
// too small to tap). Driving this from the container's actual on-screen
// size — rather than a device-height breakpoint — is what lets the keypad
// fill exactly whatever space is left after the header/amount/chips/footer
// lay out, with no scrolling and no clipping on any device.
const PREFERRED_KEY_SIZE = 68
const PREFERRED_KEY_GAP = 16
const MIN_KEY_SIZE = 44
const MIN_KEY_GAP = 6

function computeKeypadFit(width: number, height: number): { keySize: number; keyGap: number } {
  if (width <= 0 || height <= 0) {
    return { keySize: PREFERRED_KEY_SIZE, keyGap: PREFERRED_KEY_GAP }
  }

  let keyGap = PREFERRED_KEY_GAP
  let keyFromHeight = (height - keyGap * 3) / 4
  if (keyFromHeight < MIN_KEY_SIZE) {
    keyGap = MIN_KEY_GAP
    keyFromHeight = (height - keyGap * 3) / 4
  }

  const keyFromWidth = (width - keyGap * 2) / 3
  const keySize = Math.max(MIN_KEY_SIZE, Math.min(PREFERRED_KEY_SIZE, keyFromHeight, keyFromWidth))

  return { keySize, keyGap }
}

export function AddMoneyScreen({ onBack, onAddMoney }: AddMoneyScreenProps) {
  const [amount, setAmount] = useState<string>("0")
  const [isProcessing, setIsProcessing] = useState(false)
  const [showPaymentMethodsModal, setShowPaymentMethodsModal] = useState(false)
  const [isApplePayAvailable, setIsApplePayAvailable] = useState(false)
  const [error, setError] = useState<any>(null)
  const { deposit, refreshFromApi, balance } = useWallet()
  const { processPaymentSecure, paymentMethods, isLoading: stripeLoading, error: stripeError, loadPaymentMethods } = useStripe()
  const { session } = useAuthContext()
  const { theme } = useAppThemeContext()
  const insets = useSafeAreaInsets()
  const s = useMemo(() => makeStyles(theme), [theme])

  // The keypad is the only flexible region of the layout — header, amount,
  // chips, and footer keep their normal designed size, and the keypad's key
  // size/gap are solved from its *measured* on-screen box (set below via
  // onLayout) so it exactly fills whatever space is actually left, with no
  // scrolling. Starts at the preferred size so the first paint (before the
  // first layout pass reports real measurements) already looks right on
  // typical screens.
  const [keypadBox, setKeypadBox] = useState({ width: 0, height: 0 })
  const { keySize, keyGap } = useMemo(() => computeKeypadFit(keypadBox.width, keypadBox.height), [keypadBox])
  const handleKeypadLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout
    setKeypadBox(prev => (prev.width === width && prev.height === height ? prev : { width, height }))
  }

  const selectedPaymentMethod = paymentMethods[0]
  const selectedPaymentMethodLabel = selectedPaymentMethod
    ? `${selectedPaymentMethod.card.brand.toUpperCase()} •••• ${selectedPaymentMethod.card.last4}`
    : null

  const handleNumberPress = (num: number) => {
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
    if (!amount.includes(".")) {
      setAmount(amount + ".")
    }
  }

  const handleDeletePress = () => {
    if (amount.length > 1) {
      setAmount(amount.slice(0, -1))
    } else {
      setAmount("0")
    }
  }

  const handleAddMoney = async () => {
    const numAmount = Number.parseFloat(amount)
    if (!isNaN(numAmount) && numAmount > 0) {

      // Check if we have payment methods
      if (paymentMethods.length === 0) {
        Alert.alert(
          'No Payment Method',
          'You need to add a payment method before you can add money to your wallet. Choose from cards or bank accounts.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add Payment Method',
              onPress: () => setShowPaymentMethodsModal(true)
            }
          ]
        )
        return
      }

      setIsProcessing(true)
      setError(null)

      try {
        // Verify auth before proceeding
        if (!session?.access_token) {
          throw new Error('Not authenticated. Please sign in again.')
        }

        // processPaymentSecure handles idempotent payment intent creation and confirmation
        const result = await processPaymentSecure(numAmount, {
          userId: session?.user?.id,
          purpose: 'wallet_deposit',
          paymentMethodId: paymentMethods[0]?.id,
        })

        if (result.success) {
          // Optimistically update local wallet balance
          await deposit(numAmount, {
            method: 'Credit Card',
            title: 'Added Money via Stripe',
            status: 'completed'
          })

          // Persist the deposit to the DB immediately (don't wait for the webhook).
          // apply_deposit is idempotent on paymentIntentId, so a later webhook
          // delivery is a safe no-op. This ensures profiles.balance is durable
          // and survives sign-out / cold restart.
          const persisted = await persistDeposit(result.paymentIntentId, numAmount, session?.access_token, 'Stripe')

          // Sync balance from server so Supabase is the source of truth
          try {
            if (session?.access_token) {
              await refreshFromApi(session.access_token)
            }
          } catch (syncErr) {
            // Non-critical: local state already updated above
            console.warn('[AddMoney] Failed to sync balance from server after deposit:', syncErr)
          }

          // Show success message (warn if server persistence failed)
          const successMsg = persisted
            ? `${formatCurrency(numAmount)} has been added to your wallet.`
            : `${formatCurrency(numAmount)} has been added to your wallet.\n\nNote: There was a temporary issue syncing with the server. Your balance will update automatically shortly.`
          Alert.alert(
            'Success!',
            successMsg,
            [{
              text: 'OK',
              onPress: () => {
                onAddMoney?.(numAmount)
                onBack?.()
              }
            }]
          )
        } else {
          // Get user-friendly payment error message
          const errorMsg = getPaymentErrorMessage(result.error)
          setError({ message: errorMsg, type: 'payment' })
        }
      } catch (err: any) {
        console.error('Payment error:', err)
        setError(err)
      } finally {
        setIsProcessing(false)
      }
    } else {
      Alert.alert(
        'Invalid Amount',
        'Please enter a valid amount greater than $0.',
        [{ text: 'OK' }]
      )
    }
  }

  // Check Apple Pay availability on mount
  useEffect(() => {
    let mounted = true
      ; (async () => {
        try {
          const available = await applePayService.isAvailable()
          if (mounted) setIsApplePayAvailable(available)
        } catch (e) {
          // ignore
        }
      })()
    return () => { mounted = false }
  }, [])

  const handleApplePayPress = async () => {
    const numAmount = Number.parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount')
      return
    }

    if (numAmount < 0.5) {
      Alert.alert('Minimum Amount', 'Amount must be at least $0.50')
      return
    }

    // Apple Pay may not be set up on this device (no card provisioned in the
    // Wallet app). Re-check availability on tap so the button stays discoverable
    // — this is also what App Review needs to locate the integration — and guide
    // the user to set it up instead of silently failing.
    let available = isApplePayAvailable
    if (!available) {
      available = await applePayService.isAvailable()
      setIsApplePayAvailable(available)
    }
    if (!available) {
      Alert.alert(
        'Apple Pay Not Set Up',
        'Apple Pay isn’t set up on this device. Open the Wallet app and add a card to pay with Apple Pay, or use a linked card or bank account below.',
        [{ text: 'OK' }]
      )
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      const result = await applePayService.processPayment({
        amount: numAmount,
        description: 'Add Money to Wallet',
      }, session?.access_token)

      if (result.success) {
        await deposit(numAmount, {
          method: 'Apple Pay',
          title: 'Added Money via Apple Pay',
          status: 'completed',
        })

        // Persist the deposit to the DB immediately (don't wait for the webhook).
        const persisted = await persistDeposit(result.paymentIntentId, numAmount, session?.access_token, 'Apple Pay')

        // Sync balance from server so Supabase is the source of truth
        try {
          if (session?.access_token) {
            await refreshFromApi(session.access_token)
          }
        } catch (syncErr) {
          // Non-critical: local state already updated above
          console.warn('[AddMoney] Failed to sync balance from server after Apple Pay deposit:', syncErr)
        }

        const applePayMsg = persisted
          ? `${formatCurrency(numAmount)} has been added to your wallet via Apple Pay.`
          : `${formatCurrency(numAmount)} has been added to your wallet via Apple Pay.\n\nNote: There was a temporary issue syncing with the server. Your balance will update automatically shortly.`
        Alert.alert(
          'Success!',
          applePayMsg,
          [
            {
              text: 'OK',
              onPress: () => {
                onAddMoney?.(numAmount)
                onBack?.()
              },
            },
          ]
        )
      } else if (result.errorCode === 'cancelled') {
        // user cancelled - no alert
      } else {
        // Show error banner instead of alert
        setError({ message: result.error || 'Unable to process Apple Pay payment.', type: 'payment' })
      }
    } catch (err) {
      console.error('Apple Pay error:', err)
      setError(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const ctaEnabled = (Number.parseFloat(amount) > 0 || paymentMethods.length === 0) && !isProcessing && !stripeLoading

  const keypadRows: (number | 'decimal' | 'delete')[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    ['decimal', 0, 'delete'],
  ]
  const keypadRowWidth = keySize * 3 + keyGap * 2
  const keyFontSize = Math.min(24, Math.round(keySize * 0.36))
  const keyIconSize = Math.min(24, Math.round(keySize * 0.4))

  return (
    <View style={s.container}>
      {/* Header — fixed */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={onBack}
          style={s.headerButton}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <MaterialIcons name="close" size={24} color={theme.text} />
        </TouchableOpacity>
        <BrandingLogo size="small" />
        <View style={{ width: 40 }} />
      </View>
      <Text style={s.headerTitle}>Add Cash</Text>

      {/* Body — header/amount/chips/footer keep their normal size; the
          keypad below is the only flexible region, sized to exactly fill
          whatever vertical space remains (see handleKeypadLayout), so the
          whole flow always fits on screen without scrolling. */}
      <View style={s.body}>
        {/* Amount Display */}
        <View style={s.amountWrap}>
          <Text style={s.amountText}>${amount}</Text>
        </View>

        {/* Context row: current balance + which payment method will be charged */}
        <View style={s.chipRow}>
          <View style={s.chip}>
            <Text style={s.chipText}>Balance: {formatCurrency(balance)}</Text>
          </View>

          {selectedPaymentMethodLabel && (
            <TouchableOpacity
              onPress={() => setShowPaymentMethodsModal(true)}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Change payment method"
              style={s.chip}
            >
              <MaterialIcons name="credit-card" size={14} color={theme.textSecondary} style={{ marginRight: 6 }} />
              <Text numberOfLines={1} style={[s.chipText, { maxWidth: 180 }]}>
                Paying with {selectedPaymentMethodLabel}
              </Text>
              <MaterialIcons name="chevron-right" size={16} color={theme.textDisabled} />
            </TouchableOpacity>
          )}
        </View>

        {/* Error Display */}
        {(error || stripeError) && (
          <View style={s.errorWrap}>
            <ErrorBanner
              error={getUserFriendlyError(error || stripeError)}
              onDismiss={() => {
                setError(null)
                if (stripeError) loadPaymentMethods().catch(() => { })
              }}
              onAction={error?.type === 'payment' ? () => handleAddMoney() : (stripeError ? () => loadPaymentMethods() : undefined)}
            />
          </View>
        )}

        {/* Keypad — flex:1 so it's measured with exactly the space left
            after the elements above/below it; handleKeypadLayout turns that
            measurement into the key size/gap used below. */}
        <View style={s.keypad} onLayout={handleKeypadLayout}>
          {keypadRows.map((row, idx) => (
            <View
              key={idx}
              style={[
                s.keypadRow,
                {
                  width: keypadRowWidth,
                  marginBottom: idx < keypadRows.length - 1 ? keyGap : 0,
                },
              ]}
            >
              {row.map((key) => {
                if (key === 'decimal') {
                  return (
                    <TouchableOpacity
                      key="decimal"
                      style={[s.keyButton, { width: keySize, height: keySize, borderRadius: keySize / 2 }]}
                      onPress={handleDecimalPress}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel="Decimal point"
                    >
                      <Text style={[s.keyText, { fontSize: keyFontSize }]}>.</Text>
                    </TouchableOpacity>
                  )
                }
                if (key === 'delete') {
                  return (
                    <TouchableOpacity
                      key="delete"
                      style={[s.keyButton, { width: keySize, height: keySize, borderRadius: keySize / 2 }]}
                      onPress={handleDeletePress}
                      activeOpacity={0.6}
                      accessibilityRole="button"
                      accessibilityLabel="Delete last digit"
                    >
                      <MaterialIcons name="backspace" size={keyIconSize} color={theme.text} />
                    </TouchableOpacity>
                  )
                }
                return (
                  <TouchableOpacity
                    key={key}
                    style={[s.keyButton, { width: keySize, height: keySize, borderRadius: keySize / 2 }]}
                    onPress={() => handleNumberPress(key)}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel={`Digit ${key}`}
                  >
                    <Text style={[s.keyText, { fontSize: keyFontSize }]}>{key}</Text>
                  </TouchableOpacity>
                )
              })}
            </View>
          ))}
        </View>
      </View>

      {/* Footer — Apple Pay + Add Money, pinned above the bottom nav and
          safe area, never overlapping the keypad above it. */}
      <View style={[s.footer, { paddingBottom: BOTTOM_NAV_BASE_OFFSET + Math.max(insets.bottom, 16) }]}>
        {/* Apple Pay button (iOS only).
            Always rendered on iOS — even when no card is provisioned in the
            Wallet app — so the Apple Pay integration is discoverable (the tap
            handler re-checks availability and guides the user to set it up).
            This keeps the integration locatable for App Store review per
            Guideline 2.1. Its black background is an Apple HIG requirement
            for Apple Pay buttons, not app branding — intentionally not a
            theme token. */}
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={s.applePayButton}
            onPress={handleApplePayPress}
            disabled={Number.parseFloat(amount) <= 0 || isProcessing}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Pay with Apple Pay"
          >
            {isProcessing ? (
              <>
                <ActivityIndicator size="small" color="#ffffff" style={{ marginRight: 8 }} />
                <Text style={s.applePayText}>Processing...</Text>
              </>
            ) : (
              <>
                <MaterialIcons name="apple" size={22} color="#ffffff" />
                <Text style={[s.applePayText, { marginLeft: 8 }]}>Pay</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Add Money / Link Payment Method button */}
        <TouchableOpacity
          style={[s.ctaButton, { backgroundColor: ctaEnabled ? theme.text : theme.textDisabled }]}
          disabled={!ctaEnabled}
          onPress={paymentMethods.length === 0 ? () => setShowPaymentMethodsModal(true) : handleAddMoney}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={paymentMethods.length === 0 ? "Link Payment Method" : "Add Money"}
          accessibilityState={{ disabled: !ctaEnabled }}
        >
          {isProcessing || stripeLoading ? (
            <>
              <ActivityIndicator size="small" color={theme.background} style={{ marginRight: 8 }} />
              <Text style={[s.ctaText, { color: theme.background }]}>
                {stripeLoading ? "Checking Methods..." : "Processing..."}
              </Text>
            </>
          ) : (
            <Text style={[s.ctaText, { color: theme.background, opacity: ctaEnabled ? 1 : 0.7 }]}>
              {paymentMethods.length === 0 ? "Link Payment Method" : "Add Money"}
            </Text>
          )}
        </TouchableOpacity>

        {/* Hint for new users */}
        {paymentMethods.length === 0 && !stripeLoading && !stripeError && (
          <Text style={s.hintText}>
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
    </View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: t.spacing.lg,
      paddingBottom: t.spacing.sm,
    },
    headerButton: {
      padding: t.spacing.sm,
      minWidth: 40,
      minHeight: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      color: t.text,
      fontSize: t.typography.fontSize.base,
      textAlign: 'center',
      marginTop: t.spacing.xs,
      marginBottom: t.spacing.sm,
    },
    body: {
      flex: 1,
      paddingHorizontal: t.spacing.xl,
      paddingBottom: t.spacing.sm,
    },
    amountWrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: t.spacing.lg,
    },
    amountText: {
      color: t.text,
      fontWeight: '800',
      fontSize: 56,
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: t.spacing.sm,
      marginBottom: t.spacing.lg,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      borderRadius: t.radius.full,
      paddingHorizontal: t.spacing.md,
      paddingVertical: t.spacing.xs,
      minHeight: 36,
    },
    chipText: {
      color: t.textSecondary,
      fontSize: t.typography.fontSize.xs,
      fontWeight: t.typography.fontWeight.semibold,
    },
    errorWrap: {
      marginBottom: t.spacing.lg,
    },
    keypad: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keypadRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    keyButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'transparent',
    },
    keyText: {
      color: t.text,
      fontWeight: '600',
    },
    footer: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.md,
      backgroundColor: t.background,
    },
    applePayButton: {
      width: '100%',
      paddingVertical: t.spacing.md,
      borderRadius: t.radius.full,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000',
      marginBottom: t.spacing.md,
    },
    applePayText: {
      color: '#ffffff',
      fontSize: t.typography.fontSize.base,
      fontWeight: '500',
    },
    ctaButton: {
      width: '100%',
      paddingVertical: t.spacing.md,
      borderRadius: t.radius.full,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaText: {
      fontSize: t.typography.fontSize.base,
      fontWeight: '500',
      textAlign: 'center',
    },
    hintText: {
      color: t.textDisabled,
      fontSize: t.typography.fontSize.xs,
      textAlign: 'center',
      marginTop: t.spacing.md,
      paddingHorizontal: t.spacing.xl,
    },
  })
}
