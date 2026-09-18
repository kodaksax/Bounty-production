'use client';

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useConversations } from '../../../hooks/useConversations';
import { ErrorBoundary } from '../../../lib/error-boundary';
import { ChatDetailScreen } from '../chat-detail-screen';

export default function ConversationRoute() {
  // A throw inside the chat screen (or the hooks it renders) must not unmount
  // the whole app — before this boundary the only one above it was the root
  // boundary in app/_layout.tsx, so a chat crash killed the entire app.
  return (
    <ErrorBoundary boundaryName="chat_detail">
      <ConversationRouteContent />
    </ErrorBoundary>
  );
}

function ConversationRouteContent() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const { conversations, refresh } = useConversations();
  const router = useRouter();
  const [conversation, setConversation] = useState(
    () => conversations.find(c => c.id === conversationId) ?? null
  );
  const [loading, setLoading] = useState(!conversation);

  const triedFetchRef = useRef(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // A conversation created just before navigation is often not in the
        // currently loaded list yet, so refresh the authenticated, participant-
        // scoped conversation list once (matching useConversations) and resolve
        // by ID from that result. Guarded to run once per conversationId.
        if (!conversation && conversationId && !triedFetchRef.current) {
          triedFetchRef.current = true;
          const refreshed = await refresh();
          const fetched = refreshed?.find(c => c.id === conversationId) ?? null;
          if (mounted && fetched) setConversation(fetched);
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
  }, [conversation, conversationId, refresh]);

  // If the conversations list is updated elsewhere, pick up the matching
  // conversation without triggering another fetch call.
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
