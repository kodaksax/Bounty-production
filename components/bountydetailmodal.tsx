import MaterialIcons from "@expo/vector-icons/MaterialIcons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import { useRouter } from "expo-router"
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { formatCategoryLabel } from 'lib/utils/data-utils'
import { formatScheduleDescription } from 'lib/utils/schedule-utils'
import { shareBounty } from "lib/utils/share-utils"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native"
import { useAuthContext } from "../hooks/use-auth-context"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { useHapticFeedback } from '../lib/haptic-feedback'
import { bountyRequestService } from "../lib/services/bounty-request-service"
import { bountyService } from '../lib/services/bounty-service'
import { markHunterActivated } from '../lib/analytics/lifecycle'
import { analyticsService } from '../lib/services/analytics-service'
import type { AttachmentMeta } from '../lib/services/database.types'
import { storageService } from '../lib/services/storage-service'
import type { BountyScheduleType, Message } from '../lib/types'
import { AttachmentViewerModal } from './attachment-viewer-modal'
import { ReportModal } from "./ReportModal"
import { AppModal } from './ui/app-modal'
import { useKeyboardInset } from './ui/keyboard-avoiding'

// Alert defer delay to allow React to process state updates before showing alert
const ALERT_DEFER_DELAY = 100;

// Breathing room kept between the card and the top of the keyboard.
const CARD_KEYBOARD_MARGIN = 24;

// Type for detail rows in Additional Details section
interface DetailRow {
  icon: 'schedule' | 'build' | 'place' | 'access-time';
  color: string;
  label: string;
  value: string;
  urgent?: boolean;
}

interface BountyDetailModalProps {
  bounty: {
    id: string | number
    username?: string
    title: string
    price: number
    distance: number | null
    description?: string
    user_id?: string | null
    poster_id?: string | null
    work_type?: 'online' | 'in_person'
    attachments?: AttachmentMeta[]
    attachments_json?: string
    poster_avatar?: string
    /**
     * Legacy free-text schedule field. The current post flow no longer collects
     * it (it always writes ''), so only pre-rewrite rows have a value — the
     * structured `schedule_*` fields below are the live source of timing info.
     */
    timeline?: string
    schedule_type?: BountyScheduleType | null
    start_date?: string | null
    end_date?: string | null
    latest_arrival_time?: string | null
    duration_minutes?: number | null
    conditional_end_note?: string | null
    skills_required?: string
    location?: string
    is_time_sensitive?: boolean
    deadline?: string
    status?: string
    is_for_honor?: boolean
  }
  onClose: () => void
  onNavigateToChat?: (conversationId: string) => void
}

