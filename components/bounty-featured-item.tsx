"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { LinearGradient } from 'expo-linear-gradient'
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { useHapticFeedback } from '../lib/haptic-feedback'
import type { AttachmentMeta } from '../lib/services/database.types'
import { useAppThemeContext } from '../lib/themes/AppThemeContext'
import type { AppTheme } from '../lib/themes/types'
import { BountyDetailModal } from "./bountydetailmodal"

const COVER_HEIGHT = 165

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
  attachments_json?: string
}

function BountyFeaturedItemComponent({
  id, title, username, price, distance, description,
  isForHonor, user_id, work_type, poster_avatar,
  categoryColor, categoryLabel, attachments_json,
}: BountyFeaturedItemProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])

  const [showDetail, setShowDetail] = useState(false)
  const { triggerHaptic } = useHapticFeedback()
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(user_id ?? undefined)
  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...')

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
            <Image source={{ uri: firstImageUri }} style={s.cover} resizeMode="cover" />
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

          {/* Category chip overlaid on image bottom-left */}
          <View style={[s.coverChip, { backgroundColor: categoryColor }]}>
            <Text style={s.coverChipText}>{categoryLabel}</Text>
          </View>

          {/* Info below cover — banner green */}
          <LinearGradient
            colors={['#064e3b', '#059669']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={s.info}
          >
            <Text style={s.title} numberOfLines={2}>{title}</Text>
            {description ? (
              <Text style={s.description} numberOfLines={1}>{description}</Text>
            ) : null}
            <View style={s.metaRow}>
              {isForHonor ? (
                <View style={s.honorBadge}>
                  <MaterialIcons name="favorite" size={11} color="#064e3b" />
                  <Text style={s.honorText}>For Honor</Text>
                </View>
              ) : (
                <Text style={s.price}>${price}</Text>
              )}
              <Text style={s.username} numberOfLines={1}>@{resolvedUsername}</Text>
            </View>
          </LinearGradient>
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
  prev.categoryColor === next.categoryColor &&
  prev.attachments_json === next.attachments_json
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
    info: {
      padding: 12,
      gap: 4,
    },
    title: {
      fontSize: 15,
      fontWeight: '800',
      color: '#ffffff',
      lineHeight: 21,
      letterSpacing: -0.2,
    },
    description: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.72)',
      lineHeight: 17,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 2,
    },
    price: {
      fontSize: 16,
      fontWeight: '800',
      color: '#fcd34d',
    },
    honorBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255,255,255,0.88)',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 3,
      gap: 4,
    },
    honorText: {
      color: '#064e3b',
      fontWeight: '800',
      fontSize: 11,
    },
    username: {
      fontSize: 12,
      color: 'rgba(255,255,255,0.60)',
    },
  })
}