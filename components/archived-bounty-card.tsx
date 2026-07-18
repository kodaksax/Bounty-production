"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { useMemo } from "react"
import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { useAppThemeContext } from "../lib/themes/AppThemeContext"
import type { AppTheme } from "../lib/themes/types"
import { getValidAvatarUrl } from "../lib/utils/avatar-utils"

interface ArchivedBountyCardProps {
  id: string
  username: string
  title: string
  amount: number
  distance: number
  avatarSrc?: string
  isForHonor?: boolean
  workType?: 'online' | 'in_person'
  onMenuClick?: () => void
}

export function ArchivedBountyCard({
  id,
  username,
  title,
  amount,
  distance,
  avatarSrc,
  isForHonor,
  workType,
  onMenuClick,
}: ArchivedBountyCardProps) {
  const { theme } = useAppThemeContext()
  const s = useMemo(() => makeStyles(theme), [theme])
  const validAvatarUrl = getValidAvatarUrl(avatarSrc)

  return (
    <View style={s.card}>
      <View style={s.topRow}>
        <View style={s.userRow}>
          <Avatar style={s.avatar}>
            <AvatarImage src={validAvatarUrl} alt={username} />
            <AvatarFallback style={s.avatarFallback}>
              <Text style={s.avatarFallbackText}>{username.substring(1, 3).toUpperCase()}</Text>
            </AvatarFallback>
          </Avatar>
          <Text style={s.username} numberOfLines={1}>{username}</Text>
        </View>

        <View style={s.archivedPill}>
          <MaterialIcons name="archive" size={11} color={theme.textSecondary} />
          <Text style={s.archivedPillText}>Archived</Text>
        </View>
      </View>

      <Text style={s.title} numberOfLines={2}>{title}</Text>

      <View style={s.badgeRow}>
        {isForHonor ? (
          <View style={s.honorBadge}>
            <Text style={s.honorBadgeText}>For Honor</Text>
          </View>
        ) : (
          <View style={s.amountBadge}>
            <Text style={s.amountBadgeText}>${amount.toLocaleString()}</Text>
          </View>
        )}
        {workType && (
          <View style={s.workTypeBadge}>
            <Text style={s.workTypeBadgeText}>{workType === 'online' ? 'Online' : 'In Person'}</Text>
          </View>
        )}
      </View>

      <View style={s.bottomRow}>
        <View style={s.distanceRow}>
          <MaterialIcons name="place" size={14} color={theme.textDisabled} />
          <Text style={s.distanceText}>{distance} mi</Text>
        </View>
        <TouchableOpacity
          onPress={onMenuClick}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="More options"
        >
          <MaterialIcons name="more-vert" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 12,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    userRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexShrink: 1,
      marginRight: 8,
    },
    avatar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      marginRight: 8,
    },
    avatarFallback: {
      backgroundColor: t.surfaceSecondary,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarFallbackText: {
      color: t.textSecondary,
      fontSize: 9,
      fontWeight: '600',
    },
    username: {
      fontSize: 12,
      color: t.textSecondary,
      flexShrink: 1,
    },
    archivedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: t.surfaceSecondary,
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      gap: 4,
    },
    archivedPillText: {
      fontSize: 10,
      fontWeight: '600',
      color: t.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    title: {
      fontSize: 16,
      fontWeight: '600',
      color: t.text,
      marginBottom: 10,
    },
    badgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 10,
    },
    amountBadge: {
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.18)' : 'rgba(5,150,105,0.1)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    amountBadgeText: {
      color: t.primary,
      fontWeight: '700',
      fontSize: 13,
    },
    honorBadge: {
      backgroundColor: 'rgba(219,39,119,0.14)',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    honorBadgeText: {
      color: '#db2777',
      fontWeight: '700',
      fontSize: 12,
    },
    workTypeBadge: {
      backgroundColor: t.surfaceSecondary,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    workTypeBadgeText: {
      color: t.textSecondary,
      fontSize: 10,
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
    },
    bottomRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingTop: 10,
    },
    distanceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    distanceText: {
      fontSize: 12,
      color: t.textDisabled,
    },
  })
}
