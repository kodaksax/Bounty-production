import { MaterialIcons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { bountyRequestService } from 'lib/services/bounty-request-service'
import { bountyService } from 'lib/services/bounty-service'
import { cancellationService } from 'lib/services/cancellation-service'
import { completionService } from 'lib/services/completion-service'
import type { Bounty } from 'lib/services/database.types'
import { disputeService } from 'lib/services/dispute-service'
import { messageService } from 'lib/services/message-service'
import { staleBountyService } from 'lib/services/stale-bounty-service'
import { userProfileService } from 'lib/services/userProfile'
import type { Attachment, Conversation } from 'lib/types'
import { getCurrentUserId } from 'lib/utils/data-utils'
import { useEffect, useMemo, useReducer, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View
} from 'react-native'
import { useAttachmentUpload } from '../hooks/use-attachment-upload'
import { logClientError } from '../lib/services/monitoring'
import { navigationIntent } from '../lib/services/navigation-intent'
import { useWallet } from '../lib/wallet-context'
import { AttachmentViewerModal } from './attachment-viewer-modal'
import { BountyCard } from './bounty-card'
import { PosterReviewModal } from './poster-review-modal'
import { StaleBountyAlert } from './stale-bounty-alert'
import { AnimatedSection } from './ui/animated-section'
import { AttachmentsList } from './ui/attachments-list'
import { MessageBar } from './ui/message-bar'
import { RatingStars } from './ui/rating-stars'
import { RevisionFeedbackBanner } from './ui/revision-feedback-banner'
import { Stepper } from './ui/stepper'
import { WorkflowDisputeModal } from './workflow-dispute-modal'

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

type Props = {
  bounty: Bounty
  currentUserId?: string
  expanded: boolean
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
  onWithdrawApplication?: () => void
  onGoToReview?: (bountyId: string) => void
  onGoToPayout?: (bountyId: string) => void
  variant?: 'owner' | 'hunter'
  isListScrolling?: boolean
  onExpandedLayout?: () => void
  onRefresh?: () => void
}

const STAGES = [
  { id: 'apply_work', label: 'Apply & Work', icon: 'work' },
  { id: 'working_progress', label: 'Working Progress', icon: 'trending-up' },
  { id: 'review_verify', label: 'Review & Verify', icon: 'rate-review' },
  { id: 'payout', label: 'Payout', icon: 'account-balance-wallet' },
]
const EMPTY_CONVERSATION_NAME = ''

type ProofDraftItem = {
  id: string
  type: 'image' | 'file'
  name: string
  size?: number
  uri?: string
  remoteUri?: string
  mimeType?: string
}

export function MyPostingExpandable({ bounty, currentUserId, expanded, onToggle, onEdit, onDelete, onWithdrawApplication, onGoToReview, onGoToPayout, variant, isListScrolling, onExpandedLayout, onRefresh }: Props) {
  const router = useRouter()
  type UIState = {
    conversation: Conversation | null
    wipExpanded: boolean
    readyToSubmitPressed: boolean
    ratingDraft: number
    showReviewModal: boolean
    hasSubmission: boolean
    reviewExpanded: boolean
    payoutExpanded: boolean
    showRevisionBanner: boolean
    hasCancellationRequest: boolean
    hasDispute: boolean
    timeElapsed: number
    hunterName: string
    localStageOverride: null | 'apply_work' | 'working_progress' | 'review_verify' | 'payout'
    hunterToolsExpanded: boolean
    posterToolsExpanded: boolean
    showDisputeModal: boolean
    activeDisputeId: string | null
  }

  const initialUIState = (name = 'Hunter'): UIState => ({
    conversation: null,
    wipExpanded: false,
    readyToSubmitPressed: false,
    ratingDraft: 0,
    showReviewModal: false,
    hasSubmission: false,
    reviewExpanded: false,
    payoutExpanded: false,
    showRevisionBanner: false,
    hasCancellationRequest: false,
    hasDispute: false,
    timeElapsed: 0,
    hunterName: name,
    localStageOverride: null,
    hunterToolsExpanded: false,
    posterToolsExpanded: false,
    showDisputeModal: false,
    activeDisputeId: null as string | null,
  })

  type UIAction =
    | { type: 'reset' }
    | {
      [K in keyof UIState]: {
        type: 'set'
        key: K
        value: UIState[K]
      }
    }[keyof UIState]

  function uiReducer(state: UIState, action: UIAction): UIState {
    switch (action.type) {
      case 'reset':
        return initialUIState()
      case 'set':
        return { ...state, [action.key]: action.value }
      default:
        return state
    }
  }

  const [uiState, dispatchUi] = useReducer(uiReducer, initialUIState())
  const {
    conversation,
    wipExpanded,
    readyToSubmitPressed,
    ratingDraft,
    showReviewModal,
    hasSubmission,
    reviewExpanded,
    payoutExpanded,
    showRevisionBanner,
    hasCancellationRequest,
    hasDispute,
    timeElapsed,
    hunterName,
    localStageOverride,
    hunterToolsExpanded,
    posterToolsExpanded,
    showDisputeModal,
    activeDisputeId,
  } = uiState

  // Track profile pictures for poster/hunter
  const [otherPartyAvatar, setOtherPartyAvatar] = useState<string | null>(null)
  const [otherPartyName, setOtherPartyName] = useState<string>('')
  const [hiddenByUser, setHiddenByUser] = useState(false)
  
  // Viewer state for proof attachments
  const [selectedProofItem, setSelectedProofItem] = useState<Attachment | null>(null)
  const [proofViewerVisible, setProofViewerVisible] = useState(false)

  // Track the current user's request for this bounty (if any)
  const [requestStatus, setRequestStatus] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(null)

  type ReadyRecord = { bounty_id: string; hunter_id: string; ready_at: string } | null

  type DraftState = {
    completionMessage: string
    proofItems: ProofDraftItem[]
    isSubmitting: boolean
    submissionPending: boolean
    readyRecord: ReadyRecord
    revisionFeedback: string | null
    hasRevisionRequested: boolean
  }

  const initialDraft = (bountyId?: string): DraftState => ({
    completionMessage: '',
    proofItems: [],
    isSubmitting: false,
    submissionPending: false,
    readyRecord: null,
    revisionFeedback: null,
    hasRevisionRequested: false,
  })

  type DraftAction =
    | { type: 'reset'; bountyId?: string }
    | { type: 'setMessage'; message: string }
    | { type: 'setProofs'; proofs: ProofDraftItem[] }
    | { type: 'addProofs'; proofs: ProofDraftItem[] }
    | { type: 'removeProof'; id: string }
    | { type: 'setSubmitting'; value: boolean }
    | { type: 'setSubmissionPending'; value: boolean }
    | { type: 'setReadyRecord'; record: ReadyRecord }
    | { type: 'setRevisionFeedback'; text: string | null }

  function draftReducer(state: DraftState, action: DraftAction): DraftState {
    switch (action.type) {
      case 'reset':
        return initialDraft()
      case 'setMessage':
        return { ...state, completionMessage: action.message }
      case 'setProofs':
        return { ...state, proofItems: action.proofs }
      case 'addProofs':
        return { ...state, proofItems: [...state.proofItems, ...action.proofs] }
      case 'removeProof':
        return { ...state, proofItems: state.proofItems.filter(p => p.id !== action.id) }
      case 'setSubmitting':
        return { ...state, isSubmitting: action.value }
      case 'setSubmissionPending':
        return { ...state, submissionPending: action.value }
      case 'setReadyRecord':
        return { ...state, readyRecord: action.record }
      case 'setRevisionFeedback':
        return { ...state, revisionFeedback: action.text, hasRevisionRequested: !!action.text }
      default:
        return state
    }
  }

  const [draft, dispatchDraft] = useReducer(draftReducer, initialDraft())
  const { completionMessage, proofItems, isSubmitting, submissionPending, readyRecord, revisionFeedback, hasRevisionRequested } = draft

  // Hunter completion submission state
  const [startTime] = useState(Date.now())
  const { transactions } = useWallet()

  useEffect(() => {
    // Reset non-draft UI state when bounty changes; draft state is reset via reducer
    dispatchUi({ type: 'reset' })
    dispatchDraft({ type: 'reset' })
  }, [bounty.id])

  // Monitoring: detect mismatches where bounty marked completed but escrow still funded locally
  useEffect(() => {
    try {
      if (!bounty) return
      if (String(bounty.status) !== 'completed') return
      const escrowStillFunded = transactions.some(tx => tx.type === 'escrow' && String(tx.details?.bounty_id) === String(bounty.id) && tx.escrowStatus === 'funded')
      if (escrowStillFunded) {
        logClientError('Bounty completed but escrow still funded locally', { bountyId: String(bounty.id), bountyStatus: bounty.status })
      }
    } catch (e) {
      // swallow
    }
  }, [bounty, transactions])

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const list = await messageService.getConversations()
        if (!mounted) return
        const effectiveUserId = currentUserId || getCurrentUserId()

        // First try: match by bountyId (preferred)
        let match = list.find(c => String(c.bountyId) === String(bounty.id)) || null

        // Second try: find a 1:1 conversation between current user and poster
        if (!match && effectiveUserId) {
          const posterId = bounty.poster_id || bounty.user_id
          if (posterId) {
            match = list.find(c => {
              if (c.isGroup) return false
              const parts = c.participantIds || []
              return parts.includes(String(effectiveUserId)) && parts.includes(String(posterId))
            }) || null
          }
        }

        // Third try: query supabase-backed cache if still not found (covers cases
        // where conversation exists in Supabase but local AsyncStorage cache is stale)
        if (!match) {
          try {
            // Importing supabase-fetch directly is safe here for fallback only
            const supabaseMessaging = await import('../lib/services/supabase-messaging')
            const supList = await supabaseMessaging.fetchConversations(String(effectiveUserId || ''))
            if (supList && supList.length > 0) {
              match = supList.find(c => String(c.bountyId) === String(bounty.id)) || match
              if (!match && effectiveUserId) {
                const posterId = bounty.poster_id || bounty.user_id
                if (posterId) {
                  match = supList.find(c => !c.isGroup && (c.participantIds || []).includes(String(effectiveUserId)) && (c.participantIds || []).includes(String(posterId))) || match
                }
              }
            }
          } catch (e) {
            // best-effort; if supabase fetch fails, continue silently
            console.warn('Failed to fetch supabase conversations for fallback lookup', e)
          }
        }

        dispatchUi({ type: 'set', key: 'conversation', value: match })

        // Fetch hunter profile if available and we're the owner
        const hunterId = bounty.accepted_by || readyRecord?.hunter_id
        if (hunterId && variant === 'owner') {
          try {
            const hunterProfile = await userProfileService.getProfile(hunterId)
            if (!mounted) return
            if (hunterProfile?.username) {
              dispatchUi({ type: 'set', key: 'hunterName', value: hunterProfile.username })
            }
            // Set hunter avatar and name for card display
            setOtherPartyAvatar(hunterProfile?.avatar || null)
            setOtherPartyName(hunterProfile?.username || 'Hunter')
          } catch (error) {
            // Fallback to default "Hunter" if profile fetch fails
            console.error('[MyPosting] Failed to fetch hunter profile:', error)
          }
        }

        // Fetch poster profile if we're the hunter
        const posterId = bounty.poster_id || bounty.user_id
        if (posterId && variant === 'hunter') {

                  // Load the current user's request status for this bounty (if hunter)
                  try {
                    if (currentUserId) {
                      const reqs = await bountyRequestService.getAll({ bountyId: String(bounty.id), userId: String(currentUserId) })
                      if (Array.isArray(reqs) && reqs.length > 0) {
                        setRequestStatus(reqs[0].status)
                        setRequestId(String(reqs[0].id))
                      } else {
                        setRequestStatus(null)
                        setRequestId(null)
                      }
                    }
                  } catch (err) {
                    // ignore request load errors
                    setRequestStatus(null)
                    setRequestId(null)
                  }
          try {
            const posterProfile = await userProfileService.getProfile(String(posterId))
            if (!mounted) return
            // Set poster avatar and name for card display
            setOtherPartyAvatar(posterProfile?.avatar || null)
            setOtherPartyName(posterProfile?.username || 'Poster')
          } catch (error) {
            console.error('[MyPosting] Failed to fetch poster profile:', error)
          }
        }

        // Check if there's a pending submission
        if (bounty.status === 'in_progress' && variant === 'owner') {
          const submission = await completionService.getSubmission(String(bounty.id))
          if (!mounted) return
          const foundSubmission = !!submission && submission.status === 'pending'
          dispatchUi({ type: 'set', key: 'hasSubmission', value: foundSubmission })
          // Auto-expand Review & Verify section when submission is detected
          if (foundSubmission) {
            dispatchUi({ type: 'set', key: 'reviewExpanded', value: true })
            dispatchUi({ type: 'set', key: 'wipExpanded', value: false })
            // Move the visual stepper to Review & Verify so owner sees where action is needed
            dispatchUi({ type: 'set', key: 'localStageOverride', value: 'review_verify' })
          }
        }
        // For hunters, initialize revision indicator state from latest submission
        if (bounty.status === 'in_progress' && variant === 'hunter') {
          try {
            const submission = await completionService.getSubmission(String(bounty.id))
            if (!mounted) return
            if (submission) {
              // Only check pending-for-hunter if currentUserId is defined
              let isPendingForHunter = false
              if (currentUserId) {
                const hunterId = String(currentUserId)
                isPendingForHunter = submission.status === 'pending' && submission.hunter_id === hunterId
              }

              if (isPendingForHunter) {
                dispatchUi({ type: 'set', key: 'hasSubmission', value: true })
                dispatchDraft({ type: 'setSubmissionPending', value: true })
                dispatchDraft({ type: 'setProofs', proofs: Array.isArray(submission.proof_items) ? submission.proof_items as ProofDraftItem[] : [] })
                dispatchDraft({ type: 'setMessage', message: submission.message || '' })
                dispatchUi({ type: 'set', key: 'reviewExpanded', value: false })
                dispatchUi({ type: 'set', key: 'payoutExpanded', value: true })
                dispatchUi({ type: 'set', key: 'showRevisionBanner', value: false })
                dispatchDraft({ type: 'setRevisionFeedback', text: null })
              } else if (submission.status === 'revision_requested') {
                dispatchDraft({ type: 'setRevisionFeedback', text: submission.poster_feedback || null })
                dispatchUi({ type: 'set', key: 'showRevisionBanner', value: true })
                dispatchDraft({ type: 'setProofs', proofs: Array.isArray(submission.proof_items) ? submission.proof_items as ProofDraftItem[] : [] })
                dispatchDraft({ type: 'setMessage', message: submission.message || '' })
                dispatchUi({ type: 'set', key: 'localStageOverride', value: 'working_progress' })
                dispatchUi({ type: 'set', key: 'wipExpanded', value: true })
                dispatchUi({ type: 'set', key: 'reviewExpanded', value: false })
                dispatchDraft({ type: 'setSubmissionPending', value: false })
                dispatchUi({ type: 'set', key: 'hasSubmission', value: false })
              } else {
                dispatchDraft({ type: 'setSubmissionPending', value: false })
                dispatchUi({ type: 'set', key: 'hasSubmission', value: false })
                dispatchUi({ type: 'set', key: 'showRevisionBanner', value: false })
                dispatchDraft({ type: 'setRevisionFeedback', text: null })
              }
            }
          } catch { }
        }
        // Also check ready flag (hunter clicked Ready to Submit)
        try {
          const ready = await completionService.getReady(String(bounty.id))
          if (!mounted) return
          dispatchDraft({ type: 'setReadyRecord', record: ready })
        } catch { }

        // Check for cancellation request
        try {
          const cancellation = await cancellationService.getCancellationByBountyId(String(bounty.id))
          if (!mounted) return
          if (cancellation && cancellation.status === 'pending') {
            dispatchUi({ type: 'set', key: 'hasCancellationRequest', value: true })
          }
        } catch { }

        // Check for active dispute (both cancellation-based and workflow-stage)
        try {
          // First check for workflow-stage disputes
          const workflowDispute = await disputeService.getDisputeByBountyId(String(bounty.id))
          if (!mounted) return
          if (workflowDispute && (workflowDispute.status === 'open' || workflowDispute.status === 'under_review')) {
            dispatchUi({ type: 'set', key: 'hasDispute', value: true })
            dispatchUi({ type: 'set', key: 'activeDisputeId', value: workflowDispute.id })
          } else {
            // Fallback: check cancellation-based disputes
            const dispute = await disputeService.getDisputeByCancellationId(String(bounty.id))
            if (!mounted) return
            if (dispute && (dispute.status === 'open' || dispute.status === 'under_review')) {
              dispatchUi({ type: 'set', key: 'hasDispute', value: true })
              dispatchUi({ type: 'set', key: 'activeDisputeId', value: dispute.id })
            }
          }
        } catch { }
      } catch { }
    }
    // Load owner-related state (submission / ready flag) earlier so posters see pending work in list view.
    // Also load for hunters even when the card is not expanded so revision-requested state
    // is available in the compact card (shows badge) without needing to open the card first.
    if (expanded || variant === 'owner' || variant === 'hunter') load()
    return () => {
      mounted = false
    }
  }, [expanded, bounty.id, bounty.status, variant])

  // owner detection
  const isOwner = useMemo(() => {
    if (variant === 'owner') return true
    if (variant === 'hunter') return false
    return currentUserId === bounty.user_id
  }, [variant, currentUserId, bounty.user_id])

  // Timer for hunter completion
  useEffect(() => {
    if (!isOwner && bounty.status === 'in_progress' && reviewExpanded) {
      const interval = setInterval(() => {
        dispatchUi({ type: 'set', key: 'timeElapsed', value: Math.floor((Date.now() - startTime) / 1000) })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [isOwner, bounty.status, reviewExpanded, startTime])

  // Subscribe to ready-state realtime updates so poster's card unlocks immediately
  useEffect(() => {
    if (!bounty.id) return
    let unsub: (() => void) | undefined
    try {
      unsub = completionService.subscribeReady(String(bounty.id), (rec) => {
        dispatchDraft({ type: 'setReadyRecord', record: rec })
        if (variant === 'owner' && rec) {
          // If owner sees a ready record, show review submission availability
          dispatchUi({ type: 'set', key: 'hasSubmission', value: true })
        }
      })
    } catch (e) {
      // ignore
    }
    return () => { try { unsub && unsub() } catch { } }
  }, [bounty.id, variant])

  // Subscribe to submission updates so hunter gets pushed back to WIP if poster requests revision
  useEffect(() => {
    if (!bounty.id) return
    let unsub: (() => void) | undefined
    try {
      unsub = completionService.subscribeSubmission(String(bounty.id), (submission) => {
        if (!submission) {
          dispatchUi({ type: 'set', key: 'hasSubmission', value: false })
          dispatchDraft({ type: 'setRevisionFeedback', text: null })
          dispatchUi({ type: 'set', key: 'showRevisionBanner', value: false })

          return
        }
        const isPending = submission.status === 'pending'
        dispatchUi({ type: 'set', key: 'hasSubmission', value: isPending })
        dispatchDraft({ type: 'setProofs', proofs: Array.isArray(submission.proof_items) ? submission.proof_items as ProofDraftItem[] : [] })
        dispatchDraft({ type: 'setMessage', message: submission.message || '' })

        // If poster gets a new submission, auto-expand Review & Verify section
        if (isOwner && isPending) {
          dispatchUi({ type: 'set', key: 'reviewExpanded', value: true })
          dispatchUi({ type: 'set', key: 'wipExpanded', value: false })
          // Show the stepper on the Review & Verify bubble for owner
          dispatchUi({ type: 'set', key: 'localStageOverride', value: 'review_verify' })
        }

        // If the poster requested a revision, and we're the hunter, move back to Work in Progress
        if (!isOwner && submission.status === 'revision_requested') {
          // Store feedback and show banner instead of alert
          dispatchDraft({ type: 'setRevisionFeedback', text: submission.poster_feedback || 'The poster has requested changes to your work.' })
          dispatchUi({ type: 'set', key: 'showRevisionBanner', value: true })
          dispatchUi({ type: 'set', key: 'localStageOverride', value: 'working_progress' })
          dispatchUi({ type: 'set', key: 'wipExpanded', value: true })
          dispatchUi({ type: 'set', key: 'reviewExpanded', value: false })
          dispatchDraft({ type: 'setSubmissionPending', value: false })
          dispatchUi({ type: 'set', key: 'hasSubmission', value: false })
        }
      })
    } catch (e) {
      // ignore
    }
    return () => { try { unsub && unsub() } catch { } }
  }, [bounty.id, isOwner])

  const currentStage: 'apply_work' | 'working_progress' | 'review_verify' | 'payout' = useMemo(() => {
    if (bounty.status === 'in_progress') return 'working_progress'
    if (bounty.status === 'completed') return 'payout'
    // We don't track 'review_verify' in status—user reaches it via flow; keep default as 'apply_work'
    return 'apply_work'
  }, [bounty.status])

  // Local override to move the UI to a specific stage when user advances via buttons


  const animate = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)

  // Parse attachments from bounty
  const attachments: Attachment[] = useMemo(() => {
    if (!bounty.attachments_json) return []
    try {
      const raw: any = (bounty as any).attachments_json
      if (typeof raw === 'string') {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? parsed : []
      }
      if (Array.isArray(raw)) return raw as Attachment[]
      // If it's an object (unexpected shape), attempt to coerce to array
      return Array.isArray(raw) ? raw : []
    } catch {
      return []
    }
  }, [bounty.attachments_json])

  const handleSendMessage = async (text: string) => {
    console.log('[handleSendMessage] bounty.accepted_by:', bounty.accepted_by)
    console.log('[handleSendMessage] conversation:', conversation?.id, conversation?.participantIds)
    console.log('[handleSendMessage] currentUserId:', currentUserId)
    const resolveCounterpartyId = (): string | null => {
      const effectiveUserId = currentUserId || getCurrentUserId()
      const participantFallback = effectiveUserId
        ? (conversation?.participantIds || []).find(id => String(id) !== String(effectiveUserId))
        : null
      const ownerCounterparty = bounty.accepted_by || readyRecord?.hunter_id || participantFallback
      const hunterCounterparty = bounty.poster_id || bounty.user_id || participantFallback
      
      if (isOwner) {
        return ownerCounterparty ? String(ownerCounterparty) : null
      }

      return hunterCounterparty ? String(hunterCounterparty) : null
    }
    
    const counterpartyId = resolveCounterpartyId()
    console.log('[handleSendMessage] counterpartyId:', counterpartyId)

    let targetConversationId = conversation?.id ? String(conversation.id) : null
    

    if (counterpartyId) {
      try {
        const canonicalConversation = await messageService.getOrCreateConversation(
          [counterpartyId],
          EMPTY_CONVERSATION_NAME,
          String(bounty.id)
        )
        if (canonicalConversation?.id) {
          targetConversationId = String(canonicalConversation.id)
          if (!conversation || String(conversation.id) !== targetConversationId) {
            dispatchUi({ type: 'set', key: 'conversation', value: canonicalConversation })
          }
        }
      } catch (err) {
        console.warn('Failed to resolve canonical conversation for quick message', err)
      }
    }

    if (!targetConversationId) throw new Error('No conversation')
    await messageService.sendMessage(targetConversationId, text, currentUserId)
  }

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    if (minutes < 60) return `${minutes}m ${remainingSeconds}s`
    const hours = Math.floor(minutes / 60)
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  const relativeTime = (iso?: string | null) => {
    if (!iso) return 'just now'
    try {
      const then = new Date(iso).getTime()
      const now = Date.now()
      const delta = Math.floor((now - then) / 1000)
      if (delta < 60) return `${delta}s ago`
      if (delta < 3600) return `${Math.floor(delta / 60)}m ago`
      if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`
      return `${Math.floor(delta / 86400)}d ago`
    } catch {
      Alert.alert('Sign In Required', 'You need to be signed in to submit your work. Please sign in and try again.')
    }
  }

  const handleSubmitCompletion = async () => {
    if (!currentUserId) {
      Alert.alert('Sign In Required', 'Your session is missing. Please sign in again and retry.')
      return
    }

    if (!completionMessage.trim()) {
      Alert.alert('Completion Message Required', 'Please add a message describing your completed work.')
      return
    }

    // Helper for pluralization
    const proofCount = proofItems.length
    const proofLabel = proofCount === 1 ? '1 proof item' : `${proofCount} proof items`

    // Define the actual submission logic
    const performSubmission = async () => {
      try {
        dispatchDraft({ type: 'setSubmitting', value: true })

        // Check for existing pending submission to avoid duplicates
        const existing = await completionService.getSubmission(String(bounty.id))
        if (existing && existing.status === 'pending' && existing.hunter_id === String(currentUserId)) {
          // Already have a pending submission from this hunter — avoid duplicate
          Alert.alert('Submission Pending', 'You already have a pending submission. Please wait for the poster to review or check your submission.')
          dispatchDraft({ type: 'setSubmitting', value: false })
          dispatchUi({ type: 'set', key: 'hasSubmission', value: true })
          return
        }

        const resp = await completionService.submitCompletion({
          bounty_id: String(bounty.id),
          hunter_id: currentUserId,
          message: completionMessage.trim(),
          proof_items: proofItems,
        })

        if (resp) {
          Alert.alert('Submission Successful', 'Your work has been submitted for review!')
          // Lock review UI and show waiting state
          dispatchDraft({ type: 'setSubmissionPending', value: true })
          dispatchUi({ type: 'set', key: 'hasSubmission', value: true })
          // Clear the revision badge on resubmission
          dispatchDraft({ type: 'setRevisionFeedback', text: null })
          dispatchUi({ type: 'set', key: 'reviewExpanded', value: false })
          dispatchUi({ type: 'set', key: 'payoutExpanded', value: true })
          // Trigger parent refresh to update list
          if (onRefresh) onRefresh()
        }
      } catch (err) {
        console.error('Error submitting completion:', err)
        Alert.alert('Error', 'Failed to submit completion. Please try again.')
      } finally {
        dispatchDraft({ type: 'setSubmitting', value: false })
      }
    }

    // Show different confirmation dialogs based on whether proof is attached
    if (proofItems.length === 0) {
      // No proof attached - show warning
      Alert.alert(
        'No Proof Attached',
        'You are submitting without any proof of completion. The poster may request revisions. Are you sure you want to continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit Anyway', style: 'destructive', onPress: performSubmission },
        ]
      )
    } else {
      // Proof attached - show confirmation
      Alert.alert(
        'Confirm Submission',
        `You have attached ${proofLabel}. Are you ready to submit your work for review?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Submit', onPress: performSubmission },
        ]
      )
    }
  }

  // Attachment upload hook for real attachments
  const { pickAttachment, isUploading: isAttUploading, progress: attProgress } = useAttachmentUpload({
    bucket: 'bounty-attachments',
    folder: `bounties/${bounty.id}/proofs`,
    maxSizeMB: 20,
    allowsMultiple: true,
  })

  const handleAddProof = async () => {
    try {
      const uploaded = await pickAttachment()
      if (!uploaded) return

      // pickAttachment returns an array of Attachment items when successful.
      const uploadedArray = Array.isArray(uploaded) ? uploaded : [uploaded]

      // Map each uploaded attachment into our proof item shape and persist
      const newProofs = uploadedArray.map((u) => ({
        id: u.id,
        type: u.mimeType?.startsWith('image/') ? 'image' as const : 'file' as const,
        name: u.name,
        size: u.size,
        remoteUri: u.remoteUri,
        uri: u.uri,
      } as any))

      dispatchDraft({ type: 'addProofs', proofs: newProofs })
    } catch (err) {
      console.error('Error adding proof:', err)
      Alert.alert('Upload failed', 'Could not add proof. Please try again.')
    }
  }

  const handleRemoveProof = (id: string) => {
    dispatchDraft({ type: 'removeProof', id })
  }

  const handleProofPress = (item: ProofDraftItem) => {
    const primaryUri = item.uri || item.remoteUri;
    if (!primaryUri) {
      Alert.alert('Unavailable', 'This attachment is missing a file reference.');
      return;
    }

    const attachment: Attachment = {
      id: item.id,
      name: item.name || 'Attachment',
      uri: primaryUri,
      remoteUri: item.remoteUri,
      mimeType: item.mimeType || (item.type === 'image' ? 'image/jpeg' : undefined),
      mime: item.mimeType || (item.type === 'image' ? 'image/jpeg' : undefined),
      size: item.size,
      status: 'uploaded',
    };

    if (attachment.uri && /^\/\//.test(attachment.uri)) {
      attachment.uri = `https:${attachment.uri}`;
    }

    setSelectedProofItem(attachment);
    setProofViewerVisible(true);
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '0 KB'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const currentStageIndex = useMemo(() => {
    const stageToUse = localStageOverride || currentStage
    return STAGES.findIndex(s => s.id === stageToUse)
  }, [currentStage, localStageOverride])

  const awaitingPosterAction = !isOwner && bounty.status === 'in_progress' && (submissionPending || hasSubmission)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleCancelBounty = () => {
    router.push(`/bounty/${bounty.id}/cancel`)
  }

  const handleViewCancellation = () => {
    router.push(`/bounty/${bounty.id}/cancellation-response`)
  }

  const handleViewDispute = () => {
    // If we have a known active dispute, navigate to detail screen
    if (activeDisputeId) {
      ;(router as any).push(`/dispute/${activeDisputeId}`)
      return
    }

    // When opened from hunter tools inside the in-progress flow, include
    // a `from` query so the dispute screen can route back correctly.
    if (variant === 'hunter') {
      router.push(`/bounty/${bounty.id}/dispute?from=in-progress`) 
      return
    }

    router.push(`/bounty/${bounty.id}/dispute`)
  }

  const handleMessagePoster = async () => {
    let targetConversationId: string | null = null
    try {
      const posterId = bounty.poster_id || bounty.user_id
      if (!posterId) {
        Alert.alert('No Conversation', 'No active conversation found for this bounty yet.')
        return
      }

      const targetConversation = await messageService.getOrCreateConversation([String(posterId)], EMPTY_CONVERSATION_NAME, String(bounty.id))
      targetConversationId = targetConversation?.id ? String(targetConversation.id) : null

      if (!targetConversationId) {
        Alert.alert('Message Failed', 'We could not open or create a conversation. You can try again or compose a new message manually.')
        return
      }

      dispatchUi({ type: 'set', key: 'conversation', value: targetConversation })
      await navigationIntent.setPendingConversationId(targetConversationId)
      router.push('/tabs/bounty-app?screen=messages' as '/tabs/bounty-app')
    } catch (err) {
      console.error('Failed to navigate to messages screen via BountyApp', { conversationId: targetConversationId, error: err })
      if (targetConversationId) {
        console.info('Attempting fallback navigation to direct message route', { conversationId: targetConversationId })
        try {
          ;(router as any).push(`/messages/${encodeURIComponent(targetConversationId)}`)
          return
        } catch (err2) {
          console.error('Fallback direct conversation route failed', err2)
        }
      }
      Alert.alert('Message Failed', 'We could not open or create a conversation. You can try again or compose a new message manually.')
    }
  }

  

  const handleCancelStaleBounty = async (bountyId: number | string) => {
    try {
      const result = await staleBountyService.cancelStaleBounty(bountyId)
      if (result.success) {
        Alert.alert('Success', 'Bounty cancelled successfully. Your funds will be refunded.', [
          { text: 'OK', onPress: () => onRefresh?.() }
        ])
      } else {
        Alert.alert('Error', result.error || 'Failed to cancel bounty')
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred')
    }
  }

  const handleRepostStaleBounty = async (bountyId: number | string) => {
    try {
      const result = await staleBountyService.repostStaleBounty(bountyId)
      if (result.success) {
        Alert.alert('Success', 'Bounty reposted successfully. It is now open for new hunters.', [
          { text: 'OK', onPress: () => onRefresh?.() }
        ])
      } else {
        Alert.alert('Error', result.error || 'Failed to repost bounty')
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred')
    }
  }

  if (hiddenByUser) return null

  return (
    <View>
      <BountyCard
        bounty={bounty}
        currentUserId={currentUserId}
        onPress={() => { if (!isListScrolling) { animate(); onToggle(); } }}
        onEdit={onEdit}
        onDelete={onDelete}
        onCancel={handleCancelBounty}
        onViewCancellation={handleViewCancellation}
        onViewDispute={handleViewDispute}
        revisionRequested={hasRevisionRequested && !isOwner}
        reviewNeeded={hasSubmission && isOwner}
        revisionFeedback={revisionFeedback}
        submittedForReview={awaitingPosterAction}
        hasCancellationRequest={hasCancellationRequest}
        hasDispute={hasDispute}
        otherPartyAvatar={otherPartyAvatar}
        otherPartyName={otherPartyName}
        otherPartyId={variant === 'owner' ? (bounty.accepted_by || readyRecord?.hunter_id) : (bounty.poster_id || bounty.user_id)}
        requestStatus={requestStatus}
        onWithdrawApplication={onWithdrawApplication}
      />
      {/* Tap-to-expand hint — shown only when collapsed */}
      {!expanded && (
        <View style={styles.tapHint}>
          <MaterialIcons name="expand-more" size={14} color="rgba(110, 231, 183, 0.6)" />
          <Text style={styles.tapHintText}>Tap card to see progress & actions</Text>
        </View>
      )}
      {expanded && (
        <View style={styles.panel} onLayout={() => { if (typeof onExpandedLayout === 'function') onExpandedLayout() }}>
          {/* Show stale bounty alert if bounty is stale and user is the owner */}
          {bounty.is_stale && isOwner && (
            <StaleBountyAlert
              bounty={bounty}
              onCancel={handleCancelStaleBounty}
              onRepost={handleRepostStaleBounty}
            />
          )}

          {/* Compact header row mirroring detail card */}
          <View style={styles.panelHeader}>
            <Text style={styles.panelTitle}>Progress</Text>
            {bounty.is_for_honor ? (
              <View style={styles.honorBadge}><MaterialIcons name="favorite" size={14} color="#052e1b" /><Text style={styles.honorBadgeText}>For Honor</Text></View>
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.amount}>${bounty.amount}</Text>
                {variant === 'owner' && readyRecord && (
                  <TouchableOpacity
                    style={styles.readyBadge}
                    onPress={() => dispatchUi({ type: 'set', key: 'showReviewModal', value: true })}
                    accessibilityRole="button"
                    accessibilityLabel={`Hunter ready, opened review modal`}
                  >
                    <MaterialIcons name="hourglass-top" size={14} color="#052e1b" />
                    <Text style={styles.readyBadgeText}>{`Hunter Ready · ${relativeTime(readyRecord.ready_at)}`}</Text>
                  </TouchableOpacity>
                )}
                {isOwner && hasSubmission && (
                  <TouchableOpacity
                    style={styles.headerReviewBtn}
                    onPress={() => dispatchUi({ type: 'set', key: 'showReviewModal', value: true })}
                    accessibilityRole="button"
                    accessibilityLabel="Open review modal"
                  >
                    <MaterialIcons name="rate-review" size={14} color="#052e1b" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>

          {/* Timeline bubbles - using new Stepper component */}
          <Stepper stages={STAGES} activeIndex={currentStageIndex} variant="compact" />

          {/* Pre-acceptance info when open */}
          {bounty.status === 'open' && (
            <View style={styles.infoBox}>
              <MaterialIcons name="hourglass-empty" size={18} color="#6ee7b7" />
              {isOwner ? (
                <Text style={styles.infoText}>Awaiting a hunter. Review requests in the Requests tab.</Text>
              ) : (
                <Text style={styles.infoText}>Your application is pending. We’ll notify you when the poster accepts.</Text>
              )}
            </View>
          )}

          {/* Work in Progress section - only when in_progress status */}
          {bounty.status === 'in_progress' && (
            <AnimatedSection
              title="Work in progress"
              expanded={wipExpanded}
              onToggle={() => {
                // If the flow has been advanced (locked), prevent toggling WIP
                if (readyToSubmitPressed || !!readyRecord) return
                dispatchUi({ type: 'set', key: 'wipExpanded', value: !wipExpanded })
              }}
              locked={readyToSubmitPressed || !!readyRecord}
            >
              {isOwner ? (
                <View style={{ gap: 16 }}>
                  {/* Poster view: Message bar, attachments, rating */}

                  {/* Show review button if submission is pending */}
                  {hasSubmission && (
                    <TouchableOpacity
                      style={styles.reviewSubmissionBtn}
                      onPress={() => dispatchUi({ type: 'set', key: 'showReviewModal', value: true })}
                    >
                      <MaterialIcons name="rate-review" size={20} color="#fff" />
                      <Text style={styles.reviewSubmissionText}>Review Submission</Text>
                    </TouchableOpacity>
                  )}

                  {conversation && (
                    <MessageBar
                      conversationId={conversation.id}
                      onSendMessage={handleSendMessage}
                      placeholder="Send a quick message to the hunter..."
                    />
                  )}

                  <AttachmentsList attachments={attachments} />

                  <RatingStars
                    rating={ratingDraft}
                    onRatingChange={(v) => dispatchUi({ type: 'set', key: 'ratingDraft', value: v })}
                    label="Rate This Bounty:"
                  />
                  {/* Poster Flow Tools - message hunter, raise/view dispute */}
                  <View style={styles.posterToolsSection}>
                    <TouchableOpacity
                      style={styles.posterToolsToggle}
                      onPress={() => dispatchUi({ type: 'set', key: 'posterToolsExpanded', value: !posterToolsExpanded })}
                      accessibilityRole="button"
                      accessibilityLabel="Poster flow tools"
                      accessibilityHint="Opens quick tools including dispute and message actions"
                    >
                      <View style={styles.posterToolsToggleLeft}>
                        <MaterialIcons name="gavel" size={18} color="#a7f3d0" />
                        <Text style={styles.posterToolsToggleText}>Poster Flow Tools</Text>
                      </View>
                      <MaterialIcons name={posterToolsExpanded ? 'expand-less' : 'expand-more'} size={20} color="#a7f3d0" />
                    </TouchableOpacity>

                    {posterToolsExpanded && (
                      <View style={styles.posterToolsMenu}>
                        <TouchableOpacity style={styles.hunterToolBtnDanger} onPress={
                          hasDispute ? handleViewDispute : () => dispatchUi({ type: 'set', key: 'showDisputeModal', value: true })
                        }>
                          <MaterialIcons name={hasDispute ? 'gavel' : 'report-problem'} size={18} color={hasDispute ? '#f59e0b' : '#fca5a5'} />
                          <Text style={hasDispute ? styles.hunterToolTextWarning : styles.hunterToolTextDanger}>
                            {hasDispute ? 'View Dispute' : 'Raise Dispute'}
                          </Text>
                        </TouchableOpacity>

                        {/* Workflow Dispute Modal for poster */}
                        <WorkflowDisputeModal
                          visible={showDisputeModal}
                          bountyId={String(bounty.id)}
                          bountyTitle={bounty.title}
                          initiatorId={currentUserId || ''}
                          respondentId={String(bounty.accepted_by || (readyRecord ? readyRecord.hunter_id : ''))}
                          stage={bounty.status === 'in_progress' ? 'in_progress' : 'review_verify'}
                          onClose={() => dispatchUi({ type: 'set', key: 'showDisputeModal', value: false })}
                          onDisputeCreated={(disputeId) => {
                            dispatchUi({ type: 'set', key: 'showDisputeModal', value: false })
                            dispatchUi({ type: 'set', key: 'hasDispute', value: true })
                            dispatchUi({ type: 'set', key: 'activeDisputeId', value: disputeId })
                            Alert.alert('Dispute Filed', 'Your dispute has been submitted.', [
                              { text: 'View', onPress: () => (router as any).push(`/dispute/${disputeId}`) },
                              { text: 'OK' },
                            ])
                          }}
                        />
                      </View>
                    )}
                  </View>
                </View>
              ) : (
                <View style={{ gap: 16 }}>
                  {/* Hunter view: Instructions, attachments, next button */}

                  {/* Show revision feedback banner if present */}
                  {showRevisionBanner && revisionFeedback && (
                    <RevisionFeedbackBanner
                      feedback={revisionFeedback}
                      onDismiss={() => dispatchUi({ type: 'set', key: 'showRevisionBanner', value: false })}
                      showDismiss={true}
                    />
                  )}

                  <View style={styles.infoBox}>
                    <MaterialIcons name="info-outline" size={18} color="#6ee7b7" />
                    <Text style={styles.infoText}>
                      Congrats on being selected! Begin work on the bounty, money is in escrow; once complete press the next button.
                    </Text>
                  </View>

                  <AttachmentsList attachments={attachments} />

                  <TouchableOpacity
                    style={[styles.primaryBtn, (readyToSubmitPressed || !!readyRecord) && styles.buttonDisabled]}
                    onPress={async () => {
                      if (!currentUserId) {
                        Alert.alert('Sign In Required', 'Your session is missing. Please sign in again and retry.')
                        return
                      }

                      const confirmAndMarkReady = async () => {
                        // Persist ready state and advance UI
                        const ok = await completionService.markReady(String(bounty.id), currentUserId)
                        if (ok) {
                          dispatchUi({ type: 'set', key: 'readyToSubmitPressed', value: true })
                          dispatchUi({ type: 'set', key: 'wipExpanded', value: false })
                          dispatchUi({ type: 'set', key: 'reviewExpanded', value: true })
                          dispatchUi({ type: 'set', key: 'localStageOverride', value: 'review_verify' })
                          // update local readyRecord optimistically
                          const now = new Date().toISOString()
                          const rec = { bounty_id: String(bounty.id), hunter_id: currentUserId, ready_at: now }
                          dispatchDraft({ type: 'setReadyRecord', record: rec })
                          // Trigger parent refresh to update list
                          if (onRefresh) onRefresh()
                        } else {
                          Alert.alert('Error', 'Failed to mark Ready. Please try again.')
                        }
                      }

                      Alert.alert(
                        'Confirm Ready',
                        'Are you sure you are ready to submit your work for review? This will lock the Work in Progress section.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Ready', onPress: confirmAndMarkReady }
                        ]
                      )
                    }}
                    disabled={readyToSubmitPressed || !!readyRecord}
                  >
                    <Text style={styles.primaryText}>Ready to Submit</Text>
                    <MaterialIcons name={(readyToSubmitPressed || !!readyRecord) ? 'lock' : 'arrow-forward'} size={18} color="#fff" />
                  </TouchableOpacity>

                  <View style={styles.hunterToolsSection}>
                    <TouchableOpacity
                      style={styles.hunterToolsToggle}
                      onPress={() => dispatchUi({ type: 'set', key: 'hunterToolsExpanded', value: !hunterToolsExpanded })}
                      accessibilityRole="button"
                      accessibilityLabel="Hunter flow tools"
                      accessibilityHint="Opens quick tools including dispute and message actions"
                    >
                      <View style={styles.hunterToolsToggleLeft}>
                        <MaterialIcons name="build-circle" size={18} color="#a7f3d0" />
                        <Text style={styles.hunterToolsToggleText}>Hunter Flow Tools</Text>
                      </View>
                      <MaterialIcons name={hunterToolsExpanded ? 'expand-less' : 'expand-more'} size={20} color="#a7f3d0" />
                    </TouchableOpacity>

                    {hunterToolsExpanded && (
                      <View style={styles.hunterToolsMenu}>
                        <TouchableOpacity style={styles.hunterToolBtn} onPress={handleMessagePoster}>
                          <MaterialIcons name="chat" size={18} color="#6ee7b7" />
                          <Text style={styles.hunterToolText}>Message Poster</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.hunterToolBtnDanger} onPress={
                          hasDispute ? handleViewDispute : () => dispatchUi({ type: 'set', key: 'showDisputeModal', value: true })
                        }>
                          <MaterialIcons name={hasDispute ? 'gavel' : 'report-problem'} size={18} color={hasDispute ? '#f59e0b' : '#fca5a5'} />
                          <Text style={hasDispute ? styles.hunterToolTextWarning : styles.hunterToolTextDanger}>
                            {hasDispute ? 'View Dispute' : 'Raise Dispute'}
                          </Text>
                        </TouchableOpacity>

                        {/* Workflow Dispute Modal */}
                        <WorkflowDisputeModal
                          visible={showDisputeModal}
                          bountyId={String(bounty.id)}
                          bountyTitle={bounty.title}
                          initiatorId={currentUserId || ''}
                          respondentId={String(
                            variant === 'hunter'
                              ? (bounty.poster_id || bounty.user_id)
                              : bounty.accepted_by || ''
                          )}
                          stage={bounty.status === 'in_progress' ? 'in_progress' : 'review_verify'}
                          onClose={() => dispatchUi({ type: 'set', key: 'showDisputeModal', value: false })}
                          onDisputeCreated={(disputeId) => {
                            dispatchUi({ type: 'set', key: 'showDisputeModal', value: false })
                            dispatchUi({ type: 'set', key: 'hasDispute', value: true })
                            dispatchUi({ type: 'set', key: 'activeDisputeId', value: disputeId })
                            Alert.alert('Dispute Filed', 'Your dispute has been submitted.', [
                              { text: 'View', onPress: () => (router as any).push(`/dispute/${disputeId}`) },
                              { text: 'OK' },
                            ])
                          }}
                        />

                        
                      </View>
                    )}
                  </View>
                </View>
              )}
            </AnimatedSection>
          )}

          {/* Poster Review & Verify Section - when hunter has submitted */}
          {isOwner && bounty.status === 'in_progress' && hasSubmission && (
            <AnimatedSection
              title="Review & Verify"
              expanded={reviewExpanded}
              onToggle={() => dispatchUi({ type: 'set', key: 'reviewExpanded', value: !reviewExpanded })}
            >
              <View style={{ gap: 16 }}>
                <View style={styles.infoBox}>
                  <MaterialIcons name="rate-review" size={18} color="#6ee7b7" />
                  <Text style={styles.infoText}>
                    The hunter has submitted their work for review. Review the submission and approve or request changes.
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.reviewSubmissionBtn}
                  onPress={() => dispatchUi({ type: 'set', key: 'showReviewModal', value: true })}
                >
                  <MaterialIcons name="rate-review" size={20} color="#fff" />
                  <Text style={styles.reviewSubmissionText}>Review Submission</Text>
                </TouchableOpacity>
                {/* Full review screen removed (legacy) - keep modal only */}
              </View>
            </AnimatedSection>
          )}

          {/* Hunter Review & Verify Section - when ready to submit */}
          {!isOwner && bounty.status === 'in_progress' && (
            <AnimatedSection
              title="Review & Verify"
              expanded={reviewExpanded}
              onToggle={() => {
                // Prevent toggling open unless readyToSubmitPressed or a readyRecord exists or there's no pending submission
                if (!readyToSubmitPressed && !readyRecord) return
                if (submissionPending || hasSubmission) return
                dispatchUi({ type: 'set', key: 'reviewExpanded', value: !reviewExpanded })
              }}
              locked={!readyToSubmitPressed && !readyRecord || submissionPending || hasSubmission}
            >
              <View style={{ gap: 16 }}>
                {/* If a submission is pending, show waiting state */}
                {(submissionPending || hasSubmission) ? (
                  <View style={styles.infoBox}>
                    <MaterialIcons name="hourglass-top" size={18} color="#6ee7b7" />
                    <Text style={styles.infoText}>Waiting for poster to review your submission.</Text>
                  </View>
                ) : (
                  <>
                    {/* Message Input */}
                    <View>
                      <Text style={styles.sectionTitle}>Message (cont):</Text>
                      <TextInput
                        style={styles.messageTextArea}
                        placeholder="Describe your completed work..."
                        placeholderTextColor="rgba(255,254,245,0.4)"
                        value={completionMessage}
                        onChangeText={(t) => dispatchDraft({ type: 'setMessage', message: t })}
                        multiline
                        numberOfLines={4}
                        maxLength={1000}
                        textAlignVertical="top"
                      />
                    </View>

                    {/* Proof Attachments */}
                    <View>
                      <Text style={styles.sectionTitle}>Proof:</Text>
                      {proofItems.map((item) => (
                        <TouchableOpacity
                          key={item.id}
                          style={styles.proofItem}
                          onPress={() => handleProofPress(item)}
                          accessibilityRole="button"
                          accessibilityLabel={`View attachment ${item.name}`}
                        >
                          <View style={styles.proofIcon}>
                            <MaterialIcons
                              name={item.type === 'image' ? 'image' : 'insert-drive-file'}
                              size={24}
                              color="#6ee7b7"
                            />
                          </View>
                          <View style={styles.proofInfo}>
                            <Text style={styles.proofName}>{item.name}</Text>
                            <Text style={styles.proofSize}>{formatFileSize(item.size)}</Text>
                          </View>
                          <TouchableOpacity onPress={() => handleRemoveProof(item.id)}>
                            <MaterialIcons name="close" size={20} color="#ef4444" />
                          </TouchableOpacity>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity
                        style={[styles.addFileBtn, !(readyToSubmitPressed || !!readyRecord) && styles.buttonDisabled]}
                        onPress={handleAddProof}
                        disabled={!(readyToSubmitPressed || !!readyRecord)}
                      >
                        <MaterialIcons name={(readyToSubmitPressed || !!readyRecord) ? 'add' : 'lock'} size={20} color="#10b981" />
                        <Text style={styles.addFileText}>{(readyToSubmitPressed || !!readyRecord) ? 'Add File' : 'Locked'}</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Submit Button */}
                    <TouchableOpacity
                      style={[styles.primaryBtn, isSubmitting && styles.buttonDisabled]}
                      onPress={handleSubmitCompletion}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.primaryText}>Submit</Text>
                      )}
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </AnimatedSection>
          )}

          {/* Payout Section - when completed */}
          {bounty.status === 'completed' && (
            <AnimatedSection
              title="Payout"
              expanded={payoutExpanded}
              onToggle={() => dispatchUi({ type: 'set', key: 'payoutExpanded', value: !payoutExpanded })}
            >
              <View style={{ gap: 16 }}>
                {/* Success Message */}
                <View style={styles.successPanel}>
                  <MaterialIcons name="check-circle" size={48} color="#10b981" />
                  <Text style={styles.successTitle}>Payout Released!</Text>
                  <Text style={styles.successText}>
                    {isOwner
                      ? 'You have approved the work and released payment.'
                      : 'Congratulations! The poster has approved your work and released the payment.'}
                  </Text>

                  {!bounty.is_for_honor && (
                    <View style={styles.payoutAmountCard}>
                      <Text style={styles.payoutLabel}>Payout Amount</Text>
                      <Text style={styles.payoutAmount}>${bounty.amount}</Text>
                      <Text style={styles.payoutSubtext}>
                        {isOwner ? 'Released from escrow' : 'Added to your wallet balance'}
                      </Text>
                    </View>
                  )}

                  {bounty.is_for_honor && (
                    <View style={styles.honorCard}>
                      <MaterialIcons name="favorite" size={32} color="#ec4899" />
                      <Text style={styles.honorTitle}>Completed for Honor</Text>
                      <Text style={styles.honorCardText}>
                        Thank you for contributing to the community!
                      </Text>
                    </View>
                  )}
                </View>

                {/* Transaction Receipt */}
                {!bounty.is_for_honor && (
                  <View style={styles.receiptCard}>
                    <View style={styles.receiptHeader}>
                      <MaterialIcons name="receipt" size={24} color="#6ee7b7" />
                      <Text style={styles.receiptTitle}>Transaction Receipt</Text>
                    </View>
                    <View style={styles.receiptDivider} />
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Bounty</Text>
                      <Text style={styles.receiptValue}>{bounty.title}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Amount</Text>
                      <Text style={styles.receiptValue}>${bounty.amount}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Date</Text>
                      <Text style={styles.receiptValue}>{new Date().toLocaleDateString()}</Text>
                    </View>
                    <View style={styles.receiptRow}>
                      <Text style={styles.receiptLabel}>Status</Text>
                      <View style={styles.statusPill}>
                        <MaterialIcons name="check-circle" size={16} color="#10b981" />
                        <Text style={styles.statusPillText}>Completed</Text>
                      </View>
                    </View>
                  </View>
                )}

                  {/* Archive / Delete actions for completed bounties */}
                  <View style={styles.actionsContainer}>
                    {isOwner ? (
                      <>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.archiveButton]}
                          onPress={async () => {
                            if (!bounty) return
                            Alert.alert(
                              'Archive Bounty',
                              'Archive this bounty so it is hidden from active listings but retained in your history?',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Archive',
                                  onPress: async () => {
                                    try {
                                      setIsProcessing(true)
                                      const updated = await bountyService.update(String(bounty.id), { status: 'archived' })
                                      if (!updated) throw new Error('Failed to archive bounty')
                                      Alert.alert('Archived', 'Bounty archived successfully.')
                                      onRefresh?.()
                                    } catch (err) {
                                      console.error('Error archiving bounty:', err)
                                      Alert.alert('Error', 'Failed to archive bounty. Please try again.')
                                    } finally {
                                      setIsProcessing(false)
                                    }
                                  }
                                }
                              ]
                            )
                          }}
                          disabled={isProcessing}
                        >
                          <MaterialIcons name="archive" size={20} color="#fff" />
                          <Text style={styles.actionButtonText}>Archive</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionButton, styles.deleteButton]}
                          onPress={async () => {
                            if (!bounty) return
                            Alert.alert(
                              'Delete Bounty',
                              'Permanently delete this bounty from active lists? It will remain in your history. This cannot be undone.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Delete',
                                  style: 'destructive',
                                  onPress: async () => {
                                    try {
                                      setIsProcessing(true)
                                      const updated = await bountyService.update(String(bounty.id), { status: 'deleted' })
                                      if (!updated) throw new Error('Failed to delete bounty')
                                      Alert.alert('Deleted', 'Bounty deleted and removed from active lists.')
                                      onRefresh?.()
                                    } catch (err) {
                                      console.error('Error deleting bounty:', err)
                                      Alert.alert('Error', 'Failed to delete bounty. Please try again.')
                                    } finally {
                                      setIsProcessing(false)
                                    }
                                  }
                                }
                              ]
                            )
                          }}
                          disabled={isProcessing}
                        >
                          <MaterialIcons name="delete" size={20} color="#fff" />
                          <Text style={styles.actionButtonText}>Delete</Text>
                        </TouchableOpacity>
                      </>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[styles.actionButton, styles.archiveButton]}
                          onPress={() => {
                            Alert.alert(
                              'Hide Bounty',
                              'Hide this bounty from your view? This will not affect the poster or other users.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Hide',
                                  onPress: () => {
                                    setHiddenByUser(true)
                                    onRefresh?.()
                                  }
                                }
                              ]
                            )
                          }}
                        >
                          <MaterialIcons name="bookmark-remove" size={20} color="#fff" />
                          <Text style={styles.actionButtonText}>Hide</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.actionButton, styles.deleteButton]}
                          onPress={() => {
                            Alert.alert(
                              'Remove from List',
                              'Remove this bounty from your local list? This does not delete the bounty for the owner.',
                              [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Remove',
                                  style: 'destructive',
                                  onPress: () => {
                                    setHiddenByUser(true)
                                    onRefresh?.()
                                  }
                                }
                              ]
                            )
                          }}
                        >
                          <MaterialIcons name="close" size={20} color="#fff" />
                          <Text style={styles.actionButtonText}>Remove</Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </View>
              </View>
            </AnimatedSection>
          )}

          {/* Conversation hint - only show when status is 'open', not when in_progress since bounty has already been accepted */}
          {!conversation && bounty.status === 'open' && (
            <View style={styles.infoBox}>
              <MaterialIcons name="chat-bubble-outline" size={18} color="#6ee7b7" />
              <Text style={styles.infoText}>{isOwner ? 'Conversation will appear after acceptance.' : 'A chat with the poster will appear once you’re accepted.'}</Text>
            </View>
          )}
        </View>
      )}

      {/* Poster Review Modal */}
      {isOwner && (
        <PosterReviewModal
          visible={showReviewModal}
          bountyId={String(bounty.id)}
          hunterId={bounty.accepted_by || readyRecord?.hunter_id || ''}
          hunterName={hunterName}
          bountyAmount={bounty.amount || 0}
          isForHonor={bounty.is_for_honor || false}
          onClose={() => dispatchUi({ type: 'set', key: 'showReviewModal', value: false })}
          onComplete={() => {
            dispatchUi({ type: 'set', key: 'showReviewModal', value: false })
            dispatchUi({ type: 'set', key: 'hasSubmission', value: false })
            // Trigger refresh
            if (onRefresh) onRefresh()
          }}
        />
      )}

      {/* Proof Viewer Modal */}
      <AttachmentViewerModal
        visible={proofViewerVisible}
        attachment={selectedProofItem}
        onClose={() => {
          setProofViewerVisible(false)
          setSelectedProofItem(null)
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: 'rgba(5, 150, 105, 0.25)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    marginTop: -8,
    marginBottom: 12,
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  panelTitle: { color: '#fff', fontWeight: '700' },
  amount: { color: '#fff', fontWeight: '800' },
  timelineRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  timelineItem: { flexDirection: 'row', alignItems: 'center' },
  bubble: { width: 12, height: 12, borderRadius: 6 },
  bubbleIdle: { backgroundColor: 'rgba(110,231,183,0.3)' },
  bubbleActive: { backgroundColor: '#10b981' },
  bubbleCompleted: { backgroundColor: '#059669' },
  connector: { width: 18, height: 2, backgroundColor: 'rgba(110,231,183,0.35)', marginHorizontal: 6 },
  infoBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(5, 46, 27, 0.35)', padding: 10, borderRadius: 8, marginBottom: 8 },
  infoText: { color: '#d1fae5', fontSize: 12, flex: 1 },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#10b981', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  primaryText: { color: '#fff', fontWeight: '600' },
  muted: { color: '#a7f3d0', fontSize: 12 },
  honorBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#a7f3d0', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, gap: 4 },
  honorBadgeText: { color: '#052e1b', fontWeight: '800', fontSize: 12 },
  reviewSubmissionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#fbbf24',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  reviewSubmissionText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 20,
    gap: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
  },
  timerLabel: {
    color: '#6ee7b7',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: '#fff',
    fontSize: 48,
    fontWeight: '700',
  },
  timerHint: {
    color: 'rgba(255,254,245,0.6)',
    fontSize: 11,
  },
  messageTextArea: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    color: '#fff',
    fontSize: 14,
    minHeight: 100,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  proofItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
    marginBottom: 8,
  },
  proofIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  proofInfo: {
    flex: 1,
    gap: 4,
  },
  proofName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  proofSize: {
    color: '#6ee7b7',
    fontSize: 12,
  },
  sectionTitle: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 6,
  },
  addFileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#10b981',
    borderStyle: 'dashed',
  },
  addFileText: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  successPanel: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  successTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '600',
  },
  successText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  payoutAmountCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.2)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  payoutLabel: {
    color: '#6ee7b7',
    fontSize: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  payoutAmount: {
    color: '#10b981',
    fontSize: 32,
    fontWeight: '700',
  },
  payoutSubtext: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 12,
  },
  honorCard: {
    backgroundColor: 'rgba(236, 72, 153, 0.15)',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginTop: 12,
    width: '100%',
  },
  honorTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  honorCardText: {
    color: 'rgba(255,254,245,0.8)',
    fontSize: 14,
    textAlign: 'center',
  },
  receiptCard: {
    backgroundColor: 'rgba(5, 150, 105, 0.1)',
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  receiptTitle: {
    color: '#6ee7b7',
    fontSize: 16,
    fontWeight: '600',
  },
  receiptDivider: {
    height: 1,
    backgroundColor: 'rgba(110, 231, 183, 0.2)',
  },
  receiptRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  receiptLabel: {
    color: 'rgba(255,254,245,0.7)',
    fontSize: 14,
  },
  receiptValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    color: '#10b981',
    fontSize: 12,
    fontWeight: '600',
  },
  readyBadge: {
    backgroundColor: '#d1fae5',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  readyBadgeText: {
    color: '#052e1b',
    fontSize: 12,
    marginLeft: 6,
    fontWeight: '600',
  },
  headerReviewBtn: {
    marginLeft: 8,
    backgroundColor: 'rgba(167,243,208,0.9)',
    padding: 6,
    borderRadius: 8,
  },
  withdrawButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  withdrawButtonText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    // Sits in the gap below the card, above the next item
    paddingTop: 2,
    paddingBottom: 6,
  },
  tapHintText: {
    color: 'rgba(110, 231, 183, 0.5)',
    fontSize: 11,
  },
  hunterToolsSection: {
    marginTop: 2,
    gap: 8,
  },
  hunterToolsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5, 46, 27, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.35)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  hunterToolsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hunterToolsToggleText: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '700',
  },
  hunterToolsMenu: {
    backgroundColor: 'rgba(5, 46, 27, 0.45)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.25)',
    padding: 10,
    gap: 8,
  },
  hunterToolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(5, 150, 105, 0.25)',
  },
  hunterToolBtnDanger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  hunterToolText: {
    color: '#d1fae5',
    fontSize: 13,
    fontWeight: '600',
  },
  hunterToolTextDanger: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '500',
  },
  hunterToolTextWarning: {
    color: '#f59e0b',
    fontSize: 14,
    fontWeight: '500',
  },
  posterToolsSection: {
    marginTop: 2,
    gap: 8,
  },
  posterToolsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(5, 46, 27, 0.5)',
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.35)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  posterToolsToggleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  posterToolsToggleText: {
    color: '#a7f3d0',
    fontSize: 13,
    fontWeight: '700',
  },
  posterToolsMenu: {
    backgroundColor: 'rgba(5, 46, 27, 0.45)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(110, 231, 183, 0.25)',
    padding: 10,
    gap: 8,
  },
  actionsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
    justifyContent: 'space-between',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  archiveButton: {
    backgroundColor: '#059669',
  },
  deleteButton: {
    backgroundColor: '#ef4444',
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
})
