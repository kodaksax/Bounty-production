'use client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import FullChatDetailScreen from 'app/tabs/full-chat-detail-screen';
import { messageService } from '../../../../lib/services/message-service';
import * as supabaseMessaging from '../../../../lib/services/supabase-messaging';
import type { FullConversation } from '../../../../lib/types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';

export default function UserConversationRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  const [conversation, setConversation] = useState<FullConversation | null>(null);
  const [error, setError] = useState(false);

  const loadConversation = useCallback(async (): Promise<FullConversation | null> => {
    if (!userId) {
      return null;
    }

    // Try to fetch a merged/full conversation (may be null if no messages exist)
    const conv = await messageService.getFullConversationWithUser(userId);
    if (conv) {
      return conv;
    }

    // No existing full conversation with messages — create or get a realtime conversation
    const created = await messageService.getOrCreateConversation([userId], '', undefined);
    if (!created || !created.id) {
      return null;
    }

    // Load any messages for the created conversation (likely empty)
    const msgs = await messageService.getMessages(created.id).catch(() => []);

    const currentUserId = getCurrentUserId();

    return {
      id: `full-${currentUserId}-${userId}`,
      realConversationId: created.id,
      backingConversationIds: [created.id],
      isGroup: created.isGroup,
      name: created.name ?? 'Conversation',
      participantIds: created.participantIds ?? [currentUserId, userId],
      avatar: created.avatar ?? undefined,
      lastMessage: created.lastMessage ?? undefined,
      updatedAt: created.updatedAt ?? undefined,
      unread: created.unread ?? undefined,
      bountyId: created.bountyId ?? undefined,
      messages: msgs ?? [],
    };
  }, [userId]);

  useEffect(() => {
    let mounted = true;

    if (!userId) {
      setError(true);
      return;
    }

    void loadConversation()
      .then(conv => {
        if (!mounted) return;
        if (!conv) {
          setError(true);
          return;
        }
        setConversation(conv);
        setError(false);
      })
      .catch(() => {
        if (mounted) setError(true);
      });

    return () => {
      mounted = false;
    };
  }, [loadConversation, userId]);

  const backingConversationIds = useMemo(() => {
    if (!conversation) return [];
    return conversation.backingConversationIds?.length
      ? conversation.backingConversationIds
      : [conversation.realConversationId];
  }, [conversation]);

  useEffect(() => {
    const currentUserId = getCurrentUserId();
    if (!currentUserId || backingConversationIds.length === 0) return;

    void Promise.all(
      backingConversationIds.map(conversationId =>
        supabaseMessaging.markAsRead(conversationId, currentUserId).catch(() => {})
      )
    );
  }, [backingConversationIds, conversation?.updatedAt]);

  useEffect(() => {
    if (!userId || backingConversationIds.length === 0) return;

    const refreshConversation = async () => {
      const refreshed = await loadConversation();
      if (refreshed) {
        setConversation(refreshed);
      }
    };

    const unsubscribes = backingConversationIds
      .filter(conversationId => conversationId !== conversation?.realConversationId)
      .map(conversationId =>
        supabaseMessaging.subscribeToMessages(conversationId, () => {
          void refreshConversation();
        })
      );

    return () => {
      unsubscribes.forEach(unsubscribe => unsubscribe());
    };
  }, [backingConversationIds, conversation?.realConversationId, loadConversation, userId]);

  if (error) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: '#6ee7b7' }}>Unable to load conversation.</Text>
      </View>
    );
  }

  if (!conversation) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#059669" />
      </View>
    );
  }

  return <FullChatDetailScreen conversation={conversation} onBack={() => router.back()} />;
}
