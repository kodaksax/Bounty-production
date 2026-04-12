'use client';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useConversations } from '../../../hooks/useConversations';
import { ChatDetailScreen } from '../chat-detail-screen';

export default function ConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { conversations, refresh } = useConversations();
  const router = useRouter();
  const [conversation, setConversation] = useState(
    conversations.find(c => c.id === conversationId) || null
  );
  const [loading, setLoading] = useState(!conversation);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!conversation && conversationId) {
          const updated = await refresh(); // fetch the latest list and receive fresh data
          const list = Array.isArray(updated) ? updated : conversations;
          const found = list.find(c => c.id === conversationId);
          if (mounted && found) setConversation(found);
        }
      } catch (e) {
        console.log('Failed to load conversation', { err: String(e), conversationId });
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [conversationId, conversation, conversations, refresh]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  if (!conversation) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 }}>
        <Text>Conversation not found.</Text>
      </View>
    );
  }

  return <ChatDetailScreen conversation={conversation} onBack={() => router.back()} />;
}
