"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import type { StyleProp, ViewStyle } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { SIZING, SPACING, TYPOGRAPHY, getLineHeight } from '../lib/constants/accessibility'
import { useHapticFeedback } from '../lib/haptic-feedback'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BountyDetailModal } from "./bountydetailmodal"
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'

export interface BountyCompactItemProps {
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
  poster_avatar?: string | null
  /** Listing is missing scope / location / timing. See
   * lib/utils/bounty-completeness.ts. */
  incomplete?: boolean
  missingSummary?: string
  /** Optional attribution line, e.g. who completed the work and when. */
  dateLabel?: string
  /** Override the card container — e.g. a carousel giving every card the same
   * height. Pass a stable (StyleSheet or memoized) value so memo still holds. */
  style?: StyleProp<ViewStyle>
}

function BountyCompactItemComponent({
  id, title, username, price, distance, location, description,
  isForHonor, user_id, work_type, poster_avatar, incomplete, missingSummary,
  dateLabel, style
}: BountyCompactItemProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [showDetail, setShowDetail] = useState(false)
  const router = useRouter()
  const { triggerHaptic } = useHapticFeedback()
  const hasJoinedPosterIdentity = typeof username === 'string' && poster_avatar !== undefined
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(
    user_id ?? undefined,
    // Skip the Supabase profile lookup when the bounty row already carries
    // both username and avatar state from the feed JOIN, including null avatars.
    { enabled: !hasJoinedPosterIdentity }
  )
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...')
  const avatarUrl = poster_avatar || posterProfile?.avatar

  useEffect(() => {
    if (username) { setResolvedUsername(username); return }
    if (posterProfile?.username) { setResolvedUsername(posterProfile.username); return }
    setResolvedUsername(profileLoading ? 'Loading...' : 'Anonymous')
  }, [username, posterProfile?.username, profileLoading])

  const handleAvatarPress = useCallback((e: any) => {
    e.stopPropagation()
    triggerHaptic('light')
    if (user_id) router.push(`/profile/${user_id}`)
  }, [user_id, router, triggerHaptic])

  const handleBountyPress = useCallback(() => {
    triggerHaptic('light')
    setShowDetail(true)
  }, [triggerHaptic])

  const accessibilityLabel = `Bounty: ${title} by ${resolvedUsername}${isForHonor ? ', for honor' : `, $${price}`}${work_type === 'online' ? ', online work' : location ? `, ${location}` : distance !== null ? `, ${distance} miles away` : ', location to be determined'}${dateLabel ? `, ${dateLabel}` : ''}${incomplete ? `, limited details${missingSummary ? `, ${missingSummary}` : ''}` : ''}`

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        style={[s.row, dateLabel ? s.rowStacked : null, style]}
        onPress={handleBountyPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Tap to view bounty details and apply"
      >
        {/* Attribution line, e.g. "<name> completed this · <date>". Sits above
            the body so it spans the card's full width and stays on one line. */}
        {dateLabel ? (
          <Text style={s.dateText} numberOfLines={1}>{dateLabel}</Text>
        ) : null}

        <View style={s.rowInner}>
        {/* Leading avatar */}
        <TouchableOpacity
          onPress={handleAvatarPress}
          disabled={!user_id}
          style={s.leadingAvatarWrap}
          accessibilityRole="button"
          accessibilityLabel={`View ${resolvedUsername}'s profile`}
        >
        </TouchableOpacity>

        {/* Main content */}
        <View style={s.mainContent}>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          <View style={s.metaRow}>
            <Text style={s.username}>{resolvedUsername}</Text>
            <View style={s.dot} />
            {work_type === 'online' ? (
              <View style={s.onlineBadge}>
                <MaterialIcons name="wifi" size={10} color={theme.primary} />
                <Text style={s.onlineText}>Online</Text>
              </View>
            ) : location ? (
              <Text style={s.distance} numberOfLines={1}>{location}</Text>
            ) : distance === null ? (
              <Text style={s.distance}>Location TBD</Text>
            ) : (
              <Text style={s.distance}>{distance} mi</Text>
            )}
          </View>
          {incomplete && (
            <View style={s.limitedRow}>
              <MaterialIcons name="info-outline" size={11} color={theme.textSecondary} />
              <Text style={s.limitedText} numberOfLines={1}>
                Limited details{missingSummary ? ` · ${missingSummary}` : ''}
              </Text>
            </View>
          )}
        </View>

        {/* Trailing price and chevron */}
        <View style={s.trailing}>
          {isForHonor ? (
            <View style={s.honorBadge}>
              <MaterialIcons name="favorite" size={12} color="#052e1b" />
              <Text style={s.honorText}>For Honor</Text>
            </View>
          ) : (
            <Text style={s.price}>${price}</Text>
          )}
          <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
        </View>
        </View>
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username: resolvedUsername, title, price, distance, location: location ?? undefined, description, user_id, work_type, poster_avatar: poster_avatar ?? undefined, is_for_honor: isForHonor }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

export const BountyCompactItem = React.memo(BountyCompactItemComponent, (prev, next) =>
  prev.id === next.id &&
  prev.title === next.title &&
  prev.username === next.username &&
  prev.price === next.price &&
  prev.distance === next.distance &&
  prev.location === next.location &&
  prev.description === next.description &&
  prev.isForHonor === next.isForHonor &&
  prev.user_id === next.user_id &&
  prev.work_type === next.work_type &&
  prev.poster_avatar === next.poster_avatar &&
  prev.incomplete === next.incomplete &&
  prev.missingSummary === next.missingSummary &&
  prev.dateLabel === next.dateLabel &&
  prev.style === next.style
)

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(2,44,34,0.55)' : t.surface,
      borderRadius: SPACING.ELEMENT_GAP,
      paddingHorizontal: SPACING.ELEMENT_GAP,
      paddingVertical: SPACING.ELEMENT_GAP,
      marginBottom: 10,
      minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
      borderWidth: t.isDark ? 0 : 1,
      borderColor: t.border,
    },
    // With an attribution line the card becomes a column: that line, then the
    // usual avatar / content / price row beneath it.
    rowStacked: {
      flexDirection: 'column',
      alignItems: 'stretch',
    },
    rowInner: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'stretch',
      flex: 1,
    },
    // Who did the work, above the title. Body-sized rather than the row's small
    // meta type: it's the line the section is about, not fine print.
    dateText: {
      color: t.text,
      fontSize: TYPOGRAPHY.SIZE_BODY,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_BODY),
      fontWeight: '600',
      marginBottom: 4,
      flexShrink: 1,
    },
    leadingAvatarWrap: {
      marginRight: SPACING.ELEMENT_GAP,
    },
    avatar: {
      width: 36,
      height: 36,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.5)' : t.border,
    },
    avatarFallback: {
      backgroundColor: t.isDark ? '#064e3b' : t.surfaceSecondary,
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: t.isDark ? '#a7f3d0' : t.primaryLight,
      fontSize: 12,
      fontWeight: '700',
    },
    mainContent: {
      flex: 1,
      justifyContent: 'center',
      minHeight: SIZING.MIN_TOUCH_TARGET,
    },
    title: {
      color: t.text,
      fontWeight: '700',
      fontSize: TYPOGRAPHY.SIZE_BODY,
      lineHeight: getLineHeight(TYPOGRAPHY.SIZE_BODY),
      marginBottom: 4,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      flexShrink: 1,
    },
    limitedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 3,
    },
    limitedText: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      fontWeight: '600',
      flexShrink: 1,
    },
    username: {
      color: t.isDark ? '#a7f3d0' : t.primary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.textSecondary,
      marginHorizontal: 6,
      opacity: 0.9,
    },
    distance: {
      color: t.textSecondary,
      fontSize: TYPOGRAPHY.SIZE_XSMALL,
      flexShrink: 1,
    },
    onlineBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.isDark ? 'rgba(16,185,129,0.15)' : 'rgba(5,150,105,0.08)',
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: SPACING.COMPACT_GAP,
      gap: 2,
    },
    onlineText: {
      fontSize: 10,
      fontWeight: '600',
      color: t.primary,
    },
    trailing: {
      alignItems: 'flex-end',
      justifyContent: 'center',
      marginLeft: SPACING.ELEMENT_GAP,
    },
    price: {
      color: t.isDark ? '#fcd34d' : t.primary,
      fontWeight: '800',
      fontSize: 16,
      marginBottom: 2,
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#a7f3d0',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 4,
      gap: 4,
      marginBottom: 2,
    },
    honorText: {
      color: '#052e1b',
      fontWeight: '800',
      fontSize: 12,
    },
  })
}

export default BountyCompactItem
