"use client"

import React, { useEffect, useState } from "react"
import { Text, View, ActivityIndicator } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"
import ChatDetailScreen from "../chat-detail-screen"
import { useConversations } from "../../../hooks/useConversations"


export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>()
  const { conversations, refresh } = useConversations()
  const router = useRouter()
  const [conversation, setConversation] = useState(conversations.find(c => c.id === conversationId) || null)
  const [loading, setLoading] = useState(!conversation)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        if (!conversation && conversationId) {
          await refresh() // fetch the latest list
          const found = conversations.find(c => c.id === conversationId)
          if (mounted && found) setConversation(found)
        }
      } catch (e) {
        console.log("Failed to load conversation", { err: String(e), conversationId })
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => { mounted = false }
  }, [conversationId, conversation, conversations, refresh])

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    )
  }

  if (!conversation) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 16 }}>
        <Text>Conversation not found.</Text>
      </View>
    )
  }

  return (
    <ChatDetailScreen
      conversation={conversation}
      onBack={() => router.back()}
    />
  )
}