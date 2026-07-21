"use client"

import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { useEffect, useMemo, useRef, useState } from "react"
import { ActivityIndicator, Alert, Animated, Dimensions, Easing, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { StripePaymentMethod } from '../lib/services/stripe-internal'
import { stripeService } from '../lib/services/stripe-service'
import { useStripe } from '../lib/stripe-context'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { withAlpha } from '../lib/utils'
import { AddBankAccountModal } from "./add-bank-account-modal"
import { AddCardModal } from "./add-card-modal"
import { Button } from './ui/button'
import { FeedbackModal } from './ui/feedback-modal'

type PaymentMethodType = 'card' | 'bank_account'

// Text color placed on top of the bright brand-green primary fill, matching
// the dark-on-green convention used across onboarding/wallet.
const ON_PRIMARY_TEXT = '#052e1b'

interface PaymentMethodsModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called when the backdrop (shaded area) is pressed. If provided, will be used instead of onClose. Useful to return to the parent screen. */
  onBackdropPress?: () => void
  /** Preferred method type to show (optional) */
  preferredType?: PaymentMethodType
}

function formatBankDisplay(pm: StripePaymentMethod): string {
  const name = pm.us_bank_account?.bank_name?.trim() || 'Bank Account'
  const last4 = pm.us_bank_account?.last4
  return last4 ? `${name} •••• ${last4}` : name
}

function bankStatusLabel(status: 'verified' | 'pending_microdeposits' | 'failed' | null | undefined): string {
  switch (status) {
    case 'verified':
      return 'Verified'
    case 'pending_microdeposits':
      return 'Verifying · usually 1-2 business days'
    case 'failed':
      return 'Verification failed'
    default:
      return 'Bank account'
  }
}

