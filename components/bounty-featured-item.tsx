"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { LinearGradient } from 'expo-linear-gradient'
import { Animated, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { useHapticFeedback } from '../lib/haptic-feedback'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BountyDetailModal } from "./bountydetailmodal"
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'

export interface BountyFeaturedItemProps {
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
  categoryColor: string
  categoryLabel: string
}

function BountyFeaturedItemComponent({
  id, title, username, price, distance, description,
  isForHonor, user_id, work_type, poster_avatar,
  categoryColor, categoryLabel,
}: BountyFeaturedItemProps) {
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

  const scaleAnim = useRef(new Animated.Value(1)).current

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1.02, useNativeDriver: true, speed: 24, bounciness: 5 }).start()
  }, [scaleAnim])

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 24, bounciness: 5 }).start()
  }, [scaleAnim])

  const handlePress = useCallback(() => {
    triggerHaptic('light')
    setShowDetail(true)
  }, [triggerHaptic])

  return (
    <>
      <Animated.View style={{ transform: [{ scale: scaleAnim }], flex: 1 }}>
      <TouchableOpacity
        activeOpacity={0.82}
        style={s.card}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        accessibilityRole="button"
        accessibilityLabel={`Featured: ${title} by ${resolvedUsername}`}
        accessibilityHint="Tap to view bounty details"
      >
        {/* Glass sheen — diagonal highlight across the top half */}
        <LinearGradient
          colors={['rgba(255,255,255,0.09)', 'rgba(255,255,255,0)']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
          pointerEvents="none"
        />
        <View style={s.content}>
          {/* Header row: category chip + avatar */}
          <View style={s.header}>
            <View style={[s.categoryChip, { backgroundColor: categoryColor + '22', borderColor: categoryColor + '55' }]}>
              <Text style={[s.categoryChipText, { color: categoryColor }]}>{categoryLabel}</Text>
            </View>
            <TouchableOpacity
              onPress={handleAvatarPress}
              disabled={!user_id}
              accessibilityRole="button"
              accessibilityLabel={`View ${resolvedUsername}'s profile`}
            >
              <Avatar style={[s.avatar, { borderColor: theme.border }]}>
                <AvatarImage src={avatarUrl || "/placeholder.svg?height=32&width=32"} alt={resolvedUsername} />
                <AvatarFallback style={s.avatarFallback}>
                  <Text style={s.avatarText}>
                    {resolvedUsername.substring(0, 2).toUpperCase()}
                  </Text>
                </AvatarFallback>
              </Avatar>
            </TouchableOpacity>
          </View>

          {/* Title — larger than grid cards */}
          <Text style={s.title} numberOfLines={2}>{title}</Text>

          {/* Description preview */}
          {description ? (
            <Text style={s.description} numberOfLines={2}>{description}</Text>
          ) : null}

          {/* Footer: price + username + CTA */}
          <View style={s.footer}>
            <View style={s.footerMeta}>
              {isForHonor ? (
                <View style={s.honorBadge}>
                  <MaterialIcons name="favorite" size={12} color="#052e1b" />
                  <Text style={s.honorText}>For Honor</Text>
                </View>
              ) : (
                <Text style={s.price}>${price}</Text>
              )}
              <Text style={s.username} numberOfLines={1}>@{resolvedUsername}</Text>
            </View>
            <TouchableOpacity
              style={s.applyBtn}
              onPress={handlePress}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="View and apply for this bounty"
            >
              <Text style={s.applyBtnText}>View & Apply</Text>
              <MaterialIcons name="arrow-forward" size={14} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
      </Animated.View>

      {showDetail && (
        <BountyDetailModal
          bounty={{
            id, username: resolvedUsername, title, price, distance,
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
  prev.user_id === next.user_id &&
  prev.categoryColor === next.categoryColor
)

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      flex: 1,
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.1)' : 'rgba(5,150,105,0.05)',
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(110,231,183,0.28)' : 'rgba(5,150,105,0.22)',
      borderTopWidth: 3,
      borderTopColor: '#059669',
      overflow: 'hidden',
      shadowColor: '#059669',
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: t.isDark ? 0.35 : 0.18,
      shadowRadius: 16,
      elevation: 6,
    },
    content: {
      flex: 1,
      padding: 14,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    categoryChip: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 20,
      borderWidth: 1,
    },
    categoryChipText: {
      fontSize: 11,
      fontWeight: '700',
    },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: 16,
      borderWidth: 2,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 11,
      fontWeight: '800',
      color: t.text,
    },
    title: {
      fontSize: 17,
      fontWeight: '800',
      color: t.text,
      lineHeight: 23,
      marginBottom: 6,
      letterSpacing: -0.3,
    },
    description: {
      fontSize: 13,
      color: t.textSecondary,
      lineHeight: 18,
      marginBottom: 12,
    },
    footer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: t.surfaceSecondary,
    },
    footerMeta: {
      gap: 2,
    },
    price: {
      fontSize: 20,
      fontWeight: '800',
      color: '#fcd34d',
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#9CA3AF',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      gap: 4,
    },
    honorText: {
      color: '#052e1b',
      fontWeight: '800',
      fontSize: 11,
    },
    username: {
      fontSize: 11,
      color: t.textSecondary,
    },
    applyBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: '#059669',
    },
    applyBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 13,
    },
  })
}
