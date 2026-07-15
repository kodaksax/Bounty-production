import { useEffect, useState } from 'react'
import { Alert } from 'react-native'
import { useAuthContext } from './use-auth-context'
import { config } from '../lib/config'
import { API_BASE_URL } from '../lib/config/api'
import { applePayService } from '../lib/services/apple-pay-service'
import { getPaymentErrorMessage } from '../lib/utils/error-messages'
import { useStripe } from '../lib/stripe-context'
import { useWallet } from '../lib/wallet-context'

export interface DepositSuccessInfo {
  amount: number
  persisted: boolean
  via: 'card' | 'applePay'
}

/**
 * Shared wallet-deposit business logic behind both the general "Add Cash"
 * keypad screen (components/add-money-screen.tsx) and the fixed-amount
 * onboarding funding confirmation (components/onboarding/PosterFundingScreen.tsx).
 * Keeping this in one place means the Stripe/Apple Pay/retry/persistence
 * behavior can't drift between the two UIs.
 *
 * Retries up to 3 times with exponential back-off so transient network blips
 * don't silently drop the server-side balance update.
 */
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
      console.warn(`[WalletDeposit] Persist ${source ? `${source} ` : ''}deposit attempt ${attempt}/${MAX_RETRIES} responded with ${res.status} ${res.statusText}:`, bodyText)

      // Don't retry on 4xx client errors (except 408/429) — they won't succeed
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        return false
      }
    } catch (e) {
      console.warn(`[WalletDeposit] Persist ${source ? `${source} ` : ''}deposit attempt ${attempt}/${MAX_RETRIES} failed:`, e)
    }
    // Exponential back-off: 1s, 2s, 4s
    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, 1000 * 2 ** (attempt - 1)))
    }
  }
  return false
}

export function useWalletDeposit() {
  const [isProcessing, setIsProcessing] = useState(false)
  const [isApplePayAvailable, setIsApplePayAvailable] = useState(false)
  const [showPaymentMethodsModal, setShowPaymentMethodsModal] = useState(false)
  const [error, setError] = useState<any>(null)
  const [successInfo, setSuccessInfo] = useState<DepositSuccessInfo | null>(null)
  const { deposit, refreshFromApi } = useWallet()
  const { processPaymentSecure, paymentMethods, isLoading: stripeLoading, error: stripeError, loadPaymentMethods } = useStripe()
  const { session } = useAuthContext()

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

  const payWithCard = async (numAmount: number) => {
    if (isNaN(numAmount) || numAmount <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount greater than $0.', [{ text: 'OK' }])
      return
    }

    if (paymentMethods.length === 0) {
      Alert.alert(
        'No Payment Method',
        'You need to add a payment method before you can add money to your wallet. Choose from cards or bank accounts.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Add Payment Method', onPress: () => setShowPaymentMethodsModal(true) }
        ]
      )
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
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
          console.warn('[WalletDeposit] Failed to sync balance from server after deposit:', syncErr)
        }

        setSuccessInfo({ amount: numAmount, persisted, via: 'card' })
      } else {
        const errorMsg = getPaymentErrorMessage(result.error)
        setError({ message: errorMsg, type: 'payment' })
      }
    } catch (err: any) {
      console.error('Payment error:', err)
      setError(err)
    } finally {
      setIsProcessing(false)
    }
  }

  const payWithApplePay = async (numAmount: number) => {
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

        const persisted = await persistDeposit(result.paymentIntentId, numAmount, session?.access_token, 'Apple Pay')

        try {
          if (session?.access_token) {
            await refreshFromApi(session.access_token)
          }
        } catch (syncErr) {
          console.warn('[WalletDeposit] Failed to sync balance from server after Apple Pay deposit:', syncErr)
        }

        setSuccessInfo({ amount: numAmount, persisted, via: 'applePay' })
      } else if (result.errorCode === 'cancelled') {
        // user cancelled - no alert
      } else {
        setError({ message: result.error || 'Unable to process Apple Pay payment.', type: 'payment' })
      }
    } catch (err) {
      console.error('Apple Pay error:', err)
      setError(err)
    } finally {
      setIsProcessing(false)
    }
  }

  return {
    isProcessing,
    isApplePayAvailable,
    error,
    setError,
    successInfo,
    setSuccessInfo,
    showPaymentMethodsModal,
    setShowPaymentMethodsModal,
    paymentMethods,
    stripeLoading,
    stripeError,
    loadPaymentMethods,
    payWithCard,
    payWithApplePay,
  }
}

export function buildDepositSuccessMessage({ amount, persisted, via }: DepositSuccessInfo): string {
  const suffix = via === 'applePay' ? ' via Apple Pay' : ''
  const base = `$${amount.toFixed(2)} has been added to your wallet${suffix}.`
  return persisted
    ? base
    : `${base}\n\nNote: There was a temporary issue syncing with the server. Your balance will update automatically shortly.`
}
