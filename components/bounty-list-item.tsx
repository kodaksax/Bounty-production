"use client"

import { MaterialIcons } from "@expo/vector-icons"
import React, { useState } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { BountyDetailModal } from "./bountydetailmodal"

export interface BountyListItemProps {
  id: number
  title: string
  username: string
  price: number
  distance: number
  description?: string
  isForHonor?: boolean
}

export function BountyListItem({ id, title, username, price, distance, description, isForHonor }: BountyListItemProps) {
  const [showDetail, setShowDetail] = useState(false)

  return (
    <>
      <TouchableOpacity
        activeOpacity={0.8}
        style={styles.row}
        onPress={() => setShowDetail(true)}
      >
        {/* Leading icon/avatar */}
        <View style={styles.leadingIconWrap}>
          <MaterialIcons name="paid" size={18} color="#a7f3d0" />
        </View>

        {/* Main content */}
        <View style={styles.mainContent}>
          <Text style={styles.title} numberOfLines={2}>{title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.username}>{username}</Text>
            <View style={styles.dot} />
            <Text style={styles.distance}>{distance} mi</Text>
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
          bounty={{ id, username, title, price, distance, description }}
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
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  leadingIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#064e3b', // dark emerald
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: '#6ee7b780', // emerald-400/50
  },
  mainContent: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  username: {
    color: '#a7f3d0', // emerald-200
    fontSize: 12,
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
    fontSize: 12,
  },
  trailing: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    marginLeft: 12,
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
