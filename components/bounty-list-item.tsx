"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useEffect, useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { SPACING, SIZING, TYPOGRAPHY } from '../lib/constants/accessibility'
import { useNormalizedProfile } from '../hooks/useNormalizedProfile'
import { BountyDetailModal } from "./bountydetailmodal"

export interface BountyListItemProps {
  id: number
  title: string
  username?: string
  price: number
  distance: number | null
  description?: string
  isForHonor?: boolean
  user_id?: string
  work_type?: 'online' | 'in_person'
}

export function BountyListItem({ id, title, username, price, distance, description, isForHonor, user_id, work_type }: BountyListItemProps) {
  const [showDetail, setShowDetail] = useState(false)
  const { profile: posterProfile, loading: profileLoading } = useNormalizedProfile(user_id)

  const [resolvedUsername, setResolvedUsername] = useState<string>(username || 'Loading...')

  useEffect(() => {
    // Priority: explicit prop username -> posterProfile (resolved by user_id) -> 'Unknown Poster'
    // Never fall back to the current user's profile
    if (username) {
      setResolvedUsername(username)
      return
    }

    if (posterProfile?.username) {
      setResolvedUsername(posterProfile.username)
      return
    }

    // Only show 'Unknown Poster' if we're done loading
    if (!profileLoading) {
      setResolvedUsername('Unknown Poster')
    }
  }, [username, posterProfile?.username, profileLoading])



  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.row}
        onPress={() => setShowDetail(true)}
        accessibilityRole="button"
        accessibilityLabel={`Bounty: ${title} by ${resolvedUsername}${isForHonor ? ', for honor' : `, $${price}`}${work_type === 'online' ? ', online work' : distance !== null ? `, ${distance} miles away` : ', location to be determined'}`}
        accessibilityHint="Tap to view bounty details and apply"
      >
        {/* Leading icon/avatar */}
        <View style={styles.leadingIconWrap}>
          <MaterialIcons 
            name="paid" 
            size={18} 
            color="#a7f3d0" 
            accessibilityElementsHidden={true}
          />
        </View>

        {/* Main content */}
        <View style={styles.mainContent}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.username}>{resolvedUsername}</Text>
            <View style={styles.dot} />
            {work_type === 'online' ? (
              <View style={styles.onlineBadge}>
                <MaterialIcons name="wifi" size={10} color="#10b981" />
                <Text style={styles.onlineText}>Online</Text>
              </View>
            ) : distance === null ? (
              <Text style={styles.distance}>Location TBD</Text>
            ) : (
              <Text style={styles.distance}>{distance} mi</Text>
            )}
          </View>
        </View>

        {/* Trailing price and chevron */}
        <View style={styles.trailing}>
          {isForHonor ? (
            <View style={styles.honorBadge}>
              <MaterialIcons name="favorite" size={12} color="#052e1b" />
              <Text style={styles.honorText}>For Honor</Text>
            </View>
          ) : (
            <Text style={styles.price}>${price}</Text>
          )}
          <MaterialIcons name="chevron-right" size={20} color="#d1fae5" />
        </View>
      </TouchableOpacity>

      {showDetail && (
        <BountyDetailModal
          bounty={{ id, username: resolvedUsername, title, price, distance, description, user_id, work_type }}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(2,44,34,0.55)', // emerald-900/55 overlay
    borderRadius: SPACING.ELEMENT_GAP,
    paddingHorizontal: SPACING.ELEMENT_GAP,
    paddingVertical: SPACING.ELEMENT_GAP,
    marginBottom: 10,
    minHeight: SIZING.MIN_TOUCH_TARGET + SPACING.ELEMENT_GAP,
  },
  leadingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#064e3b', // dark emerald
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.ELEMENT_GAP,
    borderWidth: 1,
    borderColor: '#6ee7b780', // emerald-400/50
  },
  mainContent: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: TYPOGRAPHY.SIZE_DEFAULT,
    lineHeight: Math.round(TYPOGRAPHY.SIZE_DEFAULT * TYPOGRAPHY.LINE_HEIGHT_TIGHT),
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    color: '#a7f3d0', // emerald-200
    fontSize: TYPOGRAPHY.SIZE_XSMALL,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#a7f3d0',
    marginHorizontal: 6,
    opacity: 0.9,
  },
  distance: {
    color: '#d1fae5', // emerald-100
    fontSize: TYPOGRAPHY.SIZE_XSMALL,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#d1fae5', // emerald-100
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: SPACING.COMPACT_GAP,
    gap: 2,
  },
  onlineText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#065f46', // emerald-800
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: SPACING.ELEMENT_GAP,
  },
  price: {
    color: '#fcd34d', // amber-300
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
    marginLeft: 4,
  },
})

export default BountyListItem
