"use client"

import { MaterialIcons } from "@expo/vector-icons"
import { Avatar, AvatarFallback, AvatarImage } from "components/ui/avatar"
import { BrandingLogo } from "components/ui/branding-logo"
import { EmptyState } from "components/ui/empty-state"
import { ConversationsListSkeleton } from "components/ui/skeleton-loaders"
import { useRouter } from "expo-router"
import { cn } from "lib/utils"
import React, { useCallback, useMemo, useState } from "react"
import { Alert, FlatList, RefreshControl, Text, TouchableOpacity, View } from "react-native"
import { Swipeable } from 'react-native-gesture-handler'
import { OfflineStatusBadge } from '../../components/offline-status-badge'
import { WalletBalanceButton } from '../../components/ui/wallet-balance-button'
import { useConversations } from "../../hooks/useConversations"
import { useNormalizedProfile } from '../../hooks/useNormalizedProfile'
import { useValidUserId } from '../../hooks/useValidUserId'
import { messageService } from '../../lib/services/message-service'
import { logClientError as _logClientError } from '../../lib/services/monitoring'
import { navigationIntent } from '../../lib/services/navigation-intent'
import { generateInitials } from '../../lib/services/supabase-messaging'
import type { Conversation } from "../../lib/types"
import { ChatDetailScreen } from "./chat-detail-screen"
import { colors } from '../../lib/theme';

