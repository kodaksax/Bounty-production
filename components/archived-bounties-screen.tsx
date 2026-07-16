"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { useEffect, useMemo, useState } from "react"
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import type { Bounty } from "lib/services/database.types"
import { bountyService } from "lib/services/bounty-service"
import { getCurrentUserId } from "lib/utils/data-utils"
import { useAppThemeContext } from "../lib/themes/AppThemeContext"
import type { AppTheme } from "../lib/themes/types"
import { ArchivedBountyCard } from "./archived-bounty-card"
import { ScreenHeader } from "./ui/screen-header"

interface ArchivedBountiesScreenProps {
  onBack?: () => void
}

export function ArchivedBountiesScreen({ onBack }: ArchivedBountiesScreenProps) {
  const { theme } = useAppThemeContext()
  const insets = useSafeAreaInsets()
  const s = useMemo(() => makeStyles(theme), [theme])
  // Matches the offset used by other tab screens to clear the floating BottomNav
  const bottomNavOffset = Math.max(96, (insets.bottom || 0) + 12)

  const [archivedBounties, setArchivedBounties] = useState<Bounty[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const currentUserId = getCurrentUserId()

  const loadArchivedBounties = async () => {
    try {
      setLoading(true)
      // Load archived bounties for the current user (both as poster and hunter)
      const allBounties = await bountyService.getAll({ status: "archived" })

      // Filter to show bounties where user is either poster or accepted hunter
      const userBounties = allBounties.filter(bounty =>
        bounty.poster_id === currentUserId ||
        bounty.user_id === currentUserId ||
        bounty.accepted_by === currentUserId
      )

      setArchivedBounties(userBounties.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ))
    } catch (error) {
      console.error("Failed to load archived bounties:", error)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await loadArchivedBounties()
    setRefreshing(false)
  }

  useEffect(() => {
    loadArchivedBounties()
  }, [])

  const renderBountyItem = ({ item }: { item: Bounty }) => (
    <ArchivedBountyCard
      id={String(item.id)}
      username={item.username || "@Unknown"}
      title={item.title}
      amount={item.amount}
      distance={item.distance || 0}
      avatarSrc={item.poster_avatar}
      isForHonor={item.is_for_honor}
      workType={item.work_type}
      onMenuClick={() => {
        // TODO: Implement menu actions for archived bounties
      }}
    />
  )

  const isEmpty = archivedBounties.length === 0

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={[s.headerWrapper, { paddingTop: insets.top }]}>
        <ScreenHeader
          showBack
          onBack={onBack}
          centerNode={
            <View style={s.headerTitleRow}>
              <MaterialIcons name="archive" size={18} color={theme.text} />
              <Text style={s.headerTitleText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                Archived Bounties
              </Text>
            </View>
          }
        />
      </View>

      {/* Bounty List */}
      {loading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator size="large" color={theme.primary} />
          <Text style={s.loadingText}>Loading archived bounties...</Text>
        </View>
      ) : (
        <FlatList
          style={s.list}
          data={archivedBounties}
          renderItem={renderBountyItem}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            s.listContent,
            { paddingBottom: bottomNavOffset + Math.max(insets.bottom, 12) + 16 },
            isEmpty && s.listContentEmpty,
          ]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={theme.text}
            />
          }
          ListEmptyComponent={
            <View style={s.emptyState} accessible accessibilityRole="text" accessibilityLabel="No Archived Bounties. Bounties you archive will appear here for future reference.">
              <View style={s.emptyIconBadge}>
                <MaterialIcons name="archive" size={40} color={theme.primary} />
              </View>
              <Text style={s.emptyTitle}>No Archived Bounties</Text>
              <Text style={s.emptyDescription}>
                Bounties you archive will appear here for future reference
              </Text>
            </View>
          }
        />
      )}
    </View>
  )
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    headerWrapper: {
      backgroundColor: t.background,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
      maxWidth: '100%',
    },
    headerTitleText: {
      fontSize: 15,
      fontWeight: '700',
      color: t.text,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      flexShrink: 1,
    },
    list: {
      flex: 1,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    listContentEmpty: {
      flexGrow: 1,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    loadingText: {
      color: t.textSecondary,
      marginTop: 12,
      fontSize: 14,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    emptyIconBadge: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.isDark ? 'rgba(5,150,105,0.16)' : 'rgba(5,150,105,0.1)',
      borderWidth: 1,
      borderColor: t.isDark ? 'rgba(5,150,105,0.35)' : 'rgba(5,150,105,0.25)',
      marginBottom: 20,
    },
    emptyTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: t.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    emptyDescription: {
      fontSize: 14,
      lineHeight: 20,
      color: t.textSecondary,
      textAlign: 'center',
      maxWidth: 280,
    },
  })
}
