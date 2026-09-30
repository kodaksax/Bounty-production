"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import { EmptyState } from "components/ui/empty-state"
import { ConversationsListSkeleton } from "components/ui/skeleton-loaders"
import { useRouter } from "expo-router"
import { ROUTES } from "lib/routes"
import { useAppThemeContext } from "../../lib/themes/AppThemeContext"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
} from "react-native"
import { Swipeable } from "react-native-gesture-handler"
import { useSafeAreaInsets } from "react-native-safe-area-context"

import { ConnectionStatus } from "../../components/connection-status"
import {
  SEARCH_FIELD_MAX_FONT_SCALE,
  SEARCH_FIELD_TEXT,
  SearchBarRow,
} from "../../components/ui/search-bar-row"
import { OfflineStatusBadge } from "../../components/offline-status-badge"
import { WalletBalanceButton } from "../../components/ui/wallet-balance-button"

import { useConversations } from "../../hooks/useConversations"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useValidUserId } from "../../hooks/useValidUserId"

import { messageService } from "../../lib/services/message-service"
import { logClientError as _logClientError } from "../../lib/services/monitoring"
import { generateInitials } from "../../lib/services/supabase-messaging"

import type { UserProfile } from "../../lib/types"
import { userSearchService } from "../../lib/services/user-search-service"
import {
  buildVisibleConversationRows,
  formatConversationTime,
  type ConversationRow,
} from "../../lib/utils/conversation-rows"
import { ChatDetailScreen } from "./chat-detail-screen"

const { width } = Dimensions.get("window")

const USER_SEARCH_DEBOUNCE_MS = 300

