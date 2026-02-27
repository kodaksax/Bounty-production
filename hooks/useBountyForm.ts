import { useRef, useState } from 'react'
import { Alert, Animated } from 'react-native'
import { bountyService } from 'lib/services/bounty-service'
import type { Bounty } from 'lib/services/database.types'
import { logger } from 'lib/utils/error-logger'

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
  createEscrow: (bountyId: any, amount: number, title: string, userId?: string) => Promise<any>
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

    try {
      setIsSubmitting(true)

      // Validate balance BEFORE posting bounty for paid bounties
      if (!formData.isForHonor && formData.amount > 0) {
        if (balance < formData.amount) {
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
          const uploaded = formData.attachments.filter(a => (a as any).remoteUri || a.status === 'uploaded')
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
          await createEscrow(
            bounty.id,
            bounty.amount,
            bounty.title,
            currentUserId
          )
        } catch (escrowError) {
          console.error('Error creating escrow:', escrowError)
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