// Helper to format conversation time
function formatConversationTime(updatedAt?: string): string {
  if (!updatedAt) return '';
  
  const date = new Date(updatedAt);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
  
  if (diffHrs < 1) {
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'Just now';
    return `${diffMins}m ago`;
  }
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
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
  const { conversations, loading, error, markAsRead, deleteConversation, refresh } = useConversations()
  const [activeConversation, setActiveConversation] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await refresh()
    } finally {
      setIsRefreshing(false)
    }
  }, [refresh])

  const handleConversationClick = async (id: string) => {
    await markConversationReadSafe(id)
    setActiveConversation(id)
    onConversationModeChange?.(true)
  }

  // Utility: determine if id is a UUID (v4-ish) — used to avoid calling Supabase with local ids
  function isUuid(id?: string | null) {
    if (!id) return false
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  }

  // Safely mark conversation as read: if id is a canonical UUID, call hook's markAsRead (Supabase).
  // Otherwise use local messageService.markAsRead to avoid invalid-UUID errors.
  async function markConversationReadSafe(convId: string) {
    try {
      if (isUuid(convId)) {
        await markAsRead(convId)
      } else {
        // local conv id (conv-...), use local message service
        try { await messageService.markAsRead(convId) } catch { /* best-effort */ }
      }
    } catch (e) {
      try { _logClientError('markConversationReadSafe failed', { err: String(e), convId }) } catch {}
    }
  }

  // If another screen set a pending conversation id (e.g. after accept flow), open it
  React.useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const pending = await navigationIntent.getAndClearPendingConversationId()
        if (!mounted || !pending) return

        // Quick check in the current conversations list
        const found = conversations.find(c => c.id === pending)
        if (found) {
          setActiveConversation(found.id)
          onConversationModeChange?.(true)
            try { await markConversationReadSafe(found.id) } catch {}
          return
        }

        // Try to fetch the conversation directly from the message store with a few retries.
        // This handles the race where the posting flow created the convo just before navigation.
        let conv = null
        const maxAttempts = 5
        for (let i = 0; i < maxAttempts && mounted; i++) {
          try {
            conv = await messageService.getConversation(pending)
          } catch {
            conv = null
          }
          if (conv) break
          // small backoff
          await new Promise((res) => setTimeout(res, 200))
        }

        if (!mounted) return

        if (conv) {
          // Ensure the hook-backed list is refreshed so the inbox shows the new convo
          try { await refresh() } catch {}
          setActiveConversation(conv.id)
          onConversationModeChange?.(true)
            try { await markConversationReadSafe(conv.id) } catch {}
          return
        }

        // Fallback: refresh the list and try one last time
        try { await refresh() } catch {}
        const after = conversations.find(c => c.id === pending) || (await messageService.getConversation(pending))
        if (after) {
          setActiveConversation(after.id)
          onConversationModeChange?.(true)
         try { await markConversationReadSafe(after.id) } catch {}
        }
      } catch (e) {
        console.error('Messenger: failed to open pending conversation', e)
        try { _logClientError('Messenger failed to open pending conversation', { error: String(e) }) } catch {}
      }
    })()
    return () => { mounted = false }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleBackToInbox = useCallback(() => {
    setActiveConversation(null)
    onConversationModeChange?.(false)
    refresh() // Refresh conversation list when returning
  }, [onConversationModeChange, refresh])

  const handleDeleteConversation = useCallback((conversation: Conversation) => {
    Alert.alert(
      'Delete Conversation',
      `Are you sure you want to delete your conversation with ${conversation.name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteConversation(conversation.id)
            } catch {
              Alert.alert('Error', 'Failed to delete conversation')
            }
          },
        },
      ]
    )
  }, [deleteConversation])

  // Optimized keyExtractor for FlatList
  const keyExtractor = useCallback((item: Conversation) => item.id, []);

  // Optimized render function for FlatList
  const renderConversationItem = useCallback(({ item }: { item: Conversation }) => (
    <ConversationItem 
      conversation={item} 
      onPress={() => handleConversationClick(item.id)}
      onDelete={() => handleDeleteConversation(item)}
    />
  ), [handleConversationClick, handleDeleteConversation]);

  // getItemLayout for better scroll performance
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: 76, // Approximate height: 12px (padding-top) + 48px (content) + 12px (padding-bottom) + 4px (margin)
    offset: 76 * index,
    index,
  }), []);

  // Empty list component
  const ListEmptyComponent = useCallback(() => {
    if (loading) {
      return (
        <View className="px-4 py-6">
          <ConversationsListSkeleton count={5} />
        </View>
      );
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
      );
    }
    
    return (
      <EmptyState
        icon="chat-bubble-outline"
        title="No Messages Yet"
        description="Start chatting by accepting a bounty or posting one. All your conversations will appear here."
        actionLabel="Browse Bounties"
        onAction={() => onNavigate?.('bounty')}
      />
    );
  }, [loading, error, onNavigate, handleRefresh]);

  if (activeConversation) {
    const conversation = conversations.find((c) => c.id === activeConversation)
    if (conversation) {
      return <ChatDetailScreen conversation={conversation} onBack={handleBackToInbox} />
    }
  }

  return (
    <View className="flex flex-col min-h-screen bg-background-secondary text-white" style={{ marginTop: -20 }}>
      <View className="p-4 pt-8 pb-2">
        <View className="flex-row justify-between items-center mb-2">
          <View className="flex-row items-center">
            <BrandingLogo size="medium" />
          </View>
          <View style={{ transform: [{ translateX: -2 }, { translateY: 1 }] }}>
            <WalletBalanceButton onPress={() => onNavigate?.('wallet')} />
          </View>
        </View>
      </View>

      <View className="px-4 py-2 flex-row justify-between items-center">
        <Text className="text-xl font-bold text-white">INBOX</Text>

        {/* Right-side actions: refresh, create new group (icon), and offline badge */}
        <View className="flex-row items-center gap-4">
          <TouchableOpacity onPress={refresh} className="p-2 rounded">
            <MaterialIcons name="refresh" size={20} color="white" />
          </TouchableOpacity>

          {/* New Group icon button styled as rounded square with plus */}
          <TouchableOpacity
            onPress={() => router.push('/tabs/choose-people-screen' as any)}
            className="rounded-lg"
            accessibilityLabel="Create new group"
          >
            {/* Removed white border so icon has no encircling stroke */}
            <View className="h-8 w-8 rounded-lg flex items-center justify-center">
              <MaterialIcons name="add-box" size={20} color="white" />
            </View>
          </TouchableOpacity>

          <OfflineStatusBadge />
        </View>
      </View>

      {error && (
        <View className="mx-4 mb-2 p-3 bg-red-500/20 border border-red-500 rounded">
          <Text className="text-sm text-red-100">{error}</Text>
        </View>
      )}
    
      <FlatList
        data={conversations}
        keyExtractor={keyExtractor}
        renderItem={renderConversationItem}
        contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 96 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={ListEmptyComponent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor="#ffffff"
            colors={[colors.primary[500]]}
          />
        }
        // Performance optimizations
        getItemLayout={getItemLayout}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={5}
        initialNumToRender={10}
      />

      {/* Bottom navigation is provided by the app container (BountyApp) */}
    </View>
  )
}

export default MessengerScreen;
      
        
  

interface ConversationItemProps {
  conversation: Conversation
  onPress: () => void
  onDelete: () => void
}

const ConversationItem = React.memo<ConversationItemProps>(function ConversationItem({ 
  conversation, 
  onPress, 
  onDelete 
}) {
  const router = useRouter()
  const currentUserId = useValidUserId()
  
  // Memoize time formatting
  const time = useMemo(
    () => formatConversationTime(conversation.updatedAt),
    [conversation.updatedAt]
  );
  
  // Memoize other participant ID lookup
  const otherUserId = useMemo(
    () => conversation.participantIds?.find(id => id !== currentUserId),
    [conversation.participantIds, currentUserId]
  );
  
  // Fetch the other user's profile for 1:1 chats
  const { profile: otherUserProfile } = useNormalizedProfile(otherUserId)
  
  // Memoize display values
  const displayName = useMemo(
    () => !conversation.isGroup && otherUserProfile?.username 
      ? otherUserProfile.username 
      : conversation.name,
    [conversation.isGroup, conversation.name, otherUserProfile?.username]
  );
  
  const avatarUrl = useMemo(
    () => !conversation.isGroup && otherUserProfile?.avatar 
      ? otherUserProfile.avatar 
      : conversation.avatar,
    [conversation.isGroup, conversation.avatar, otherUserProfile?.avatar]
  );
  
  // Memoize initials generation
  const initials = useMemo(
    () => generateInitials(otherUserProfile?.username, otherUserProfile?.name),
    [otherUserProfile?.username, otherUserProfile?.name]
  );
  
  const handleAvatarPress = useCallback((e: any) => {
    e.stopPropagation()
    if (otherUserId && !conversation.isGroup) {
      router.push(`/profile/${otherUserId}`)
    }
  }, [otherUserId, conversation.isGroup, router]);
  
  // Memoize swipe action render
  const renderRightActions = useCallback(() => (
    <TouchableOpacity
      className="bg-red-500 justify-center items-center px-6 rounded-lg my-1 mr-2"
      onPress={onDelete}
    >
      <MaterialIcons name="delete" size={24} color="white" />
      <Text className="text-white text-xs mt-1">Delete</Text>
    </TouchableOpacity>
  ), [onDelete]);
  
  return (
    <Swipeable
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      <TouchableOpacity className="flex-row items-center p-3 rounded-lg bg-background-secondary" onPress={onPress}>
        <TouchableOpacity onPress={handleAvatarPress} disabled={!otherUserId || conversation.isGroup}>
          <View className="relative">
            {conversation.isGroup ? (
              <GroupAvatar />
            ) : (
              <Avatar className="h-12 w-12">
                <AvatarImage src={avatarUrl || "/placeholder.svg?height=48&width=48"} alt={displayName} />
                <AvatarFallback className="bg-emerald-700 text-emerald-200">
                  {initials}
                </AvatarFallback>
              </Avatar>
            )}
          </View>
        </TouchableOpacity>

        <View className="ml-3 flex-1 min-w-0">
          <View className="flex-row justify-between items-center">
            <Text className="font-medium text-white">{displayName}</Text>
            <Text className="text-xs text-emerald-300">{time}</Text>
          </View>
          <View className="flex-row justify-between items-center mt-1">
            <Text className={cn("text-sm truncate max-w-[200px]", "text-emerald-200")}>
              {conversation.lastMessage || 'No messages yet'}
            </Text>
            {(conversation.unread ?? 0) > 0 && (
              <View className="bg-blue-500 rounded-full h-5 w-5 flex items-center justify-center">
                <Text className="text-white text-xs">{conversation.unread}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    </Swipeable>
  )
});

function GroupAvatar() {
  return (
    <View className="relative h-12 w-12">
      <View className="absolute top-0 left-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 1" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M1</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute top-1 right-0 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 2" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M2</AvatarFallback>
        </Avatar>
      </View>
      <View className="absolute bottom-0 left-1 h-8 w-8 rounded-full bg-emerald-700 border-2 border-emerald-600 flex items-center justify-center overflow-hidden">
        <Avatar className="h-full w-full">
          <AvatarImage src="/placeholder.svg?height=32&width=32" alt="Member 3" />
          <AvatarFallback className="bg-emerald-800 text-emerald-200 text-xs">M3</AvatarFallback>
        </Avatar>
      </View>
    </View>
  )
}