export function MessengerScreen({
  activeScreen,
  onNavigate,
  onConversationModeChange,
}: {
  activeScreen: string
  onNavigate: (screen: string) => void
  onConversationModeChange?: (inConversation: boolean) => void
}) {
  const router = useRouter()
  const isStandalone = !onNavigate
  const { theme } = useAppThemeContext()
  const insets = useSafeAreaInsets()
  const currentUserId = useValidUserId()
  const { conversations, loading, error, markAsRead, deleteConversation, refresh } =
    useConversations()
  // One row per person (#875), leaving out people with no messages yet; see
  // lib/utils/conversation-rows.ts.
  const conversationRows = useMemo(
    () => buildVisibleConversationRows(conversations, currentUserId),
    [conversations, currentUserId]
  )

  const [activeConversation, setActiveConversation] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showChat, setShowChat] = useState(false)

  const slideAnim = useRef(new Animated.Value(0)).current

  const chatTranslateX = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [width, 0],
  })

  const inboxOpacity = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0.6],
  })

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [refresh])

  function isUuid(id?: string | null) {
    if (!id) return false
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  }

  async function markConversationReadSafe(convId: string) {
    try {
      if (isUuid(convId)) {
        await markAsRead(convId)
      } else {
        await messageService.markAsRead(convId).catch(() => {})
      }
    } catch (e) {
      try {
        _logClientError("markConversationReadSafe failed", {
          err: String(e),
          convId,
        })
      } catch {}
    }
  }

  const handleConversationClick = async (conversation: ConversationRow) => {
    // A 1:1 row opens the merged thread with that person — the same screen
    // the profile Message button opens — so every route into a direct
    // conversation shows the full history, not just this one bounty's chat.
    // That thread marks every backing conversation read itself; clearing the
    // badges here too keeps the list honest when the user comes back.
    if (conversation.otherUserId) {
      void Promise.all(conversation.backingConversationIds.map(markConversationReadSafe))
      router.push(ROUTES.MESSAGES.WITH_USER(conversation.otherUserId) as any)
      return
    }

    await markConversationReadSafe(conversation.id)

    setActiveConversation(conversation.id)
    setShowChat(true)

    Animated.timing(slideAnim, {
      toValue: 1,
      duration: 260,
      useNativeDriver: true,
    }).start()
  }

  const handleBackToInbox = useCallback(() => {
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => {
      setShowChat(false)
      setActiveConversation(null)
      onConversationModeChange?.(false)
      refresh()
    })
  }, [refresh, onConversationModeChange, slideAnim])

  const handleDeleteConversation = useCallback(
    (conversation: ConversationRow, displayName: string) => {
      Alert.alert(
        "Delete Conversation",
        `Delete your conversation with ${displayName}? It's removed from your inbox only.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                // The row stands for every conversation with this person.
                await Promise.all(
                  conversation.backingConversationIds.map((id) => deleteConversation(id))
                )
              } catch {
                Alert.alert("Error", "Failed to delete conversation")
              }
            },
          },
        ]
      )
    },
    [deleteConversation]
  )

  const renderConversationItem = useCallback(
    ({ item }: { item: ConversationRow }) => (
      <ConversationItem
        conversation={item}
        onPress={() => handleConversationClick(item)}
        onDelete={(displayName) => handleDeleteConversation(item, displayName)}
      />
    ),
    [handleConversationClick, handleDeleteConversation]
  )

  const keyExtractor = useCallback((item: ConversationRow) => item.id, [])

  // User search — the bar at the top finds people to message. Results replace
  // the conversation list while there's a query; tapping one opens the DM.
  const [query, setQuery] = useState("")
  const [userResults, setUserResults] = useState<UserProfile[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const searchRequestIdRef = useRef(0)
  const trimmedQuery = query.trim()
  const isSearchActive = trimmedQuery.length > 0

  useEffect(() => {
    if (!trimmedQuery) {
      searchRequestIdRef.current++
      setUserResults([])
      setIsSearching(false)
      return
    }
    const requestId = ++searchRequestIdRef.current
    setIsSearching(true)
    const timer = setTimeout(async () => {
      try {
        const result = await userSearchService.searchUsers({ keywords: trimmedQuery, limit: 30 })
        if (requestId !== searchRequestIdRef.current) return
        setUserResults(result.results.filter(u => u.id !== currentUserId))
      } catch {
        if (requestId === searchRequestIdRef.current) setUserResults([])
      } finally {
        if (requestId === searchRequestIdRef.current) setIsSearching(false)
      }
    }, USER_SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmedQuery, currentUserId])

  const handleUserPress = useCallback(
    (user: UserProfile) => {
      Keyboard.dismiss()
      router.push(ROUTES.MESSAGES.WITH_USER(user.id) as any)
    },
    [router]
  )

  const renderUserItem = useCallback(
    ({ item }: { item: UserProfile }) => (
      <UserResultItem user={item} onPress={() => handleUserPress(item)} />
    ),
    [handleUserPress]
  )

  const userKeyExtractor = useCallback((item: UserProfile) => item.id, [])

  const renderUserEmpty = useCallback(() => {
    if (isSearching) return null
    return (
      <EmptyState
        icon="person-search"
        title="No Users Found"
        description={`No one matches "${trimmedQuery}". Try a different username.`}
      />
    )
  }, [isSearching, trimmedQuery])

  const handleWalletPress = useCallback(() => {
    if (onNavigate) onNavigate("wallet")
    else router.push(ROUTES.TABS.WALLET as never)
  }, [onNavigate, router])

  const renderEmpty = useCallback(() => {
    if (loading) {
      return <ConversationsListSkeleton count={6} />
    }
    if (error) {
      return (
        <EmptyState
          icon="cloud-off"
          title="Unable to Load Messages"
          description="Check your internet connection and try again"
          actionLabel="Try Again"
          onAction={handleRefresh}
        />
      )
    }
    return (
      <EmptyState
        icon="chat-bubble-outline"
        title="No Messages Yet"
        description="When you apply to or post a bounty, your conversations will appear here."
      />
    )
  }, [loading, error, handleRefresh])

  if (showChat && activeConversation) {
    const conversation = conversations.find(c => c.id === activeConversation)
    if (conversation) {
      return (
        <View style={{ flex: 1 }}>
          <Animated.View style={{ flex: 1, opacity: inboxOpacity }}>
            <View style={{ flex: 1, backgroundColor: theme.background }}>
              <FlatList
                data={conversationRows}
                keyExtractor={keyExtractor}
                renderItem={renderConversationItem}
              />
            </View>
          </Animated.View>

          <Animated.View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              transform: [{ translateX: chatTranslateX }],
              backgroundColor: theme.background,
              zIndex: 50,
            }}
          >
            <ChatDetailScreen conversation={conversation} onBack={handleBackToInbox} />
          </Animated.View>
        </View>
      )
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ConnectionStatus />

      {/* Header — mirrors the inbox screen: logo left, wallet right, then a
          centered uppercase title. */}
      <View style={{ paddingTop: insets.top + 8, backgroundColor: theme.background }}>
        <View className="flex-row justify-between items-center px-4">
          <View className="flex-row items-center">
            {isStandalone && (
              <TouchableOpacity
                onPress={() => router.back()}
                className="mr-2 p-1 touch-target-min"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <MaterialIcons name="arrow-back" size={24} color={theme.text} />
              </TouchableOpacity>
            )}
            <BrandingLogo size="medium" />
          </View>
          <WalletBalanceButton onPress={handleWalletPress} />
        </View>

        <View className="px-4 mt-2 mb-2">
          <OfflineStatusBadge />
        </View>

        <SearchBarRow
          emphasis={isSearchActive}
          style={{ marginTop: theme.spacing.xs, marginBottom: theme.spacing.md }}
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search users..."
            placeholderTextColor={theme.textDisabled}
            maxFontSizeMultiplier={SEARCH_FIELD_MAX_FONT_SCALE}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{
              ...SEARCH_FIELD_TEXT,
              flex: 1,
              color: theme.text,
              alignSelf: "stretch",
              paddingVertical: 0,
              paddingHorizontal: 0,
              textAlignVertical: "center",
              includeFontPadding: false,
            }}
            accessibilityRole="search"
            accessibilityLabel="Search users"
          />
          {isSearching ? (
            <ActivityIndicator
              size="small"
              color={theme.primaryLight}
              accessibilityLabel="Searching users"
            />
          ) : (
            !!query && (
              <TouchableOpacity
                onPress={() => setQuery("")}
                style={{ padding: 4 }}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <MaterialIcons name="close" size={18} color={theme.primaryLight} />
              </TouchableOpacity>
            )
          )}
        </SearchBarRow>
      </View>

      {isSearchActive ? (
        <FlatList
          data={userResults}
          keyExtractor={userKeyExtractor}
          renderItem={renderUserItem}
          ListEmptyComponent={renderUserEmpty}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            paddingBottom: insets.bottom + theme.spacing["2xl"],
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        <FlatList
          data={conversationRows}
          keyExtractor={keyExtractor}
          renderItem={renderConversationItem}
          ListEmptyComponent={renderEmpty}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{
            paddingBottom: insets.bottom + theme.spacing["2xl"],
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={theme.primary}
              colors={[theme.primary]}
            />
          }
        />
      )}
    </View>
  )
}

export default MessengerScreen

/** A user search result, laid out like a conversation row. */
const UserResultItem = React.memo(function UserResultItem({
  user,
  onPress,
}: {
  user: UserProfile
  onPress: () => void
}) {
  const { theme } = useAppThemeContext()
  const displayName = user.name || user.username

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Message ${displayName}`}
      accessibilityHint="Opens a conversation with this user"
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: theme.spacing.md,
        paddingHorizontal: theme.spacing.lg,
        backgroundColor: theme.background,
      }}
    >
      <Avatar className="h-12 w-12" style={{ marginRight: theme.spacing.md }}>
        <AvatarImage src={user.avatar} alt={displayName} />
        <AvatarFallback style={{ backgroundColor: theme.surfaceSecondary }}>
          <Text style={{ color: theme.primary, fontSize: 15, fontWeight: "700" }}>
            {generateInitials(user.username, user.name) || "?"}
          </Text>
        </AvatarFallback>
      </Avatar>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={{ fontSize: theme.typography.fontSize.base, fontWeight: "600", color: theme.text }}
        >
          {displayName}
        </Text>
        {!!user.name && (
          <Text
            numberOfLines={1}
            style={{
              fontSize: theme.typography.fontSize.sm,
              color: theme.textSecondary,
              marginTop: 2,
            }}
          >
            @{user.username}
          </Text>
        )}
      </View>

      <MaterialIcons name="chat-bubble-outline" size={20} color={theme.textDisabled} />
    </TouchableOpacity>
  )
})

