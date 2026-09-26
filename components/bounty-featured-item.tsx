"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Image as ExpoImage } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { useHapticFeedback } from '../lib/haptic-feedback'
import type { AttachmentMeta } from '../lib/services/database.types'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { useCountdown } from '../hooks/useCountdown'
import { getScheduleChip } from '../lib/utils/schedule-utils'
import { BountyDetailModal } from "./bountydetailmodal"
import { CountdownBadge } from "./ui/countdown-badge"

// Every slot in the card below the cover is a fixed height, and the price row
// is pinned to the bottom, so title / description / location / price land on
// exactly the same baselines on every featured card — a one-line title, a
// missing description or an incomplete listing changes what's in a slot, never
// where the slots are. The carousel imports FEATURED_CARD_HEIGHT rather than
// repeating a number that has to stay in step with this budget.
const COVER_HEIGHT = 165
const INFO_PADDING = 12
/** Two lines at TITLE_LINE_HEIGHT — reserved whether the title wraps or not. */
const TITLE_LINE_HEIGHT = 20
const TITLE_HEIGHT = TITLE_LINE_HEIGHT * 2
const DESCRIPTION_HEIGHT = 16
const LOCATION_HEIGHT = 14
const META_HEIGHT = 22
/** Gaps between the three text slots; the gap above the meta row is elastic. */
const SLOT_GAP = 3
const INFO_HEIGHT =
  INFO_PADDING * 2 +
  TITLE_HEIGHT +
  SLOT_GAP +
  DESCRIPTION_HEIGHT +
  SLOT_GAP +
  LOCATION_HEIGHT +
  SLOT_GAP +
  META_HEIGHT +
  // Slack, so a capped font bump has somewhere to go before anything clips.
  12
export const FEATURED_CARD_HEIGHT = COVER_HEIGHT + INFO_HEIGHT

// Fixed-height text slots only hold if the text can't grow without bound.
const CARD_MAX_FONT_SCALE = 1.2

export interface BountyFeaturedItemProps {
  id: string | number
  title: string
  username?: string
  price: number
  distance: number | null
  location?: string | null
  description?: string
  isForHonor?: boolean
  user_id?: string | null
  work_type?: 'online' | 'in_person'
  poster_avatar?: string
  categoryColor: string
  categoryLabel: string
  attachments_json?: string
  // Schedule fields (Phase 1: time as first-class citizen)
  schedule_type?: 'asap' | 'scheduled' | 'flexible' | null
  start_date?: string | null
  end_date?: string | null
  duration_minutes?: number | null
  is_time_sensitive?: boolean
  /** Listing is missing scope / location / timing. See
   * lib/utils/bounty-completeness.ts. */
  incomplete?: boolean
  missingSummary?: string
}