export function BountyDetailModal({ bounty: initialBounty, onClose, onNavigateToChat }: BountyDetailModalProps) {
  const router = useRouter()
  const { isEmailVerified, session } = useAuthContext()
  const currentUserId = session?.user?.id ?? null
  const { triggerHaptic } = useHapticFeedback()
  const { theme } = useAppThemeContext()
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [visible, setVisible] = useState(true)
  const [isApplying, setIsApplying] = useState(false)
  const [hasApplied, setHasApplied] = useState(false)
  const [showReportModal, setShowReportModal] = useState(false)
  const [applicationMessage, setApplicationMessage] = useState('')
  const messagesEndRef = useRef<ScrollView>(null)
  const modalRef = useRef<View>(null)
  // Local state to hold a fuller bounty object if we need to fetch details
  const [detailBounty, setDetailBounty] = useState<typeof initialBounty | null>(initialBounty as any)

  // Effective bounty used through the component (prefer fetched detail)
  const bounty = detailBounty || initialBounty

  // Resolve poster identity - prefer poster_id, fall back to user_id for compatibility
  const [displayUsername, setDisplayUsername] = useState<string>(bounty.username || 'Loading...')
  const posterId = bounty.poster_id || bounty.user_id
  const { profile: normalizedPoster, loading: profileLoading } = useNormalizedProfile(posterId ? String(posterId) : undefined)
  const [actualAttachments, setActualAttachments] = useState<AttachmentMeta[]>([])
  const [isLoadingAttachments, setIsLoadingAttachments] = useState(false)
  const [viewerAttachment, setViewerAttachment] = useState<AttachmentMeta | null>(null)
  const [viewerVisible, setViewerVisible] = useState(false)
  const imageScrollRef = useRef<ScrollView>(null)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [carouselWidth, setCarouselWidth] = useState(0)

  // Track mounted state to prevent showing alerts after unmount
  const isMountedRef = useRef(true)
  // Store timeout IDs for cleanup
  const alertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Anchor for bounty_claim_submitted's seconds_from_view_to_submit — this
  // modal only mounts while the user is looking at the detail view, so its
  // own mount time is a direct proxy for "when they started viewing."
  const viewedAtRef = useRef(Date.now())

  // bounty_viewed fires exactly once per modal open (guarded by this ref,
  // since Effect A below can re-run if the parent re-renders with a new
  // `bounty` object literal while the modal stays open). Fired with whatever
  // data is available once the detail-fetch (if any) has settled, so
  // category/created_at are populated when the initial payload lacked them.
  const viewFiredRef = useRef(false)
  const fireBountyViewed = (b: typeof initialBounty & { category?: string; created_at?: string }) => {
    if (viewFiredRef.current) return
    viewFiredRef.current = true
    const posterIdForView = b.poster_id || b.user_id
    const secondsSincePosted = b.created_at
      ? Math.max(0, Math.round((Date.now() - new Date(b.created_at).getTime()) / 1000))
      : undefined
    analyticsService.trackEvent('bounty_viewed', {
      bounty_id: String(b.id),
      is_own_bounty: currentUserId != null && posterIdForView != null && String(currentUserId) === String(posterIdForView),
      amount: typeof b.price === 'number' ? b.price : undefined,
      is_for_honor: Boolean(b.is_for_honor),
      category: b.category,
      distance_miles: b.distance ?? undefined,
      seconds_since_posted: secondsSincePosted,
      surface: 'modal',
    })
  }

  useEffect(() => {
    // Resolution priority: bounty.username -> normalizedPoster.username -> 'Loading...' -> 'Anonymous'
    // Never fall back to the current user's profile
    if (bounty.username) {
      setDisplayUsername(bounty.username)
      return
    }

    if (normalizedPoster?.username) {
      setDisplayUsername(normalizedPoster.username)
      return
    }

    // Show 'Anonymous' if we're done loading and still no username
    if (!profileLoading) {
      // Debug: log when we can't resolve a username
      if (posterId) {
      }
      setDisplayUsername('Anonymous')
    } else {
      setDisplayUsername('Loading...')
    }
  }, [bounty.username, normalizedPoster?.username, profileLoading, bounty.user_id, normalizedPoster])

  // Separate effects: 1) fetch/merge full bounty when initial payload is lightweight
  // 2) parse attachments from the currently-active bounty (detailBounty || initialBounty)

  // Effect A: fetch full bounty details when initial payload lacks optional fields
  useEffect(() => {
    let mounted = true

    // `timeline` is intentionally not part of this check: the post flow always
    // writes '', so testing it would force a refetch for every bounty.
    const shouldFetchDetail = !!initialBounty?.id && (
      !initialBounty?.schedule_type || !initialBounty?.skills_required || !initialBounty?.location || (!initialBounty?.attachments && !initialBounty?.attachments_json)
    )

    if (!shouldFetchDetail) {
      fireBountyViewed(initialBounty)
      return () => { mounted = false }
    }

      ; (async () => {
        if (!mounted) return
        setIsLoadingAttachments(true)
        try {
          const full = await bountyService.getById(initialBounty.id)
          if (mounted && full) {
            // Merge - prefer fields already present in initialBounty when available
            const merged = { ...initialBounty, ...full } as any
            setDetailBounty(merged)
            fireBountyViewed(merged)
          } else if (mounted) {
            fireBountyViewed(initialBounty)
          }
        } catch (e) {
          console.error('Failed to fetch bounty details for modal:', e)
          if (mounted) fireBountyViewed(initialBounty)
        } finally {
          if (mounted) setIsLoadingAttachments(false)
        }
      })()

    return () => { mounted = false }
  }, [initialBounty])

  // Effect B: parse attachments anytime the active bounty changes (detailBounty preferred)
  useEffect(() => {
    let mounted = true

    const active = detailBounty || initialBounty
    try {
      if (active?.attachments && (active as any).attachments.length > 0) {
        if (mounted) setActualAttachments((active as any).attachments)
        return
      }

      if (active?.attachments_json) {
        try {
          // Supabase may return jsonb columns already parsed as arrays/objects.
          // Handle string, array, and object cases defensively.
          let parsed: AttachmentMeta[] = []
          const raw = (active as any).attachments_json
          if (typeof raw === 'string') {
            parsed = JSON.parse(raw) as AttachmentMeta[]
          } else if (Array.isArray(raw)) {
            parsed = raw as AttachmentMeta[]
          } else if (raw && typeof raw === 'object') {
            // Could be an object that represents an array-like structure
            // but in practice Supabase will return an array for jsonb; treat as any
            parsed = raw as AttachmentMeta[]
          }

          if (mounted) setActualAttachments(parsed || [])
          return
        } catch (err) {
          console.error('Error parsing attachments_json from active bounty:', err)
        }
      }

      if (mounted) setActualAttachments([])
    } catch (error) {
      console.error('Error loading attachments for active bounty:', error)
      if (mounted) setActualAttachments([])
    }

    return () => { mounted = false }
  }, [detailBounty, initialBounty])

  // Cleanup effect: clear timeouts and mark as unmounted
  useEffect(() => {
    return () => {
      isMountedRef.current = false
      if (alertTimeoutRef.current) {
        clearTimeout(alertTimeoutRef.current)
        alertTimeoutRef.current = null
      }
    }
  }, [])

  // Empty/whitespace-only descriptions hide the whole section (header included)
  // rather than rendering a bare "Description" heading over nothing.
  const description = bounty.description?.trim() || ""

  // Timing shown in Additional Details. The post flow writes the structured
  // schedule_* columns, so those win; `timeline` is only a fallback for legacy
  // rows created before the flow was rewritten (new rows always store '').
  const scheduleSummary = useMemo(() => {
    if (bounty.schedule_type) {
      const summary = formatScheduleDescription({
        type: bounty.schedule_type,
        startDate: bounty.start_date ?? undefined,
        endDate: bounty.end_date ?? undefined,
        latestArrivalTime: bounty.latest_arrival_time ?? undefined,
        durationMinutes: bounty.duration_minutes ?? undefined,
        conditionalEndNote: bounty.conditional_end_note ?? undefined,
      })
      // formatScheduleDescription returns this sentinel when nothing resolved;
      // treat it as "no schedule" so we fall through rather than print it.
      if (summary && summary !== 'No schedule set') return summary
    }
    return bounty.timeline?.trim() || null
  }, [
    bounty.schedule_type,
    bounty.start_date,
    bounty.end_date,
    bounty.latest_arrival_time,
    bounty.duration_minutes,
    bounty.conditional_end_note,
    bounty.timeline,
  ])

  const imageAttachments = actualAttachments.filter(a =>
    !!(a.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name))
  )
  const otherAttachments = actualAttachments.filter(a =>
    !(a.mimeType?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp)$/i.test(a.name))
  )

  const goToPrev = () => {
    const newIdx = Math.max(0, currentImageIndex - 1)
    if (carouselWidth > 0) imageScrollRef.current?.scrollTo({ x: newIdx * carouselWidth, animated: true })
    setCurrentImageIndex(newIdx)
  }

  const goToNext = () => {
    const newIdx = Math.min(imageAttachments.length - 1, currentImageIndex + 1)
    if (carouselWidth > 0) imageScrollRef.current?.scrollTo({ x: newIdx * carouselWidth, animated: true })
    setCurrentImageIndex(newIdx)
  }

  const handleCarouselScroll = (e: any) => {
    if (carouselWidth > 0) {
      const idx = Math.round(e.nativeEvent.contentOffset.x / carouselWidth)
      setCurrentImageIndex(idx)
    }
  }



  // Handle Share button
  const handleShare = async () => {
    await shareBounty({
      id: bounty.id,
      title: bounty.title,
      amount: bounty.price,
      isForHonor: bounty.is_for_honor,
      description: bounty.description,
      location: bounty.location,
      posterName: bounty.username ? `@${bounty.username}` : undefined,
    });
  };

  // Handle Report button
  const handleReport = () => {
    setShowReportModal(true);
  };

  // Handle attachment open — show in-app AttachmentViewerModal
  const handleAttachmentOpen = async (attachment: AttachmentMeta) => {
    triggerHaptic('light') // Light haptic for attachment tap
    try {
      let uri = attachment.remoteUri || attachment.uri;
      if (!uri) {
        Alert.alert('Error', 'Attachment not available');
        return;
      }

      // If storageService saved a cache key (fallback to AsyncStorage), resolve it
      try {
        if (typeof uri === 'string' && uri.startsWith('attachment-cache-')) {
          const resolved = await storageService.getFromAsyncStorage(uri)
          if (resolved) uri = resolved
        }
      } catch (e) {
        // ignore resolution errors and continue with original uri
        console.error('Failed to resolve cached attachment uri', e)
      }

      // Prepare an AttachmentMeta with resolved uri and open viewer
      const prepared: AttachmentMeta = { ...attachment, uri: uri }
      setViewerAttachment(prepared)
      setViewerVisible(true)
    } catch (error) {
      console.error('Error preparing attachment for viewer:', error)
      Alert.alert('Error', 'Failed to open attachment')
    }
  };

  // Plays the shared close animation; the actual `onClose` (which tells the
  // parent to unmount this component) only fires once that animation has
  // finished, via AppModal's `onClosed` — see handleClose below.
  const handleClose = () => {
    setVisible(false)
  }

  // Check if user has already applied
  useEffect(() => {
    const checkApplicationStatus = async () => {
      if (!currentUserId || !bounty.id) return

      try {
        const requests = await bountyRequestService.getAll({
          bountyId: bounty.id,
          userId: currentUserId,
        })
        setHasApplied(requests.length > 0)
      } catch (error) {
        console.error('Error checking application status:', error)
      }
    }

    checkApplicationStatus()
  }, [bounty.id, currentUserId])

  // Handle apply for bounty
  const handleApplyForBounty = async () => {
    triggerHaptic('medium') // Medium haptic for apply action

    const claimFailed = (reason: 'validation' | 'network' | 'not_eligible' | 'already_claimed') => {
      analyticsService.trackEvent('application_failed', {
        role: 'hunter',
        bounty_id: String(bounty.id),
        reason,
        is_onboarding_demo: false,
      })
    }

    analyticsService.trackEvent('application_started', {
      role: 'hunter',
      bounty_id: String(bounty.id),
      amount: typeof bounty.price === 'number' ? bounty.price : undefined,
      is_for_honor: Boolean(bounty.is_for_honor),
      source: 'modal',
      is_onboarding_demo: false,
    })

    // Email verification gate: Block applying if email is not verified
    if (!isEmailVerified) {
      claimFailed('not_eligible')
      Alert.alert(
        'Email verification required',
        "Please verify your email to apply for bounties. We've sent a verification link to your inbox.",
        [
          { text: 'OK', style: 'default' }
        ]
      )
      return
    }

    if (!currentUserId || !bounty.id) {
      claimFailed('validation')
      Alert.alert('Error', 'Unable to apply. Please try again.')
      return
    }

    // Check if user is trying to apply to their own bounty
    if (posterId === currentUserId) {
      claimFailed('not_eligible')
      Alert.alert('Cannot Apply', 'You cannot apply to your own bounty.')
      return
    }

    // Check if bounty is already taken
    if (bounty.status === 'in_progress' || bounty.status === 'completed') {
      claimFailed('already_claimed')
      Alert.alert('Bounty Already Taken', 'This bounty has already been accepted by another hunter.')
      return
    }

    setIsApplying(true)
    try {
      const result = await bountyRequestService.create({
        bounty_id: bounty.id,
        hunter_id: currentUserId,
        status: 'pending',
        poster_id: posterId,
        message: applicationMessage.trim() || null,
      } as any)

      // Handle structured result from service
      if (result && (result as any).success) {
        const applicationId =
          (result as any)?.request?.id != null ? String((result as any).request.id) : undefined
        analyticsService.trackEvent('application_submitted', {
          role: 'hunter',
          bounty_id: String(bounty.id),
          application_id: applicationId,
          amount: typeof bounty.price === 'number' ? bounty.price : undefined,
          is_for_honor: Boolean(bounty.is_for_honor),
          source: 'modal',
          is_onboarding_demo: false,
          seconds_from_view_to_submit: Math.max(0, Math.round((Date.now() - viewedAtRef.current) / 1000)),
          had_message: applicationMessage.trim().length > 0,
          attachment_count: 0,
        })
        // Hunter-activation milestone — first application submitted on this
        // device (see lib/analytics/lifecycle.ts).
        void markHunterActivated(currentUserId, {
          bounty_id: String(bounty.id),
          application_id: applicationId,
        })
        setHasApplied(true)
        setIsApplying(false)

        if (Platform.OS === 'web') {
          router.push(`/in-progress/${bounty.id}/hunter`)
          setTimeout(() => handleClose(), 50)
        } else {
          alertTimeoutRef.current = setTimeout(() => {
            if (!isMountedRef.current) return
            Alert.alert(
              'Application Submitted',
              'Your application has been submitted. The bounty poster will review it soon.',
              [
                {
                  text: 'View In Progress',
                  onPress: () => {
                    router.push(`/in-progress/${bounty.id}/hunter`)
                    setTimeout(() => handleClose(), 50)
                  },
                },
                { text: 'OK' },
              ]
            )
          }, ALERT_DEFER_DELAY)
        }
        return
      }

      // If we reach here, the create returned a failure result or null
      setIsApplying(false)
      const errorMsg = (result && (result as any).error) || 'Failed to submit application. Please try again.'
      claimFailed(/banned|suspended/i.test(errorMsg) ? 'not_eligible' : 'validation')

      // Show network-style message offering to check if the request exists
      Alert.alert(
        'Network issue',
        'Network issue — request may have been received; checking...',
        [
          {
            text: 'Check',
            onPress: async () => {
              try {
                setIsApplying(true)
                const requests = await bountyRequestService.getAll({ bountyId: bounty.id, userId: currentUserId })
                setIsApplying(false)
                if (requests.length > 0) {
                  setHasApplied(true)
                  Alert.alert('Application Found', 'We found your application. Navigating to in-progress view.', [
                    { text: 'OK', onPress: () => { router.push(`/in-progress/${bounty.id}/hunter`); setTimeout(() => handleClose(), 50) } }
                  ])
                } else {
                  Alert.alert('Not Found', 'No application found for your account. Would you like to retry?', [
                    { text: 'Retry', onPress: () => handleApplyForBounty() },
                    { text: 'Cancel' },
                  ])
                }
              } catch (checkErr) {
                setIsApplying(false)
                console.error('Error checking application existence:', checkErr)
                Alert.alert('Error', 'Unable to verify application status. Please try again.')
              }
            }
          },
          { text: 'Retry', onPress: () => handleApplyForBounty() },
          { text: 'OK', style: 'cancel' }
        ],
        { cancelable: true }
      )
    } catch (error) {
      console.error('Error applying for bounty:', error)
      setIsApplying(false)
      claimFailed('network')
      Alert.alert(
        'Network issue',
        'Network issue — request may have been received; checking...',
        [
          { text: 'Check', onPress: async () => {
            try {
              setIsApplying(true)
              const requests = await bountyRequestService.getAll({ bountyId: bounty.id, userId: currentUserId })
              setIsApplying(false)
              if (requests.length > 0) {
                setHasApplied(true)
                Alert.alert('Application Found', 'We found your application. Navigating to in-progress view.', [
                  { text: 'OK', onPress: () => { router.push(`/in-progress/${bounty.id}/hunter`); setTimeout(() => handleClose(), 50) } }
                ])
              } else {
                Alert.alert('Not Found', 'No application found for your account. Would you like to retry?', [
                  { text: 'Retry', onPress: () => handleApplyForBounty() },
                  { text: 'Cancel' },
                ])
              }
            } catch (checkErr) {
              setIsApplying(false)
              console.error('Error checking application existence:', checkErr)
              Alert.alert('Error', 'Unable to verify application status. Please try again.')
            }
          } },
          { text: 'Retry', onPress: () => handleApplyForBounty() },
          { text: 'OK', style: 'cancel' }
        ],
        { cancelable: true }
      )
    }
  }

  const { width, height } = Dimensions.get('window')

  // The card is a fixed-height box with the apply composer pinned below the
  // scroll area. At its natural height the keyboard covers that composer, so
  // cap the card to what is left above the keyboard — the ScrollView gives up
  // the difference and the input stays on screen. AppModal re-centers the
  // shrunken card in the same keyboard curve.
  const { height: keyboardHeight } = useKeyboardInset()
  const cardHeight = Math.min(
    height * 0.9,
    760,
    Math.max(0, height - keyboardHeight - CARD_KEYBOARD_MARGIN)
  )

  return (
    <AppModal
      visible={visible}
      onRequestClose={handleClose}
      onClosed={onClose}
      variant="dialog"
    >
      <>
        {/* Shadow wrapper (no overflow) */}
        <View
          style={[
            styles.cardShadow,
            { width: width - 35, maxWidth: 560, height: cardHeight }
          ]}
        >
          {/* Rounded card (clips children) */}
          <View style={styles.card}>
            {/* Header - iPhone optimized */}
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <BrandingLogo size="medium" />
              </View>
              <View style={styles.headerActions}>
                <TouchableOpacity onPress={handleShare} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Share bounty">
                  <MaterialIcons name="share" size={20} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleReport} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Report bounty">
                  <MaterialIcons name="report" size={20} color={theme.text} />
                </TouchableOpacity>
                <TouchableOpacity onPress={handleClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
                  <MaterialIcons name="close" size={20} color={theme.text} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Bounty Details - Scrollable content */}
            <ScrollView
              ref={messagesEndRef}
              style={styles.scrollContainer}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
              <View
                style={styles.bountyCard}
                onLayout={e => setCarouselWidth(e.nativeEvent.layout.width)}
              >
                {/* Image carousel — Airbnb style */}
                {imageAttachments.length > 0 && carouselWidth > 0 ? (
                  <View style={styles.imageCarousel}>
                    <ScrollView
                      ref={imageScrollRef}
                      horizontal
                      pagingEnabled
                      showsHorizontalScrollIndicator={false}
                      onMomentumScrollEnd={handleCarouselScroll}
                      scrollEventThrottle={16}
                    >
                      {imageAttachments.map(att => (
                        <TouchableOpacity
                          key={att.id}
                          activeOpacity={0.95}
                          onPress={() => handleAttachmentOpen(att)}
                          style={{ width: carouselWidth }}
                        >
                          <Image
                            source={{ uri: att.remoteUri || att.uri }}
                            style={[styles.carouselImage, { width: carouselWidth }]}
                            resizeMode="cover"
                          />
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    {currentImageIndex > 0 && (
                      <TouchableOpacity style={[styles.carouselArrow, styles.carouselArrowLeft]} onPress={goToPrev}>
                        <MaterialIcons name="chevron-left" size={28} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {currentImageIndex < imageAttachments.length - 1 && (
                      <TouchableOpacity style={[styles.carouselArrow, styles.carouselArrowRight]} onPress={goToNext}>
                        <MaterialIcons name="chevron-right" size={28} color="#fff" />
                      </TouchableOpacity>
                    )}
                    {imageAttachments.length > 1 && (
                      <View style={styles.carouselDots}>
                        {imageAttachments.map((_, idx) => (
                          <View key={idx} style={[styles.carouselDot, idx === currentImageIndex && styles.carouselDotActive]} />
                        ))}
                      </View>
                    )}
                  </View>
                ) : null}
                <View style={styles.cardContent}>
                  {/* User info - Clickable to navigate to profile */}
                  <TouchableOpacity
                    style={styles.userInfo}
                    onPress={() => {
                      if (posterId) {
                        router.push(`/profile/${posterId}`)
                      }
                    }}
                    // Disable when no poster ID (can't navigate) or while profile is loading (prevents duplicate taps)
                    disabled={!posterId || profileLoading}
                  >
                    {profileLoading ? (
                      <View style={styles.profileLoadingContainer}>
                        <ActivityIndicator size="small" color={theme.textSecondary} />
                        <Text style={styles.loadingText}>Loading profile...</Text>
                      </View>
                    ) : (
                      <>
                        <Avatar style={styles.avatar}>
                          <AvatarImage src={bounty.poster_avatar || normalizedPoster?.avatar || "/placeholder.svg?height=40&width=40"} alt={displayUsername} />
                          <AvatarFallback style={styles.avatarFallback}>
                            <Text style={styles.avatarText}>
                              {displayUsername.substring(0, 2).toUpperCase()}
                            </Text>
                          </AvatarFallback>
                        </Avatar>
                        <View style={styles.userTextInfo}>
                          <Text style={styles.username}>{displayUsername}</Text>
                          <Text style={styles.postTime}>Posted 2h ago</Text>
                        </View>
                        {posterId && (
                          <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} style={{ marginLeft: 'auto' }} />
                        )}
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Title */}
                  <Text style={styles.title}>{bounty.title}</Text>
                  {((bounty as any)?.category) && (
                    <View style={styles.categoryPill}>
                      <Text style={styles.categoryPillText}>{formatCategoryLabel((bounty as any).category)}</Text>
                    </View>
                  )}

                  {/* Price and distance / Online badge */}
                  <View style={styles.priceDistanceContainer}>
                    <View style={styles.priceContainer}>
                      {(bounty as any).is_for_honor ? (
                        <Text style={styles.priceText}>♥ For Honor</Text>
                      ) : (
                        <Text style={styles.priceText}>${bounty.price}</Text>
                      )}
                    </View>
                    {bounty.work_type === 'online' ? (
                      <View style={styles.onlineBadge}>
                        <MaterialIcons name="wifi" size={14} color="#059669" />
                        <Text style={styles.onlineText}>Online</Text>
                      </View>
                    ) : bounty.distance === null ? (
                      <Text style={styles.distanceText}>Location TBD</Text>
                    ) : (
                      <Text style={styles.distanceText}>{bounty.distance} mi away</Text>
                    )}
                  </View>

                  {/* Description — omitted entirely when the bounty has none */}
                  {!!description && (
                    <View style={styles.descriptionContainer}>
                      <Text style={styles.sectionHeader}>Description</Text>
                      <Text style={styles.descriptionText}>{description}</Text>
                    </View>
                  )}

                  {/* Additional Details - Timeline, Skills, Location, Deadline */}
                  {(scheduleSummary || bounty.skills_required || bounty.location || bounty.deadline) && (
                    <View style={styles.additionalDetailsContainer}>
                      <Text style={styles.sectionHeader}>Additional Details</Text>

                      {([
                        scheduleSummary && {
                          icon: 'schedule' as const,
                          color: theme.textSecondary,
                          label: 'Timeline',
                          value: scheduleSummary,
                        },
                        bounty.skills_required && {
                          icon: 'build' as const,
                          color: theme.textSecondary,
                          label: 'Skills Required',
                          value: bounty.skills_required,
                        },
                        bounty.location && bounty.work_type !== 'online' && {
                          icon: 'place' as const,
                          color: theme.textSecondary,
                          label: 'Location',
                          value: bounty.location,
                        },
                        bounty.is_time_sensitive && bounty.deadline && {
                          icon: 'access-time' as const,
                          color: '#fbbf24',
                          label: '⚡ Deadline',
                          value: bounty.deadline,
                          urgent: true,
                        },
                      ].filter(Boolean) as DetailRow[]).map((detail, index, array) => (
                        <View key={index} style={[styles.detailRow, index === array.length - 1 && { marginBottom: 0 }]}>
                          <MaterialIcons name={detail.icon} size={16} color={detail.color} />
                          <View style={styles.detailContent}>
                            <Text style={[styles.detailLabel, detail.urgent && { color: '#fbbf24' }]}>
                              {detail.label}
                            </Text>
                            <Text style={[styles.detailValue, detail.urgent && { color: '#fbbf24', fontWeight: '600' }]}>
                              {detail.value}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}

                  {/* Non-image attachments (images shown in carousel above) */}
                  {(isLoadingAttachments || otherAttachments.length > 0) && (
                    <View style={styles.attachmentsSection}>
                      <Text style={styles.sectionHeader}>Attachments</Text>
                      {isLoadingAttachments ? (
                        <View style={styles.attachmentsLoadingContainer}>
                          <ActivityIndicator size="small" color={theme.textSecondary} />
                          <Text style={styles.attachmentsLoadingText}>Loading attachments...</Text>
                        </View>
                      ) : (
                        <View style={styles.attachmentsContainer}>
                          {otherAttachments.map((attachment) => {
                            const sizeInMB = attachment.size ? (attachment.size / (1024 * 1024)).toFixed(1) : 'Unknown'
                            return (
                              <TouchableOpacity
                                key={attachment.id}
                                style={styles.attachmentItem}
                                onPress={() => handleAttachmentOpen(attachment)}
                              >
                                <View style={styles.attachmentIcon}>
                                  <MaterialIcons name="description" size={20} color={theme.textSecondary} />
                                </View>
                                <View style={styles.attachmentInfo}>
                                  <Text style={styles.attachmentName}>{attachment.name}</Text>
                                  <Text style={styles.attachmentSize}>
                                    {attachment.size ? `${sizeInMB} MB` : 'Unknown size'}
                                  </Text>
                                </View>
                                <View style={styles.downloadButton}>
                                  <MaterialIcons name="arrow-forward" size={16} color={theme.textSecondary} />
                                </View>
                              </TouchableOpacity>
                            )
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              </View>

            </ScrollView>

            {/* Apply section - message input + button */}
            <View style={styles.actionContainer}>
              {!hasApplied && (
                <TextInput
                  style={styles.messageInput}
                  placeholder="Add a short message to the poster (optional)…"
                  placeholderTextColor={theme.textDisabled}
                  value={applicationMessage}
                  onChangeText={setApplicationMessage}
                  multiline
                  numberOfLines={3}
                  maxLength={300}
                  textAlignVertical="top"
                  editable={!isApplying}
                />
              )}
              <TouchableOpacity
                style={[
                  styles.acceptButton,
                  (hasApplied || isApplying) && styles.acceptButtonDisabled
                ]}
                onPress={handleApplyForBounty}
                disabled={hasApplied || isApplying}
              >
                {isApplying ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.acceptButtonText}>
                    {hasApplied ? 'Application Submitted' : 'Apply for Bounty'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Attachment viewer (in-app) */}
      <AttachmentViewerModal
        visible={viewerVisible}
        attachment={viewerAttachment ? {
          id: viewerAttachment.id,
          name: viewerAttachment.name,
          uri: viewerAttachment.uri,
          // `AttachmentMeta` includes an optional `mimeType`, so no cast is necessary
          mimeType: viewerAttachment.mimeType,
          size: viewerAttachment.size,
          remoteUri: viewerAttachment.remoteUri,
        } : null}
        onClose={() => {
          setViewerVisible(false)
          setViewerAttachment(null)
        }}
      />

      {/* Report Modal */}
      <ReportModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        contentType="bounty"
        contentId={String(bounty.id)}
        contentTitle={bounty.title}
      />
      </>
    </AppModal>
  )
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  cardShadow: {
    borderRadius: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: theme.isDark ? 0.15 : 0.1,
    shadowRadius: 8,
    elevation: 5,
    backgroundColor: 'transparent',
  },
  card: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 24,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: theme.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconButton: {
    padding: 8,
    marginRight: 4,
  },
  headerTitle: {
    marginLeft: 8,
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1.6,
    color: theme.text,
  },
  closeButton: {
    padding: 8,
  },
  scrollContainer: {
    flex: 1,
    backgroundColor: theme.surface,
  },
  scrollContent: {
    padding: 16,
  },
  bountyCard: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  cardContent: {
    padding: 16,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  profileLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  loadingText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  userTextInfo: {
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderWidth: 1,
    borderColor: theme.border,
  },
  avatarFallback: {
    backgroundColor: theme.surfaceSecondary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: theme.text,
    fontSize: 12,
  },
  username: {
    fontSize: 14,
    color: theme.text,
  },
  postTime: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: theme.text,
    marginBottom: 12,
  },
  priceDistanceContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  onlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.isDark ? '#ffffff' : theme.primary,
  },
  priceContainer: {
    backgroundColor: theme.isDark ? '#064e3b80' : 'rgba(5,150,105,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  priceText: {
    color: theme.isDark ? '#6ee7b7' : theme.primary,
    fontWeight: 'bold',
  },
  distanceText: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.isDark ? '#1F2937' : 'rgba(5,150,105,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  categoryPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(5,150,105,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  categoryPillText: {
    color: theme.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  honorBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#9CA3AF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 4,
  },
  honorText: {
    color: '#052e1b',
    fontWeight: '800',
    fontSize: 13,
  },
  descriptionContainer: {
    marginBottom: 16,
  },
  additionalDetailsContainer: {
    marginBottom: 16,
    backgroundColor: theme.surfaceSecondary,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    borderRadius: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
    gap: 10,
  },
  detailContent: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textSecondary,
    marginBottom: 2,
  },
  detailValue: {
    fontSize: 14,
    color: theme.text,
    lineHeight: 18,
  },
  attachmentsSection: {
    marginBottom: 16,
  },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '500',
    color: theme.textSecondary,
    marginBottom: 8,
  },
  descriptionText: {
    color: theme.text,
    fontSize: 14,
    lineHeight: 20,
  },
  attachmentsContainer: {
    gap: 8,
  },
  attachmentsLoadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 8,
    gap: 12,
  },
  attachmentsLoadingText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontStyle: 'italic',
  },
  attachmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.surfaceSecondary,
    padding: 12,
    borderRadius: 8,
  },
  attachmentIcon: {
    width: 40,
    height: 40,
    borderRadius: 6,
    backgroundColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  attachmentInfo: {
    flex: 1,
  },
  attachmentName: {
    fontSize: 14,
    color: theme.text,
  },
  attachmentSize: {
    fontSize: 12,
    color: theme.textSecondary,
  },
  downloadButton: {
    padding: 8,
  },
  imageCarousel: {
    position: 'relative',
    height: 220,
  },
  carouselImage: {
    height: 220,
  },
  carouselArrow: {
    position: 'absolute',
    top: 88,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 22,
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  carouselArrowLeft: {
    left: 10,
  },
  carouselArrowRight: {
    right: 10,
  },
  carouselDots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.55)',
  },
  carouselDotActive: {
    backgroundColor: '#fff',
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: -1,
  },
  actionContainer: {
    padding: 16,
    paddingTop: 16,
    backgroundColor: theme.background,
    borderTopWidth: 1,
    borderTopColor: theme.border,
  },
  acceptButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#059669',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  acceptButtonDisabled: {
    backgroundColor: '#059669',
    opacity: 0.6,
  },
  acceptButtonText: {
    color: '#ffffff',
    fontWeight: '500',
    fontSize: 16,
  },
  messageInput: {
    backgroundColor: theme.surfaceSecondary,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.border,
    color: theme.text,
    fontSize: 14,
    padding: 12,
    minHeight: 72,
    marginBottom: 10,
    textAlignVertical: 'top',
  },
  });
}

