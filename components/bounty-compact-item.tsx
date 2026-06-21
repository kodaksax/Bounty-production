"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
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
  description?: string
  isForHonor?: boolean
  user_id?: string | null
  work_type?: 'online' | 'in_person'
  poster_avatar?: string
}

function BountyCompactItemComponent({
  id, title, username, price, distance, description,
  isForHonor, user_id, work_type, poster_avatar
}: BountyCompactItemProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [showDetail, setShowDetail] = useState(false)
  const router = useRouter()
  const { triggerHaptic } = useHapticFeedback()
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(user_id ?? undefined)
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

  const accessibilityLabel = `Bounty: ${title} by ${resolvedUsername}${isForHonor ? ', for honor' : `, $${price}`}${work_type === 'online' ? ', online work' : distance !== null ? `, ${distance} miles away` : ', location to be determined'}`

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        style={s.row}
        onPress={handleBountyPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Tap to view bounty details and apply"
      >
        {/* Leading avatar */}
        <TouchableOpacity
          onPress={handleAvatarPress}
          disabled={!user_id}
          style={s.leadingAvatarWrap}
          accessibilityRole="button"
          accessibilityLabel={`View ${resolvedUsername}'s profile`}
        >
          <Avatar style={s.avatar}>
            <AvatarImage src={avatarUrl || "/placeholder.svg?height=36&width=36"} alt={resolvedUsername} />
            <AvatarFallback style={s.avatarFallback}>
              <Text style={s.avatarText}>
                {resolvedUsername.substring(0, 2).toUpperCase()}
              </Text>
            </AvatarFallback>
          </Avatar>
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
            ) : distance === null ? (
              <Text style={s.distance}>Location TBD</Text>
            ) : (
              <Text style={s.distance}>{distance} mi</Text>
            )}
          </View>
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
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username: resolvedUsername, title, price, distance, description, user_id, work_type, poster_avatar, is_for_honor: isForHonor }}
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
  prev.description === next.description &&
  prev.isForHonor === next.isForHonor &&
  prev.user_id === next.user_id &&
  prev.work_type === next.work_type &&
  prev.poster_avatar === next.poster_avatar
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