export function PaymentMethodsModal({ isOpen, onClose, onBackdropPress, preferredType }: PaymentMethodsModalProps) {
  const modalRef = useRef<View>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [initialY, setInitialY] = useState(0)
  const animatedTranslateY = useRef(new Animated.Value(Dimensions.get('window').height)).current
  const overlayOpacity = useRef(new Animated.Value(0)).current
  const [showAddCard, setShowAddCard] = useState(false)
  const [showAddBankAccount, setShowAddBankAccount] = useState(false)
  const [selectedMethodType, setSelectedMethodType] = useState<PaymentMethodType>(preferredType || 'card')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)
  const [feedback, setFeedback] = useState<{ title: string; message: string } | null>(null)

  const { paymentMethods, isLoading, removePaymentMethod, loadPaymentMethods, error: stripeError, clearError } = useStripe()
  const [loadFailed, setLoadFailed] = useState(false)
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const insets = useSafeAreaInsets()

  // Initialize selected method type when modal opens, honoring preferredType if provided
  useEffect(() => {
    if (isOpen && preferredType) {
      setSelectedMethodType(preferredType)
    }
  }, [isOpen, preferredType])

  // Refresh payment methods with retry logic
  // Let Stripe SDK and network stack handle timeouts naturally
  const refreshWithRetry = async (totalAttempts = 4, baseDelayMs = 1000) => {
    let lastErr: unknown
    setLoadFailed(false)
    for (let i = 0; i < totalAttempts; i++) {
      try {
        // Clear previous errors before attempt
        clearError()
        // Let SDK handle network timeouts without artificial limits
        await loadPaymentMethods()
        // If loadPaymentMethods resolved, success
        return
      } catch (e: unknown) {
        lastErr = e
        // Skip backoff after the last attempt
        if (i < totalAttempts - 1) {
          // Exponential backoff using provided base delay: base, 2*base, 4*base
          const backoffMs = Math.min(baseDelayMs * Math.pow(2, i), 4000)
          console.log(`[PaymentMethodsModal] Attempt ${i + 1}/${totalAttempts} failed, waiting ${backoffMs}ms before retry`)
          await new Promise(r => setTimeout(r, backoffMs))
        }
      }
    }
    console.warn('[PaymentMethodsModal] loadPaymentMethods failed after all attempts:', lastErr)
    setLoadFailed(true)
  }

  // Auto-refresh methods when modal opens
  useEffect(() => {
    if (isOpen) {
      // Clear any previous errors and failed state when opening
      setLoadFailed(false)
      clearError()
      refreshWithRetry(4) // Try 4 times total
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleRetry = async () => {
    if (isRetrying) return
    setIsRetrying(true)
    try {
      await refreshWithRetry(3, 1000)
    } finally {
      setIsRetrying(false)
    }
  }

  const handleRemovePaymentMethod = (paymentMethodId: string, label: string) => {
    if (removingId) return // Prevent duplicate/overlapping remove requests
    Alert.alert(
      'Remove Payment Method',
      'Are you sure you want to remove this payment method?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingId(paymentMethodId)
            try {
              await removePaymentMethod(paymentMethodId)
            } catch (error) {
              setFeedback({ title: 'Error', message: `Failed to remove ${label}. Please try again.` })
            } finally {
              setRemovingId(null)
            }
          }
        }
      ]
    )
  }

  // React Native/Expo Go: Use PanResponder for drag gestures and drive Animated value
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt, gestureState) => {
      setIsDragging(true)
      setInitialY(gestureState.y0)
      animatedTranslateY.stopAnimation()
    },
    onPanResponderMove: (evt, gestureState) => {
      const offset = gestureState.moveY - initialY
      if (offset > 0) {
        animatedTranslateY.setValue(offset)
      }
    },
    onPanResponderRelease: (evt, gestureState) => {
      setIsDragging(false)
      const offset = gestureState.moveY - initialY
      if (offset > 120 || gestureState.vy > 0.8) {
        Animated.timing(animatedTranslateY, {
          toValue: Dimensions.get('window').height,
          duration: 180,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start(() => onClose())
      } else {
        Animated.spring(animatedTranslateY, {
          toValue: 0,
          tension: 80,
          friction: 10,
          useNativeDriver: true
        }).start()
      }
    },
    onPanResponderTerminate: () => {
      setIsDragging(false)
      Animated.spring(animatedTranslateY, {
        toValue: 0,
        tension: 80,
        friction: 10,
        useNativeDriver: true
      }).start()
    },
  })

  // Animate in overlay + modal when opening
  useEffect(() => {
    if (isOpen) {
      overlayOpacity.setValue(0)
      animatedTranslateY.setValue(Dimensions.get('window').height)
      Animated.parallel([
        Animated.timing(overlayOpacity, { toValue: 0.6, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(animatedTranslateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true })
      ]).start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const handleBackdropPress = () => {
    if (onBackdropPress) {
      onBackdropPress()
    } else {
      onClose()
    }
  }

  const cardMethods = useMemo(() => paymentMethods.filter(pm => pm.type === 'card'), [paymentMethods])
  const bankMethods = useMemo(() => paymentMethods.filter(pm => pm.type === 'us_bank_account'), [paymentMethods])
  const activeList = selectedMethodType === 'card' ? cardMethods : bankMethods
  // The backend always charges/uses paymentMethods[0] as the implicit default
  // (see docs/ui/ADD_MONEY_FLOW_MODERNIZATION.md) — surface that honestly
  // instead of inventing new selection state that doesn't exist yet.
  const defaultPaymentMethodId = paymentMethods[0]?.id
  const isRowDefault = (item: StripePaymentMethod) =>
    item.id === defaultPaymentMethodId || (item.type === 'us_bank_account' && item.us_bank_account?.is_default === true)

  const hasLoadError = (loadFailed || !!stripeError) && activeList.length === 0
  const showLoading = isLoading && !hasLoadError && activeList.length === 0
  const showEmpty = !showLoading && !hasLoadError && activeList.length === 0

  const friendlyErrorMessage = (() => {
    if (!stripeError) return 'Unable to load payment methods. Please check your connection and try again.'
    if (stripeError.includes('timed out') || stripeError.includes('timeout')) {
      return 'Connection timed out. Please check your internet connection and try again.'
    }
    if (stripeError.includes('Network')) {
      return 'Unable to connect. Please check your internet connection.'
    }
    if (stripeError.includes('interrupted')) {
      return 'Connection interrupted. Please try again.'
    }
    return stripeError
  })()

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="none"
      onRequestClose={handleBackdropPress}
      statusBarTranslucent
    >
      <Animated.View style={s.modalRoot}>
        <Pressable style={s.backdropPressable} onPress={handleBackdropPress} accessibilityLabel="Close payment methods" accessibilityRole="button">
          <Animated.View style={[s.backdrop, { opacity: overlayOpacity }]} />
        </Pressable>

        <Animated.View
          ref={modalRef}
          {...panResponder.panHandlers}
          style={[
            s.sheet,
            {
              transform: [{ translateY: animatedTranslateY }],
              maxHeight: Dimensions.get('window').height * 0.92,
            },
          ]}
        >
          {/* Drag handle */}
          <View style={s.dragHandle} />

          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity
              onPress={onClose}
              style={s.closeButton}
              accessibilityRole="button"
              accessibilityLabel="Close payment methods"
            >
              <MaterialIcons name="close" size={24} color={theme.text} />
            </TouchableOpacity>
            <Text style={s.headerTitle}>Payment Methods</Text>
            <View style={{ width: 44 }} />
          </View>

          {/* Content */}
          {showAddCard ? (
            <AddCardModal
              embedded={true}
              onBack={() => setShowAddCard(false)}
              onSave={() => {
                // Card already added through Stripe service in AddCardModal
                setShowAddCard(false)
                // Refresh payment methods with reasonable retry
                refreshWithRetry(3, 1000)
              }}
            />
          ) : showAddBankAccount ? (
            <AddBankAccountModal
              embedded={true}
              onBack={() => setShowAddBankAccount(false)}
              onSave={() => {
                // Bank account added through backend
                setShowAddBankAccount(false)
                // Refresh payment methods
                refreshWithRetry(3, 1000)
              }}
            />
          ) : (
            <View style={s.body}>
              <View style={s.controlsBlock}>
                {/* Method Type Tabs */}
                <View style={s.tabRow} accessibilityRole="tablist">
                  <SegmentTab
                    theme={theme}
                    label="Cards"
                    active={selectedMethodType === 'card'}
                    onPress={() => setSelectedMethodType('card')}
                    accessibilityLabel="Cards"
                  />
                  <SegmentTab
                    theme={theme}
                    label="Bank Accounts"
                    active={selectedMethodType === 'bank_account'}
                    onPress={() => setSelectedMethodType('bank_account')}
                    accessibilityLabel="Bank Accounts"
                  />
                </View>

                {/* Add Method Button. Note: Button's `style` prop replaces its
                    internal variant styling wholesale rather than merging
                    (it spreads incoming props after its own style array), so
                    width/spacing is applied via this wrapping View instead of
                    passing `style` to Button directly. */}
                <View style={s.addButton}>
                  <Button
                    variant="default"
                    size="lg"
                    onPress={() => (selectedMethodType === 'card' ? setShowAddCard(true) : setShowAddBankAccount(true))}
                    accessibilityLabel={`Add new ${selectedMethodType === 'card' ? 'card' : 'bank account'}`}
                  >
                    <View style={s.addButtonContent}>
                      <MaterialIcons name="add" size={22} color={ON_PRIMARY_TEXT} />
                      <Text style={s.addButtonText}>
                        {selectedMethodType === 'card' ? 'Add New Card' : 'Add Bank Account'}
                      </Text>
                    </View>
                  </Button>
                </View>
              </View>

              {/* Payment Methods List */}
              <View style={s.listRegion}>
                {showLoading ? (
                  <View style={s.stateContainer}>
                    <ActivityIndicator size="large" color={theme.primary} />
                    <Text style={s.stateText}>Loading payment methods…</Text>
                  </View>
                ) : hasLoadError ? (
                  <View style={s.stateContainer}>
                    <MaterialIcons name="error-outline" size={48} color={theme.error} />
                    <Text style={[s.stateText, { marginTop: 12 }]}>{friendlyErrorMessage}</Text>
                    <View style={{ marginTop: theme.spacing.lg }}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onPress={handleRetry}
                        loading={isRetrying}
                        accessibilityLabel="Retry loading payment methods"
                      >
                        Retry
                      </Button>
                    </View>
                  </View>
                ) : showEmpty ? (
                  <View style={s.stateContainer}>
                    <MaterialIcons
                      name={selectedMethodType === 'card' ? 'credit-card' : 'account-balance'}
                      size={56}
                      color={theme.textDisabled}
                    />
                    <Text style={s.emptyText}>
                      {selectedMethodType === 'card'
                        ? 'No cards added yet.\nAdd your first card to get started.'
                        : 'No bank accounts linked yet.\nAdd one for ACH deposits.'}
                    </Text>
                  </View>
                ) : (
                  <FlatList
                    data={activeList}
                    keyExtractor={(item) => item.id}
                    removeClippedSubviews={true}
                    maxToRenderPerBatch={5}
                    windowSize={5}
                    initialNumToRender={3}
                    style={s.list}
                    renderItem={({ item }) => (
                      <PaymentMethodRow
                        theme={theme}
                        item={item}
                        isDefault={isRowDefault(item)}
                        isRemoving={removingId === item.id}
                        onRemove={() =>
                          handleRemovePaymentMethod(
                            item.id,
                            item.type === 'card' ? stripeService.formatCardDisplay(item) : formatBankDisplay(item)
                          )
                        }
                      />
                    )}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}
                  />
                )}
              </View>
            </View>
          )}
        </Animated.View>
      </Animated.View>

      <FeedbackModal
        visible={!!feedback}
        variant="error"
        title={feedback?.title ?? ''}
        message={feedback?.message ?? ''}
        onDismiss={() => setFeedback(null)}
      />
    </Modal>
  )
}

function SegmentTab({
  theme,
  label,
  active,
  onPress,
  accessibilityLabel,
}: {
  theme: AppTheme
  label: string
  active: boolean
  onPress: () => void
  accessibilityLabel: string
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [
        segmentStyles.tab,
        active
          ? { backgroundColor: theme.primary }
          : hovered
            ? { backgroundColor: theme.overlay }
            : null,
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text
        style={[
          segmentStyles.tabText,
          { color: active ? ON_PRIMARY_TEXT : theme.textSecondary, fontWeight: active ? '600' : '500' },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

function PaymentMethodRow({
  theme,
  item,
  isDefault,
  isRemoving,
  onRemove,
}: {
  theme: AppTheme
  item: StripePaymentMethod
  isDefault: boolean
  isRemoving: boolean
  onRemove: () => void
}) {
  const isCard = item.type === 'card'
  const icon = isCard ? 'credit-card' : 'account-balance'
  const title = isCard ? stripeService.formatCardDisplay(item) : formatBankDisplay(item)
  const isFailedBank = !isCard && item.us_bank_account?.verification_status === 'failed'
  const subtitle = isCard
    ? `Expires ${item.card.exp_month.toString().padStart(2, '0')}/${item.card.exp_year}`
    : bankStatusLabel(item.us_bank_account?.verification_status)

  return (
    <View style={[rowStyles.row, { backgroundColor: theme.surfaceSecondary }, theme.shadows.sm]}>
      <View style={[rowStyles.iconWrap, { backgroundColor: withAlpha(theme.primary, theme.isDark ? 0.18 : 0.1) }]}>
        <MaterialIcons name={icon} size={22} color={theme.primary} />
      </View>
      <View style={rowStyles.info}>
        <View style={rowStyles.titleRow}>
          <Text style={[rowStyles.title, { color: theme.text }]} numberOfLines={1}>
            {title}
          </Text>
          {isDefault && (
            <View style={[rowStyles.badge, { backgroundColor: theme.primary }]}>
              <Text style={rowStyles.badgeText}>Default</Text>
            </View>
          )}
        </View>
        <Text style={[rowStyles.subtitle, { color: isFailedBank ? theme.error : theme.textSecondary }]}>
          {subtitle}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        disabled={isRemoving}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${title}`}
        style={({ pressed }) => [rowStyles.removeButton, pressed && !isRemoving && { opacity: 0.6 }]}
      >
        {isRemoving ? (
          <ActivityIndicator size="small" color={theme.error} />
        ) : (
          <MaterialIcons name="delete-outline" size={22} color={theme.textSecondary} />
        )}
      </Pressable>
    </View>
  )
}

// Layout-only (colors applied inline per-theme) — used by SegmentTab.
const segmentStyles = StyleSheet.create({
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 40,
  },
  tabText: {
    textAlign: 'center',
    fontSize: 15,
  },
})

// Layout-only (colors applied inline per-theme) — used by PaymentMethodRow.
const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
    minHeight: 72,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, marginLeft: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { fontWeight: '600', fontSize: 16, flexShrink: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
  badgeText: { fontSize: 10, fontWeight: '700', color: ON_PRIMARY_TEXT, letterSpacing: 0.3 },
  subtitle: { fontSize: 13, marginTop: 3 },
  removeButton: {
    padding: 10,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
})

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    modalRoot: {
      flex: 1,
      justifyContent: 'flex-end',
      alignItems: 'center',
    },
    backdropPressable: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    },
    backdrop: {
      flex: 1,
      backgroundColor: '#000000',
    },
    sheet: {
      backgroundColor: theme.background,
      width: '100%',
      borderTopLeftRadius: theme.radius['2xl'],
      borderTopRightRadius: theme.radius['2xl'],
      borderWidth: 1,
      borderBottomWidth: 0,
      borderColor: theme.border,
      overflow: 'hidden',
      minHeight: 400,
      ...theme.shadows.xl,
    },
    dragHandle: {
      width: 56,
      height: 6,
      backgroundColor: theme.border,
      borderRadius: theme.radius.sm,
      alignSelf: 'center',
      marginVertical: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.xl,
      paddingBottom: theme.spacing.md,
    },
    closeButton: {
      padding: 8,
      minWidth: 44,
      minHeight: 44,
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerTitle: {
      fontSize: theme.typography.fontSize.xl,
      fontWeight: theme.typography.fontWeight.semibold,
      color: theme.text,
      letterSpacing: 0.3,
    },
    // flex:1 + minHeight:0 lets this region shrink within the sheet's
    // maxHeight ceiling so the FlatList below scrolls internally instead of
    // being clipped by the sheet's overflow:'hidden' once content exceeds
    // the available height (the FlatList was previously unbounded and any
    // overflow was silently cut off rather than scrollable).
    body: {
      flex: 1,
      minHeight: 0,
    },
    controlsBlock: {
      paddingHorizontal: theme.spacing.xl,
    },
    tabRow: {
      flexDirection: 'row',
      marginBottom: theme.spacing.lg,
      backgroundColor: theme.surface,
      borderRadius: theme.radius.lg,
      padding: 4,
      gap: 4,
    },
    addButton: {
      marginBottom: theme.spacing.lg,
      width: '100%',
    },
    addButtonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    addButtonText: {
      color: ON_PRIMARY_TEXT,
      fontWeight: '600',
      marginLeft: 8,
      fontSize: 16,
    },
    listRegion: {
      flex: 1,
      minHeight: 0,
      paddingHorizontal: theme.spacing.xl,
    },
    list: {
      flex: 1,
    },
    stateContainer: {
      alignItems: 'center',
      paddingVertical: 40,
      paddingHorizontal: 20,
    },
    stateText: {
      color: theme.textSecondary,
      textAlign: 'center',
      fontSize: 15,
      lineHeight: 22,
    },
    emptyText: {
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 16,
      fontSize: 16,
      lineHeight: 24,
    },
  })
}