function BountyFeaturedItemComponent({
  id, title, username, price, distance, location, description,
  isForHonor, user_id, work_type, poster_avatar,
  categoryColor, categoryLabel, attachments_json,
  schedule_type, start_date, end_date, duration_minutes, is_time_sensitive,
  incomplete, missingSummary,
}: BountyFeaturedItemProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [showDetail, setShowDetail] = useState(false)
  const { triggerHaptic } = useHapticFeedback()
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(user_id ?? undefined)
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...')

  // Derive time chip
  const scheduleChip = useMemo(() => {
    if (schedule_type) {
      return getScheduleChip(schedule_type, start_date, end_date, duration_minutes)
    }
    if (is_time_sensitive) {
      return { label: 'URGENT', icon: '🔴', variant: 'urgent' as const }
    }
    return null
  }, [schedule_type, start_date, end_date, duration_minutes, is_time_sensitive])

  // Once the deadline is under 24h away, a live ticking countdown replaces
  // the static schedule chip so the urgency is visible at a glance.
  const { isWithin24h: showCountdown } = useCountdown(end_date)

  useEffect(() => {
    if (username) { setResolvedUsername(username); return }
    if (posterProfile?.username) { setResolvedUsername(posterProfile.username); return }
    setResolvedUsername(profileLoading ? 'Loading...' : 'Anonymous')
  }, [username, posterProfile?.username, profileLoading])

  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 24, bounciness: 5 }).start()
  }, [scaleAnim])

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 5 }).start()
  }, [scaleAnim])

  const handlePress = useCallback(() => {
    triggerHaptic('light')
    setShowDetail(true)
  }, [triggerHaptic])

  const firstImageUri = useMemo(() => {
    if (!attachments_json) return null
    try {
      const attachments: AttachmentMeta[] = JSON.parse(attachments_json)
      const found = attachments.find(a => a.remoteUri && a.mimeType?.startsWith('image/'))
      return found?.remoteUri ?? null
    } catch {
      return null
    }
  }, [attachments_json])

  return (
    <>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], flex: 1 }}>
        <TouchableOpacity
          activeOpacity={1}
          style={s.card}
          onPress={handlePress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          accessibilityRole="button"
          accessibilityLabel={`Featured: ${title} by ${resolvedUsername}`}
          accessibilityHint="Tap to view bounty details"
        >
          {/* Cover — image or gradient placeholder */}
          {firstImageUri ? (
            <ExpoImage source={{ uri: firstImageUri }} style={s.cover} contentFit="cover" recyclingKey={firstImageUri} />
          ) : (
            <LinearGradient
              colors={[categoryColor + 'cc', categoryColor + '66', '#064e3b']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={s.cover}
            >
              <MaterialIcons name="work-outline" size={40} color="rgba(255,255,255,0.25)" />
            </LinearGradient>
          )}

          {/* "Limited details" rides the cover rather than the info block: in
              the flow below it would push the title, description and price
              down on exactly the cards that have it, which is the variance
              this layout exists to remove. */}
          {incomplete && (
            <View style={s.limitedBadge}>
              <MaterialIcons name="info-outline" size={11} color="rgba(255,255,255,0.85)" />
              <Text style={s.limitedText} numberOfLines={1} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>
                Limited details{missingSummary ? ` · ${missingSummary}` : ''}
              </Text>
            </View>
          )}

          {/* Category chip overlaid on image bottom-left */}
          <View style={[s.coverChip, { backgroundColor: categoryColor }]}>
            <Text style={s.coverChipText}>{categoryLabel}</Text>
          </View>

          {/* Schedule chip overlaid on image top-right — a live countdown
              takes over once the deadline is under 24h away. */}
          {showCountdown ? (
            <CountdownBadge
              endDate={end_date}
              size="md"
              style={[s.scheduleChip, s.scheduleChipUrgent]}
            />
          ) : (
            scheduleChip && (
              <View style={[
                s.scheduleChip,
                scheduleChip.variant === 'urgent'  && s.scheduleChipUrgent,
                scheduleChip.variant === 'warning' && s.scheduleChipWarning,
              ]}>
                <Text style={s.scheduleChipText}>{scheduleChip.icon} {scheduleChip.label}</Text>
              </View>
            )
          )}

          {/* Info below cover — the card's own themed surface, matching
              BountyGridItem's footer treatment rather than carrying the
              banner's green down into the card. */}
          <View style={s.info}>
            {/* Each slot keeps its height whether or not it has content — the
                description renders as an empty line rather than collapsing. */}
            <Text
              style={s.title}
              numberOfLines={2}
              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
            >
              {title}
            </Text>
            <Text
              style={s.description}
              numberOfLines={1}
              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
            >
              {description || ''}
            </Text>
            <Text
              style={s.location}
              numberOfLines={1}
              maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
            >
              {work_type === 'online' ? 'Remote' : location || 'In Person'}
            </Text>
            <View style={s.metaRow}>
              {isForHonor ? (
                <View style={s.honorBadge}>
                  <MaterialIcons name="favorite" size={11} color={theme.primary} />
                  <Text style={s.honorText} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>For Honor</Text>
                </View>
              ) : (
                <Text style={s.price} maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}>${price}</Text>
              )}
              <Text
                style={s.username}
                numberOfLines={1}
                maxFontSizeMultiplier={CARD_MAX_FONT_SCALE}
              >
                @{resolvedUsername}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>

      {showDetail && (
        <BountyDetailModal
          bounty={{
            id, username: resolvedUsername, title, price, distance, location: location ?? undefined,
            description, user_id, work_type, poster_avatar, is_for_honor: isForHonor,
          }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

export const BountyFeaturedItem = React.memo(BountyFeaturedItemComponent, (prev, next) =>
  prev.id === next.id &&
  prev.title === next.title &&
  prev.price === next.price &&
  prev.location === next.location &&
  prev.user_id === next.user_id &&
  prev.categoryColor === next.categoryColor &&
  prev.attachments_json === next.attachments_json &&
  prev.schedule_type === next.schedule_type &&
  prev.start_date === next.start_date &&
  prev.end_date === next.end_date &&
  prev.duration_minutes === next.duration_minutes &&
  prev.is_time_sensitive === next.is_time_sensitive &&
  prev.incomplete === next.incomplete &&
  prev.missingSummary === next.missingSummary
)

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: t.surface,
      borderRadius: 16,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: t.border,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: t.isDark ? 0.3 : 0.1,
      shadowRadius: 8,
      elevation: 4,
    },
    cover: {
      width: '100%',
      height: COVER_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
    },
    coverChip: {
      position: 'absolute',
      top: COVER_HEIGHT - 28,
      left: 12,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
    },
    coverChipText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#fff',
    },
    scheduleChip: {
      position: 'absolute',
      top: 10,
      right: 10,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    scheduleChipUrgent: {
      backgroundColor: 'rgba(220,38,38,0.85)',
    },
    scheduleChipWarning: {
      backgroundColor: 'rgba(180,100,0,0.85)',
    },
    scheduleChipText: {
      fontSize: 11,
      fontWeight: '700',
      color: '#fff',
    },
    info: {
      // flex:1 rather than a height: the card is FEATURED_CARD_HEIGHT tall and
      // the cover is fixed, so this takes exactly INFO_HEIGHT and any rounding
      // lands in the elastic gap above metaRow.
      flex: 1,
      padding: INFO_PADDING,
      backgroundColor: t.surface,
    },
    title: {
      fontSize: 15,
      fontWeight: '800',
      color: t.text,
      lineHeight: TITLE_LINE_HEIGHT,
      height: TITLE_HEIGHT,
      letterSpacing: -0.2,
    },
    description: {
      fontSize: 12,
      color: t.textSecondary,
      lineHeight: DESCRIPTION_HEIGHT,
      height: DESCRIPTION_HEIGHT,
      marginTop: SLOT_GAP,
    },
    location: {
      fontSize: 11,
      color: t.textDisabled,
      lineHeight: LOCATION_HEIGHT,
      height: LOCATION_HEIGHT,
      marginTop: SLOT_GAP,
    },
    limitedBadge: {
      position: 'absolute',
      top: 10,
      left: 10,
      // Leaves the top-right corner to the schedule chip / countdown.
      maxWidth: '55%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.55)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.28)',
    },
    limitedText: {
      fontSize: 10,
      fontWeight: '700',
      color: 'rgba(255,255,255,0.9)',
      flexShrink: 1,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      height: META_HEIGHT,
      // Pinned to the bottom of the info block: the price and @username sit on
      // the same line on every card no matter what the slots above hold.
      marginTop: 'auto',
    },
    price: {
      fontSize: 16,
      lineHeight: META_HEIGHT,
      fontWeight: '800',
      color: t.primary,
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.1)',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(16,185,129,0.35)' : 'rgba(5,150,105,0.3)',
      gap: 4,
    },
    honorText: {
      color: t.primary,
      fontWeight: '800',
      fontSize: 11,
    },
    username: {
      fontSize: 12,
      color: t.textSecondary,
      flexShrink: 1,
      marginLeft: 8,
      textAlign: 'right',
    },
  })
}