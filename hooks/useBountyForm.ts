import { useRef, useState } from 'react'
import { Alert, Animated } from 'react-native'
import { bountyService } from 'lib/services/bounty-service'
import { bountyPaymentsService } from 'lib/services/bounty-payments-service'
import { stripeService } from 'lib/services/stripe-service'
import { useStripe } from 'lib/stripe-context'
import type { Bounty } from 'lib/services/database.types'
import { logger } from 'lib/utils/error-logger'
import { shouldFundNewBountiesWithPhase2 } from 'lib/utils/payment-architecture'
import type { WalletTransactionRecord } from 'lib/wallet-context'
import { momentsService } from 'lib/moments/momentsService'
import { analyticsService } from 'lib/services/analytics-service'

export interface BountyFormData {
  title: string
  description: string
  location: string
  amount: number
  timeline: string
  skills: string
  isForHonor: boolean
  workType: 'online' | 'in_person'
  isTimeSensitive: boolean
  deadline: string
  attachments: {
    id: string
    name: string
    uri: string
    mimeType?: string
    size?: number
    status?: 'pending' | 'uploading' | 'uploaded' | 'failed'
    progress?: number
    remoteUri?: string
  }[]
}

const AMOUNT_PRESETS = [5, 10, 25, 50, 100]

const defaultFormData: BountyFormData = {
  title: '',
  description: '',
  location: '',
  amount: 0,
  timeline: '',
  skills: '',
  isForHonor: false,
  workType: 'in_person',
  isTimeSensitive: false,
  deadline: '',
  attachments: [],
}

interface UseBountyFormParams {
  currentUserId?: string
  balance: number
  createEscrow: (bountyId: string | number, amount: number, title: string, posterId: string) => Promise<WalletTransactionRecord>
  isEmailVerified: boolean
  onBountyPosted?: () => void
  setActiveScreen: (screen: string) => void
  setMyBounties: React.Dispatch<React.SetStateAction<Bounty[]>>
  onError?: (message: string) => void
}

