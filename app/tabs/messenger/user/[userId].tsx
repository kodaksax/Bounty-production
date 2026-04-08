"use client"
import React, { useEffect, useState } from "react"
import { View, Text, ActivityIndicator } from "react-native"
import { useLocalSearchParams, useRouter } from "expo-router"

import { messageService } from "../../../../lib/services/message-service"
import { getCurrentUserId } from "../../../../lib/utils/data-utils"
import type {  FullConversation } from "../../../../lib/types"
import FullChatDetailScreen from "app/tabs/full-chat-detail-screen"

export default function UserConversationRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  const [conversation, setConversation] = useState<FullConversation | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) {
      setError(true);
      return;
    }

    // Fetch full merged conversation
    messageService.getFullConversationWithUser(userId)
      .then((conv) => {
        if (!conv) {
          setError(true);
          return;
        }
        setConversation(conv);
      })
      .catch(() => setError(true));
  }, [userId]);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <Text style={{ color: "#6ee7b7" }}>Unable to load conversation.</Text>
      </View>
    );
  }

  if (!conversation) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return (
    <FullChatDetailScreen
      conversation={conversation}
      onBack={() => router.back()}
    />
  );
}