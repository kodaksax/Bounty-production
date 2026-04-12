'use client';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import FullChatDetailScreen from 'app/tabs/full-chat-detail-screen';
import { messageService } from '../../../../lib/services/message-service';
import type { FullConversation } from '../../../../lib/types';
import { getCurrentUserId } from '../../../../lib/utils/data-utils';

export default function UserConversationRoute() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const router = useRouter();

  const [conversation, setConversation] = useState<FullConversation | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (!userId) {
      setError(true);
      return;
    }

    (async () => {
      try {
        // Try to fetch a merged/full conversation (may be null if no messages exist)
        const conv = await messageService.getFullConversationWithUser(userId);
        if (conv) {
          if (mounted) setConversation(conv);
          return;
        }

        // No existing full conversation with messages — create or get a realtime conversation
        const created = await messageService.getOrCreateConversation([userId], '', undefined);
        if (!created || !created.id) {
          if (mounted) setError(true);
          return;
        }

        // Load any messages for the created conversation (likely empty)
        const msgs = await messageService.getMessages(created.id).catch(() => []);

        const currentUserId = getCurrentUserId();

        const fullConv: FullConversation = {
          id: `full-${currentUserId}-${userId}`,
          realConversationId: created.id,
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

        if (mounted) setConversation(fullConv);
      } catch (err) {
        if (mounted) setError(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [userId]);

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
