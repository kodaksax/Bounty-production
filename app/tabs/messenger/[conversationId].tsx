'use client';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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

  const triedRefreshRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // Only attempt a refresh once per conversationId to avoid refresh ->
        // conversations state change -> re-run loops when the conversation
        // is still not found.
        if (!conversation && conversationId && !triedRefreshRef.current) {
          triedRefreshRef.current = true;
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
  }, [conversationId, refresh]);

  // If the conversations list is updated elsewhere, pick up the matching
  // conversation without triggering another refresh call.
  useEffect(() => {
    if (!conversation && conversationId) {
      const found = conversations.find(c => c.id === conversationId);
      if (found) {
        setConversation(found);
        setLoading(false);
      }
    }
  }, [conversations, conversationId]);

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