export function useBountyForm({
  currentUserId,
  balance,
  createEscrow,
  isEmailVerified,
  onBountyPosted,
  setActiveScreen,
  setMyBounties,
  onError,
}: UseBountyFormParams) {
  const [formData, setFormData] = useState<BountyFormData>(defaultFormData)
  const [showConfirmationCard, setShowConfirmationCard] = useState(false)
  const [showAddBountyAmount, setShowAddBountyAmount] = useState(false)
  const [showAddMoney, setShowAddMoney] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [postSuccess, setPostSuccess] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const postButtonRef = useRef<any>(null)
  const lowBalanceAnim = useRef(new Animated.Value(0)).current
  const { paymentMethods } = useStripe()

  const otherSelected = formData.amount !== 0 && !AMOUNT_PRESETS.includes(formData.amount)

  const handleChooseAmount = (val: number) => {
    setFormData((prev) => ({ ...prev, amount: val, isForHonor: false }))
  }

  const handleAddBountyAmount = (amount: number, isForHonor: boolean) => {
    setFormData((prev) => ({
      ...prev,
      amount,
      isForHonor,
    }))
    setShowAddBountyAmount(false)
  }

  // Show confirmation card instead of directly posting
  const handleShowConfirmation = () => {
    // Email verification gate: Block posting if email is not verified
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to post bounties. We've sent a verification link to your inbox.",
        [{ text: 'OK', style: 'default' }]
      )
      return
    }
    setShowConfirmationCard(true)
  }

  // Handle the actual bounty posting after confirmation
  const handlePostBounty = async () => {
    // Email verification gate: Double-check before submitting
    if (!isEmailVerified) {
      Alert.alert(
        'Email verification required',
        "Please verify your email to post bounties. We've sent a verification link to your inbox.",
        [{ text: 'OK', style: 'default' }]
      )
      return
    }

    if (!currentUserId) {
      Alert.alert('Not signed in', 'You must be signed in to post a bounty.')
      return
    }

    try {
      setIsSubmitting(true)

      // Route new paid bounties to the Stripe-native Phase 2 escrow path when
      // enabled; existing/legacy bounties always keep the custodial wallet
      // flow they were created with (see lib/utils/payment-architecture.ts).
      const useV2Payments =
        !formData.isForHonor && formData.amount > 0 && shouldFundNewBountiesWithPhase2()

      // Validate balance BEFORE posting bounty for paid, v1 bounties. The v2
      // path charges a card directly via Stripe, so the custodial wallet
      // balance is not relevant there.
      if (!useV2Payments && !formData.isForHonor && formData.amount > 0) {
        if (balance < formData.amount) {
          // Real signal that the user needs funds right now — surface the
          // Moments Queue's fund_wallet prompt next time it's evaluated,
          // rather than only showing this one-off blocking alert.
          momentsService.enqueue(currentUserId, 'fund_wallet', {
            amountNeeded: formData.amount - balance,
            bountyTitle: formData.title,
          })
          analyticsService.trackEvent('moment_event_enqueued', {
            momentType: 'fund_wallet',
            source: 'post_bounty_insufficient_balance',
          })
          Alert.alert(
            'Insufficient Balance',
            'You do not have enough balance to post this bounty. Please add funds to your wallet.',
            [{ text: 'OK' }]
          )
          setIsSubmitting(false)
          return
        }
      }

      // Prepare bounty data
      const bountyData: Omit<Bounty, 'id' | 'created_at'> & { attachments_json?: string } = {
        title: formData.title,
        description: formData.description,
        amount: formData.isForHonor ? 0 : formData.amount,
        is_for_honor: formData.isForHonor,
        location: formData.workType === 'in_person' ? formData.location : '',
        timeline: formData.timeline,
        skills_required: formData.skills,
        poster_id: currentUserId,
        status: 'open',
        work_type: formData.workType,
        is_time_sensitive: formData.isTimeSensitive,
        deadline: formData.isTimeSensitive ? formData.deadline : undefined,
        attachments_json: (() => {
          const uploaded = formData.attachments.filter(a => a.remoteUri || a.status === 'uploaded')
          return uploaded.length ? JSON.stringify(uploaded) : undefined
        })(),
      }

      // Debug: log exact payload being sent to create
      try {
        logger.info('[useBountyForm] Creating bounty with payload:', { payload: bountyData })
      } catch (e) {
        logger.warning('[useBountyForm] Creating bounty - could not stringify payload', { error: (e as any)?.message })
      }

      // Create the bounty using our service
      const bounty = await bountyService.create(bountyData)

      if (!bounty) {
        throw new Error('Failed to create bounty. The server returned an empty response.')
      }

      // Create escrow for paid bounties (funds are held when bounty is posted)
      if (bounty && !bounty.is_for_honor && bounty.amount > 0) {
        try {
          await analyticsService.trackEvent('payment_architecture_routed', {
            bountyId: String(bounty.id),
            version: useV2Payments ? 2 : 1,
            context: 'funding',
          })
        } catch {
          /* analytics is best-effort */
        }

        if (useV2Payments) {
          try {
            try {
              await analyticsService.trackEvent('payment_initiated', {
                bountyId: String(bounty.id),
                architecture: 'v2',
                amount: bounty.amount,
              })
            } catch {
              /* analytics is best-effort */
            }

            const paymentResult = await bountyPaymentsService.createBountyPayment(String(bounty.id))

            // Confirm against the poster's saved payment method — this
            // codebase does not use Stripe's PaymentSheet UI component (see
            // lib/stripe-context.tsx / hooks/use-wallet-deposit.ts).
            const paymentMethodId = paymentMethods[0]?.id
            if (!paymentMethodId) {
              throw new Error('No payment method available. Please add a payment method first.')
            }
            const confirmedIntent = await stripeService.confirmPaymentSecure(
              paymentResult.clientSecret,
              paymentMethodId,
              undefined,
              { userId: currentUserId }
            )
            if (confirmedIntent.status !== 'succeeded') {
              throw new Error('Payment was not completed. Please try again.')
            }

            try {
              await analyticsService.trackEvent('escrow_funded', {
                bountyId: String(bounty.id),
                architecture: 'v2',
                amount: bounty.amount,
              })
            } catch {
              /* analytics is best-effort */
            }
          } catch (escrowError) {
            console.error('Error charging card for bounty:', escrowError)
            try {
              await analyticsService.trackEvent('payment_failed', {
                bountyId: String(bounty.id),
                architecture: 'v2',
                stage: 'create_or_confirm',
              })
            } catch {
              /* analytics is best-effort */
            }
            try {
              await bountyPaymentsService.cancelBountyPayment(String(bounty.id))
            } catch {
              /* best-effort — the bounty delete below is the real safety net */
            }
            await bountyService.delete(bounty.id)
            Alert.alert(
              'Payment Failed',
              'Failed to charge your card for this bounty. The bounty has been removed.',
              [{ text: 'OK' }]
            )
            setIsSubmitting(false)
            return
          }
        } else {
          try {
            await createEscrow(
              bounty.id,
              bounty.amount,
              bounty.title,
              currentUserId
            )
            try {
              await analyticsService.trackEvent('escrow_funded', {
                bountyId: String(bounty.id),
                architecture: 'v1',
                amount: bounty.amount,
              })
            } catch {
              /* analytics is best-effort */
            }
          } catch (escrowError) {
            console.error('Error creating escrow:', escrowError)
            try {
              await analyticsService.trackEvent('payment_failed', {
                bountyId: String(bounty.id),
                architecture: 'v1',
                stage: 'create_escrow',
              })
            } catch {
              /* analytics is best-effort */
            }
            // If escrow creation fails, delete the bounty to maintain consistency
            await bountyService.delete(bounty.id)
            Alert.alert(
              'Escrow Failed',
              'Failed to create escrow for this bounty. The bounty has been removed.',
              [{ text: 'OK' }]
            )
            setIsSubmitting(false)
            return
          }
        }
      }

      // Update local state with the new bounty
      if (bounty) {
        setMyBounties((prevBounties) => [bounty, ...prevBounties])

        // Set success state to trigger animations and UI updates
        setPostSuccess(true)

        // Notify parent to refresh public feed
        onBountyPosted?.()

        // Reset form
        setFormData(defaultFormData)

        // Close confirmation card
        setShowConfirmationCard(false)

        // Navigate to the main bounty feed so the new bounty is visible
        setActiveScreen('bounty')

        // Reset success state after a delay
        setTimeout(() => {
          setPostSuccess(false)
        }, 3000)
      }
    } catch (err: any) {
      console.error('Error posting bounty:', err)
      const msg = err instanceof Error ? err.message : (err?.message || 'Failed to post bounty')
      setShowConfirmationCard(false)
      onError?.(msg)
    } finally {
      setIsSubmitting(false)
    }
  }

  return {
    formData,
    setFormData,
    showConfirmationCard,
    setShowConfirmationCard,
    showAddBountyAmount,
    setShowAddBountyAmount,
    showAddMoney,
    setShowAddMoney,
    isSubmitting,
    postSuccess,
    validationError,
    setValidationError,
    postButtonRef,
    lowBalanceAnim,
    otherSelected,
    AMOUNT_PRESETS,
    handleChooseAmount,
    handleAddBountyAmount,
    handleShowConfirmation,
    handlePostBounty,
  }
}
