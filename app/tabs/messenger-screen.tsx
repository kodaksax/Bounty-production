"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import { EmptyState } from "components/ui/empty-state"
import { ConversationsListSkeleton } from "components/ui/skeleton-loaders"
import { useRouter } from "expo-router"
import { cn } from "lib/utils"
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
import { OfflineStatusBadge } from "../../components/offline-status-badge"
import { WalletBalanceButton } from "../../components/ui/wallet-balance-button"

import { useConversations } from "../../hooks/useConversations"
import { useNormalizedProfile } from "../../hooks/useNormalizedProfile"
import { useValidUserId } from "../../hooks/useValidUserId"

import { messageService } from "../../lib/services/message-service"
import { logClientError as _logClientError } from "../../lib/services/monitoring"
import { navigationIntent } from "../../lib/services/navigation-intent"
import { generateInitials } from "../../lib/services/supabase-messaging"

import type { Conversation } from "../../lib/types"
import { ChatDetailScreen } from "./chat-detail-screen"

const { width } = Dimensions.get("window")

function formatConversationTime(updatedAt?: string): string {
  if (!updatedAt) return ""

  const date = new Date(updatedAt)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60))

  if (diffHrs < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60))
    if (diffMins < 1) return "Just now"
    return `${diffMins}m ago`
  }
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

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
  const { conversations, loading, error, markAsRead, deleteConversation, refresh } =
    useConversations()

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

  const handleConversationClick = async (id: string) => {
    await markConversationReadSafe(id)

    setActiveConversation(id)
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
    (conversation: Conversation) => {
      Alert.alert(
        "Delete Conversation",
        `Are you sure you want to delete your conversation with ${conversation.name}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteConversation(conversation.id)
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
    ({ item }: { item: Conversation }) => (
      <ConversationItem
        conversation={item}
        onPress={() => handleConversationClick(item.id)}
        onDelete={() => handleDeleteConversation(item)}
      />
    ),
    [handleConversationClick, handleDeleteConversation]
  )

  const keyExtractor = useCallback((item: Conversation) => item.id, [])

  if (showChat && activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) {
      return (
        <View style={{ flex: 1 }}>
          <Animated.View style={{ flex: 1, opacity: inboxOpacity }}>
            <View className="flex-1 bg-[#0B0F14]">
              <FlatList
                data={conversations}
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
              backgroundColor: "#0B0F14",
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
    <View className="flex-1 bg-[#0B0F14]">
      <ConnectionStatus />

      <View className="px-4 pt-12 pb-3 border-b border-[#1F2937] bg-[#0B0F14]">
        <View className="flex-row justify-between items-center">
          <BrandingLogo size="medium" />
          <WalletBalanceButton onPress={() => onNavigate?.("wallet")} />
        </View>
      </View>

      <View className="px-4 py-3">
        <Text className="text-lg font-semibold text-white">Messages</Text>
      </View>

      <FlatList
        data={conversations}
        keyExtractor={keyExtractor}
        renderItem={renderConversationItem}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />
        }
      />
    </View>
  )
}

export default MessengerScreen

interface ConversationItemProps {
  conversation: Conversation
  onPress: () => void
  onDelete: () => void
}

const ConversationItem = React.memo(function ConversationItem({
  conversation,
  onPress,
  onDelete,
}: ConversationItemProps) {
  const time = useMemo(
    () => formatConversationTime(conversation.updatedAt),
    [conversation.updatedAt]
  )

  return (
    <Swipeable
      renderRightActions={() => (
        <TouchableOpacity
          className="bg-red-500 justify-center items-center px-6 rounded-xl mr-2"
          onPress={onDelete}
        >
          <MaterialIcons name="delete" size={22} color="white" />
        </TouchableOpacity>
      )}
    >
      <TouchableOpacity
        onPress={onPress}
        className="flex-row items-center px-3 py-3 mb-2 bg-[#111827] border border-[#1F2937] rounded-2xl"
      >
        <View className="mr-3">
          <Avatar className="h-12 w-12">
            <AvatarImage
              src={conversation.avatar || "/placeholder.svg"}
              alt={conversation.name}
            />
            <AvatarFallback className="bg-[#1F2937] text-gray-300">
              {conversation.name?.[0] ?? "?"}
            </AvatarFallback>
          </Avatar>
        </View>

        <View className="flex-1 ml-2">
          <Text className="text-white font-semibold">
            {conversation.name}
          </Text>

          <Text className="text-sm text-gray-400 truncate">
            {conversation.lastMessage || "No messages yet"}
          </Text>
        </View>

        <Text className="text-xs text-gray-500">{time}</Text>
      </TouchableOpacity>
    </Swipeable>
  )
})