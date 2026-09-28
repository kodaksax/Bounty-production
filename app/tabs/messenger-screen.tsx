"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import { EmptyState } from "components/ui/empty-state"
import { ConversationsListSkeleton } from "components/ui/skeleton-loaders"
import { useRouter } from "expo-router"
import { ROUTES } from "lib/routes"
import { useAppThemeContext } from "../../lib/themes/AppThemeContext"
import React, { useCallback, useMemo, useRef, useState } from "react"
import {
  Alert,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
  Animated,
  Dimensions,
} from "react-native"
import { Swipeable } from "react-native-gesture-handler"

import { ConnectionStatus } from "../../components/connection-status"
import { WalletBalanceButton } from "../../components/ui/wallet-balance-button"

import { useConversations } from "../../hooks/useConversations"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useValidUserId } from "../../hooks/useValidUserId"

import { messageService } from "../../lib/services/message-service"
import { logClientError as _logClientError } from "../../lib/services/monitoring"
import { navigationIntent } from "../../lib/services/navigation-intent"
import { generateInitials } from "../../lib/services/supabase-messaging"

import {
  buildConversationRows,
  formatConversationTime,
  type ConversationRow,
} from "../../lib/utils/conversation-rows"
import { ChatDetailScreen } from "./chat-detail-screen"

const { width } = Dimensions.get("window")

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
  const currentUserId = useValidUserId()
  const { conversations, loading, error, markAsRead, deleteConversation, refresh } =
    useConversations()

  // One row per person (#875); see lib/utils/conversation-rows.ts.
  const rows = useMemo(
    () => buildConversationRows(conversations, currentUserId),
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

  const listEmpty = useMemo(() => {
    if (loading) {
      return (
        <View className="px-4 py-2">
          <ConversationsListSkeleton count={6} />
        </View>
      )
    }
    if (error) {
      return (
        <EmptyState
          icon="cloud-off"
          title="Couldn't load messages"
          description="Check your connection and try again."
          actionLabel="Try again"
          onAction={handleRefresh}
        />
      )
    }
    return (
      <EmptyState
        icon="chat-bubble-outline"
        title="No messages yet"
        description="When you apply to a bounty or someone applies to yours, your conversations show up here."
      />
    )
  }, [loading, error, handleRefresh])

  if (showChat && activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) {
      return (
        <View style={{ flex: 1 }}>
          <Animated.View style={{ flex: 1, opacity: inboxOpacity }}>
            <View style={{ flex: 1, backgroundColor: theme.background }}>
              <FlatList
                data={rows}
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
            <ChatDetailScreen
              conversation={conversation}
              onBack={handleBackToInbox}
            />
          </Animated.View>
        </View>
      )
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ConnectionStatus />

      <View
        className="px-4 pt-12 pb-3 border-b"
        style={{ borderBottomColor: theme.border, backgroundColor: theme.background }}
      >
        <View className="flex-row justify-between items-center">
          <View className="flex-row items-center">
            {isStandalone && (
              <TouchableOpacity
                onPress={() => router.back()}
                className="mr-3 p-1"
                accessibilityRole="button"
                accessibilityLabel="Go back"
              >
                <MaterialIcons name="arrow-back" size={24} color={theme.text} />
              </TouchableOpacity>
            )}
            <BrandingLogo size="medium" />
          </View>
          <WalletBalanceButton onPress={() => onNavigate?.("wallet")} />
        </View>
      </View>

      <View className="px-4 py-3">
        <Text className="text-lg font-semibold" style={{ color: theme.text }}>Messages</Text>
      </View>

      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderConversationItem}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 32, flexGrow: 1 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={theme.primary}
            colors={[theme.primary]}
          />
        }
      />
    </View>
  )
}

export default MessengerScreen

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

  const otherUserId = conversation.otherUserId
  // fetchConversations already batch-loads every other user's name/avatar
  // (lib/services/supabase-messaging.ts), so only fall back to a live,
  // per-row profile fetch when that batched avatar is missing -- which is
  // what caused every row to show a letter instead of a picture (#875).
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
    : (conversation.name?.[0] ?? "?").toUpperCase()

  const unread = conversation.unread ?? 0
  const hasUnread = unread > 0
  const preview = conversation.lastMessage

  const handleAvatarPress = useCallback(() => {
    if (otherUserId) {
      const referrer = encodeURIComponent('/tabs/bounty-app?screen=messages')
      router.push(`/profile/${otherUserId}?referrer=${referrer}`)
    }
  }, [otherUserId, router])

  const renderRightActions = useCallback(
    () => (
      <TouchableOpacity
        className="justify-center items-center px-6 rounded-2xl mb-2 ml-2"
        style={{ backgroundColor: theme.error }}
        onPress={() => onDelete(displayName)}
        accessibilityRole="button"
        accessibilityLabel={`Delete conversation with ${displayName}`}
      >
        <MaterialIcons name="delete-outline" size={22} color="white" />
      </TouchableOpacity>
    ),
    [onDelete, displayName, theme.error]
  )

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <TouchableOpacity
        onPress={onPress}
        className="flex-row items-center px-3 py-3 mb-2 rounded-2xl"
        style={{
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: hasUnread ? theme.primary : theme.border,
        }}
        accessibilityRole="button"
        accessibilityLabel={
          hasUnread
            ? `${displayName}, ${unread} unread message${unread === 1 ? "" : "s"}`
            : displayName
        }
      >
        <TouchableOpacity
          onPress={handleAvatarPress}
          disabled={!otherUserId}
          className="mr-3"
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`View ${displayName}'s profile`}
        >
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarUrl || "/placeholder.svg"} alt={displayName} />
            <AvatarFallback style={{ backgroundColor: theme.surfaceSecondary }}>
              <Text style={{ color: theme.textSecondary, fontSize: 14, fontWeight: "600" }}>
                {initials}
              </Text>
            </AvatarFallback>
          </Avatar>
        </TouchableOpacity>

        <View className="flex-1" style={{ minWidth: 0 }}>
          <View className="flex-row items-center justify-between">
            <Text
              className="flex-1 mr-2"
              style={{ color: theme.text, fontSize: 16, fontWeight: hasUnread ? "700" : "600" }}
              numberOfLines={1}
            >
              {displayName}
            </Text>
            <Text
              style={{
                fontSize: 12,
                color: hasUnread ? theme.primaryLight : theme.textDisabled,
                fontWeight: hasUnread ? "600" : "400",
              }}
            >
              {time}
            </Text>
          </View>
          <View className="flex-row items-center justify-between mt-1">
            <Text
              className="flex-1 mr-2"
              style={{
                fontSize: 14,
                color: hasUnread ? theme.text : theme.textSecondary,
                fontStyle: preview ? "normal" : "italic",
              }}
              numberOfLines={1}
            >
              {preview || "No messages yet"}
            </Text>
            {hasUnread && (
              <View
                className="rounded-full items-center justify-center px-1.5"
                style={{ backgroundColor: theme.primary, minWidth: 20, height: 20 }}
              >
                <Text style={{ color: "white", fontSize: 11, fontWeight: "700" }}>
                  {unread > 99 ? "99+" : unread}
                </Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  )
})
