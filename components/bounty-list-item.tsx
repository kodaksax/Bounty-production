"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useRouter } from 'expo-router'
import React, { useCallback, useEffect, useState } from "react"
import { Dimensions, StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { SPACING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { useHapticFeedback } from '../lib/haptic-feedback'
import { BountyDetailModal } from "./bountydetailmodal"
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

export interface BountyListItemProps {
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

function BountyListItemComponent({
  id, title, username, price, distance, description,
  isForHonor, user_id, work_type, poster_avatar
}: BountyListItemProps) {
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

  return (
    <>
      <View style={styles.page}>

        {/* Top: poster info */}
        <View style={styles.posterRow}>
          <TouchableOpacity
            onPress={handleAvatarPress}
            disabled={!user_id}
            style={styles.avatarWrap}
            accessibilityRole="button"
            accessibilityLabel={`View ${resolvedUsername}'s profile`}
          >
            <Avatar style={styles.avatar}>
              <AvatarImage src={avatarUrl || "/placeholder.svg?height=48&width=48"} alt={resolvedUsername} />
              <AvatarFallback style={styles.avatarFallback}>
                <Text style={styles.avatarText}>
                  {resolvedUsername.substring(0, 2).toUpperCase()}
                </Text>
              </AvatarFallback>
            </Avatar>
          </TouchableOpacity>
          <View>
            <Text style={styles.posterName}>{resolvedUsername}</Text>
            <Text style={styles.posterLabel}>posted a bounty</Text>
          </View>
          <View style={styles.workTypeBadge}>
            {work_type === 'online' ? (
              <View style={styles.onlineBadge}>
                <MaterialIcons name="wifi" size={12} color="#059669" />
                <Text style={styles.onlineText}>Remote</Text>
              </View>
            ) : (
              <View style={styles.inPersonBadge}>
                <MaterialIcons name="place" size={12} color="#f59e0b" />
                <Text style={styles.inPersonText}>In Person</Text>
              </View>
            )}
          </View>
        </View>

        {/* Center: main content */}
        <View style={styles.mainContent}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            {isForHonor && (
              <View style={styles.honorBadgeLarge}>
                <MaterialIcons name="favorite" size={16} color="#92400E" />
                <Text style={styles.honorBadgeLargeText}>For Honor</Text>
              </View>
            )}
          </View>

          {description ? (
            <Text style={styles.description} numberOfLines={4}>{description}</Text>
          ) : null}

          <View style={styles.locationRow}>
            <MaterialIcons
              name={work_type === 'online' ? 'wifi' : 'near-me'}
              size={14}
              color="#6B7280"
            />
            <Text style={styles.locationText}>
              {work_type === 'online'
                ? 'Remote work'
                : distance !== null
                  ? `${distance} miles away`
                  : 'Location TBD'}
            </Text>
          </View>
        </View>

        {/* Bottom: price + CTA */}
        <View style={styles.footer}>
          <View style={styles.priceBlock}>
            {isForHonor ? (
              <>
                <Text style={styles.priceLabelHonor}>Reward</Text>
                <Text style={styles.priceValueHonor}>Honor </Text>
              </>
            ) : (
              <>
                <Text style={styles.priceLabelHonor}>Bounty</Text>
                <Text style={styles.priceValue}>${price}</Text>
              </>
            )}
          </View>
          <TouchableOpacity
            style={styles.applyButton}
            onPress={handleBountyPress}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Apply to bounty: ${title}`}
          >
            <Text style={styles.applyButtonText}>View & Apply</Text>
            <MaterialIcons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>

      </View>

      {showDetail && (
        <BountyDetailModal
          bounty={{
            id, username: resolvedUsername, title, price,
            distance, description, user_id, work_type,
            poster_avatar, is_for_honor: isForHonor
          }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

export const BountyListItem = React.memo(BountyListItemComponent, (prev, next) =>
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

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingHorizontal: SPACING.SCREEN_HORIZONTAL,
    paddingVertical: 24,
    paddingBottom: 120,
    justifyContent: 'space-between',
  },

  // Poster row
  posterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  avatarWrap: {},
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: 'rgba(16, 185, 129, 0.5)',
  },
  avatarFallback: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#6ee7b7',
  },
  posterName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f9fafb',
  },
  posterLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 1,
  },
  workTypeBadge: {
    marginLeft: 'auto',
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  onlineText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6ee7b7',
  },
  inPersonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  inPersonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fbbf24',
  },

  // Main content
  mainContent: {
    gap: 12,
    marginTop: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  honorBadgeLarge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  honorBadgeLargeText: {
    color: '#fbbf24',
    fontWeight: '700',
    fontSize: 13,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#f9fafb',
    letterSpacing: -0.5,
    lineHeight: 34,
    flex: 1,
  },
  description: {
    fontSize: 15,
    color: '#9ca3af',
    lineHeight: 22,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationText: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '500',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#141414',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#262626',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  priceBlock: {
    gap: 2,
  },
  priceLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4b5563',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priceValue: {
    fontSize: 26,
    fontWeight: '800',
    color: '#059669',
  },
  priceLabelHonor: {
    fontSize: 11,
    fontWeight: '800',
    color: '#059669',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  priceValueHonor: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fbbf24',
  },
  applyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#059669',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    shadowColor: '#059669',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  applyButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
})