interface ConversationItemProps {
  conversation: ConversationRow
  onPress: () => void
  onDelete: (displayName: string) => void
}

const ConversationItem = React.memo(function ConversationItem({
  conversation,
  onPress,
  onDelete,
}: ConversationItemProps) {
  const { theme } = useAppThemeContext()
  const router = useRouter()
  const time = useMemo(
    () => formatConversationTime(conversation.updatedAt),
    [conversation.updatedAt]
  )
  const unread = conversation.unread ?? 0
  const hasUnread = unread > 0

  const otherUserId = conversation.otherUserId
  // fetchConversations already batch-loads every other user's name/avatar
  // (lib/services/supabase-messaging.ts), so only fall back to a live,
  // per-row profile fetch when that batched avatar is missing (#875).
  // Disabled for groups: with no id the hook would resolve to the viewer's
  // own profile.
  const needsProfileFallback = !!otherUserId && !conversation.avatar
  const { profile } = useNormalizedProfile(otherUserId ?? undefined, {
    enabled: needsProfileFallback,
  })
  const person = needsProfileFallback ? profile : null
  const displayName = person?.username || conversation.name || "Conversation"
  const avatarUrl = person?.avatar || conversation.avatar
  const initials = person
    ? generateInitials(person.username, person.name)
    : generateInitials(conversation.name)

  const handleAvatarPress = useCallback(() => {
    if (otherUserId) {
      const referrer = encodeURIComponent("/tabs/bounty-app?screen=messages")
      router.push(`/profile/${otherUserId}?referrer=${referrer}`)
    }
  }, [otherUserId, router])

  return (
    <Swipeable
      renderRightActions={() => (
        <TouchableOpacity
          onPress={() => onDelete(displayName)}
          accessibilityRole="button"
          accessibilityLabel={`Delete conversation with ${displayName}`}
          style={{
            backgroundColor: theme.error,
            justifyContent: "center",
            alignItems: "center",
            paddingHorizontal: theme.spacing.xl,
          }}
        >
          <MaterialIcons name="delete-outline" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={
          hasUnread
            ? `${displayName}, ${unread} unread. ${conversation.lastMessage ?? ""}`
            : `${displayName}. ${conversation.lastMessage ?? ""}`
        }
        accessibilityHint="Opens the conversation"
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: theme.spacing.md,
          paddingHorizontal: theme.spacing.lg,
          backgroundColor: theme.background,
        }}
      >
        <TouchableOpacity
          onPress={handleAvatarPress}
          disabled={!otherUserId}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`View ${displayName}'s profile`}
          style={{ marginRight: theme.spacing.md }}
        >
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarUrl} alt={displayName} />
            <AvatarFallback style={{ backgroundColor: theme.surfaceSecondary }}>
              <Text style={{ color: theme.primary, fontSize: 15, fontWeight: "700" }}>
                {initials || "?"}
              </Text>
            </AvatarFallback>
          </Avatar>
        </TouchableOpacity>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
          >
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                marginRight: theme.spacing.sm,
                fontSize: theme.typography.fontSize.base,
                fontWeight: hasUnread ? "700" : "600",
                color: theme.text,
              }}
            >
              {displayName}
            </Text>
            <Text
              style={{
                fontSize: theme.typography.fontSize.xs,
                fontWeight: hasUnread ? "600" : "400",
                color: hasUnread ? theme.primary : theme.textDisabled,
              }}
            >
              {time}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                marginRight: hasUnread ? theme.spacing.sm : 0,
                fontSize: theme.typography.fontSize.sm,
                fontWeight: hasUnread ? "500" : "400",
                color: hasUnread ? theme.text : theme.textSecondary,
              }}
            >
              {conversation.lastMessage || "No messages yet"}
            </Text>
            {hasUnread && (
              <View
                accessibilityElementsHidden={true}
                importantForAccessibility="no"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.primary,
                }}
              />
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  )
})
