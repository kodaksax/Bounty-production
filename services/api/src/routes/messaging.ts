import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { db } from '../db/connection';
import { conversationParticipants, conversations, messages, users } from '../db/schema';
import { authMiddleware, type AuthenticatedRequest } from '../middleware/auth';
import { logErrorWithContext, getRequestContext } from '../middleware/request-context';
import { notificationService } from '../services/notification-service';
import { wsMessagingService } from '../services/websocket-messaging-service';

interface GetMessagesParams {
  conversationId: string;
}

interface GetMessagesQuery {
  page?: string;
  limit?: string;
}

interface SendMessageParams {
  conversationId: string;
}

interface SendMessageBody {
  text: string;
  replyTo?: string;
  mediaUrl?: string;
}

interface CreateConversationBody {
  participantIds: string[];
  bountyId?: string;
  isGroup?: boolean;
}

interface UpdateMessageStatusBody {
  messageIds: string[];
  status: 'delivered' | 'read';
}

export async function registerMessagingRoutes(fastify: FastifyInstance) {
  // Get all conversations for the authenticated user
  fastify.get(
    '/api/conversations',
    { preHandler: authMiddleware },
    async (request: AuthenticatedRequest, reply: FastifyReply) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        // Get all conversations where the user is a participant and hasn't deleted
        const userConversations = await db
          .select({
            id: conversations.id,
            isGroup: conversations.is_group,
            bountyId: conversations.bounty_id,
            createdAt: conversations.created_at,
            updatedAt: conversations.updated_at,
          })
          .from(conversations)
          .innerJoin(
            conversationParticipants,
            eq(conversationParticipants.conversation_id, conversations.id)
          )
          .where(
            and(
              eq(conversationParticipants.user_id, userId),
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          )
          .orderBy(desc(conversations.updated_at));

        // For each conversation, get participants and last message
        const enrichedConversations = await Promise.all(
          userConversations.map(async (conv) => {
            // Get all participants
            const participants = await db
              .select({
                userId: conversationParticipants.user_id,
                handle: users.handle,
              })
              .from(conversationParticipants)
              .innerJoin(users, eq(users.id, conversationParticipants.user_id))
              .where(
                and(
                  eq(conversationParticipants.conversation_id, conv.id),
                  sql`${conversationParticipants.deleted_at} IS NULL`
                )
              );

            // Get last message
            const lastMessages = await db
              .select()
              .from(messages)
              .where(eq(messages.conversation_id, conv.id))
              .orderBy(desc(messages.created_at))
              .limit(1);

            const lastMessage = lastMessages[0] || null;

            // Count unread messages
            const participant = await db
              .select()
              .from(conversationParticipants)
              .where(
                and(
                  eq(conversationParticipants.conversation_id, conv.id),
                  eq(conversationParticipants.user_id, userId)
                )
              )
              .limit(1);

            const lastReadAt = participant[0]?.last_read_at;
            const unreadCount = lastReadAt
              ? await db
                  .select({ count: sql<number>`count(*)` })
                  .from(messages)
                  .where(
                    and(
                      eq(messages.conversation_id, conv.id),
                      sql`${messages.created_at} > ${lastReadAt}`
                    )
                  )
                  .then((r) => Number(r[0]?.count || 0))
              : await db
                  .select({ count: sql<number>`count(*)` })
                  .from(messages)
                  .where(eq(messages.conversation_id, conv.id))
                  .then((r) => Number(r[0]?.count || 0));

            return {
              ...conv,
              participants: participants.map((p) => ({
                id: p.userId,
                handle: p.handle,
              })),
              lastMessage: lastMessage
                ? {
                    id: lastMessage.id,
                    text: lastMessage.text,
                    senderId: lastMessage.sender_id,
                    createdAt: lastMessage.created_at,
                  }
                : null,
              unreadCount,
            };
          })
        );

        return { conversations: enrichedConversations };
      } catch (error) {
        console.error('Error fetching conversations:', error);
        return reply.code(500).send({ error: 'Failed to fetch conversations' });
      }
    }
  );

  // Get messages for a conversation with pagination
  fastify.get<{ Params: GetMessagesParams; Querystring: GetMessagesQuery }>(
    '/api/conversations/:conversationId/messages',
    { preHandler: authMiddleware },
    async (
      request: AuthenticatedRequest<{ Params: GetMessagesParams; Querystring: GetMessagesQuery }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        const { conversationId } = request.params;
        const { page: pageRaw = '1', limit: limitRaw = '50' } = request.query || {};
        const page = Number.parseInt(pageRaw, 10);
        const limit = Number.parseInt(limitRaw, 10);
        const offset = (page - 1) * limit;

        // Verify user is a participant
        const participant = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversation_id, conversationId),
              eq(conversationParticipants.user_id, userId),
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          )
          .limit(1);

        if (participant.length === 0) {
          return reply.code(403).send({ error: 'Not a participant in this conversation' });
        }

        // Get messages with sender info
        const conversationMessages = await db
          .select({
            id: messages.id,
            conversationId: messages.conversation_id,
            senderId: messages.sender_id,
            text: messages.text,
            createdAt: messages.created_at,
            updatedAt: messages.updated_at,
            mediaUrl: messages.media_url,
            replyTo: messages.reply_to,
            isPinned: messages.is_pinned,
            status: messages.status,
            senderHandle: users.handle,
          })
          .from(messages)
          .innerJoin(users, eq(users.id, messages.sender_id))
          .where(eq(messages.conversation_id, conversationId))
          .orderBy(desc(messages.created_at))
          .limit(limit)
          .offset(offset);

        // Get total count
        const totalCount = await db
          .select({ count: sql<number>`count(*)` })
          .from(messages)
          .where(eq(messages.conversation_id, conversationId))
          .then((r) => Number(r[0]?.count || 0));

        return {
          messages: conversationMessages.reverse(), // Return in chronological order
          pagination: {
            page,
            limit,
            total: totalCount,
            hasMore: offset + conversationMessages.length < totalCount,
          },
        };
      } catch (error) {
        console.error('Error fetching messages:', error);
        return reply.code(500).send({ error: 'Failed to fetch messages' });
      }
    }
  );

  // Send a message to a conversation
  fastify.post<{ Params: SendMessageParams; Body: SendMessageBody }>(
    '/api/conversations/:conversationId/messages',
    { preHandler: authMiddleware },
    async (
      request: AuthenticatedRequest<{ Params: SendMessageParams; Body: SendMessageBody }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        const { conversationId } = request.params;
        const { text, replyTo, mediaUrl } = request.body;

        if (!text || text.trim().length === 0) {
          return reply.code(400).send({ error: 'Message text is required' });
        }

        // Verify user is a participant
        const participant = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversation_id, conversationId),
              eq(conversationParticipants.user_id, userId),
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          )
          .limit(1);

        if (participant.length === 0) {
          return reply.code(403).send({ error: 'Not a participant in this conversation' });
        }

        // Insert message
        const newMessages = await db
          .insert(messages)
          .values({
            conversation_id: conversationId,
            sender_id: userId,
            text: text.trim(),
            reply_to: replyTo || null,
            media_url: mediaUrl || null,
            status: 'sent',
          })
          .returning();

        const newMessage = (newMessages as typeof messages.$inferSelect[])[0];
        if (!newMessage) {
          return reply.code(500).send({ error: 'Failed to persist message' });
        }

        // Update conversation timestamp
        await db
          .update(conversations)
          .set({ updated_at: new Date() })
          .where(eq(conversations.id, conversationId));

        // Broadcast to WebSocket clients
        wsMessagingService.handleNewMessage(
          conversationId,
          newMessage.id,
          userId,
          text.trim()
        );

        // Get other participants for push notifications
        const otherParticipants = await db
          .select({ user_id: conversationParticipants.user_id })
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversation_id, conversationId),
              sql`${conversationParticipants.user_id} != ${userId}`,
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          );

        // Send push notifications to offline users
        for (const participant of otherParticipants) {
          const isOnline = wsMessagingService.getUserPresence(participant.user_id);
          if (!isOnline) {
            // User is offline, send push notification
            await notificationService.sendMessageNotification(
              participant.user_id,
              userId,
              conversationId,
              text.trim()
            );
          }
        }

        return { message: newMessage };
      } catch (error) {
        console.error('Error sending message:', error);
        return reply.code(500).send({ error: 'Failed to send message' });
      }
    }
  );

  // Create a new conversation
  fastify.post<{ Body: CreateConversationBody }>(
    '/api/conversations',
    { preHandler: authMiddleware },
    async (
      request: AuthenticatedRequest<{ Body: CreateConversationBody }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        const { participantIds, bountyId, isGroup } = request.body;

        if (!participantIds || participantIds.length === 0) {
          return reply.code(400).send({ error: 'At least one participant is required' });
        }

        // Ensure current user is in participants
        const allParticipants = participantIds.includes(userId)
          ? participantIds
          : [...participantIds, userId];

        // For 1:1 conversations, check if one already exists
        if (!isGroup && allParticipants.length === 2) {
          const existing = await db
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.is_group, false),
                bountyId ? eq(conversations.bounty_id, bountyId) : sql`${conversations.bounty_id} IS NULL`
              )
            );

          for (const conv of existing) {
            const convParticipants = await db
              .select({ user_id: conversationParticipants.user_id })
              .from(conversationParticipants)
              .where(
                and(
                  eq(conversationParticipants.conversation_id, conv.id),
                  sql`${conversationParticipants.deleted_at} IS NULL`
                )
              );

              const participantUserIds = convParticipants.map((p) => p.user_id);
            if (
              participantUserIds.length === 2 &&
              allParticipants.every((id) => participantUserIds.includes(id))
            ) {
              // Conversation already exists
              return { conversation: { id: conv.id, existing: true } };
            }
          }
        }

        // Create new conversation
        const newConversations = await db
          .insert(conversations)
          .values({
            is_group: isGroup || false,
            bounty_id: bountyId || null,
          })
          .returning();

        const conversation = newConversations[0];

        // Add participants
        await db.insert(conversationParticipants).values(
          allParticipants.map((userId) => ({
            conversation_id: conversation.id,
            user_id: userId,
          }))
        );

        return { conversation: { ...conversation, existing: false } };
      } catch (error) {
        console.error('Error creating conversation:', error);
        return reply.code(500).send({ error: 'Failed to create conversation' });
      }
    }
  );

  // Mark messages as read/delivered
  fastify.post<{ Params: GetMessagesParams; Body: UpdateMessageStatusBody }>(
    '/api/conversations/:conversationId/messages/status',
    { preHandler: authMiddleware },
    async (
      request: AuthenticatedRequest<{ Params: GetMessagesParams; Body: UpdateMessageStatusBody }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        const { conversationId } = request.params;
        const { messageIds, status } = request.body;

        if (!messageIds || messageIds.length === 0) {
          return reply.code(400).send({ error: 'Message IDs are required' });
        }

        if (!['delivered', 'read'].includes(status)) {
          return reply.code(400).send({ error: 'Invalid status' });
        }

        // Verify user is a participant
        const participant = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversation_id, conversationId),
              eq(conversationParticipants.user_id, userId),
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          )
          .limit(1);

        if (participant.length === 0) {
          return reply.code(403).send({ error: 'Not a participant in this conversation' });
        }

        // Update message status
        await db
          .update(messages)
          .set({ status })
          .where(
            and(
              inArray(messages.id, messageIds),
              eq(messages.conversation_id, conversationId)
            )
          );

        // If marking as read, update last_read_at
        if (status === 'read') {
          await db
            .update(conversationParticipants)
            .set({ last_read_at: new Date() })
            .where(
              and(
                eq(conversationParticipants.conversation_id, conversationId),
                eq(conversationParticipants.user_id, userId)
              )
            );
        }

        // Broadcast status update via WebSocket
        for (const messageId of messageIds) {
          if (status === 'delivered') {
            wsMessagingService.handleMessageDelivered(conversationId, messageId, userId);
          } else {
            wsMessagingService.handleMessageRead(conversationId, messageId, userId);
          }
        }

        return { success: true, updatedCount: messageIds.length };
      } catch (error) {
        console.error('Error updating message status:', error);
        return reply.code(500).send({ error: 'Failed to update message status' });
      }
    }
  );

  // Send typing indicator
  fastify.post<{ Params: GetMessagesParams; Body: { isTyping: boolean } }>(
    '/api/conversations/:conversationId/typing',
    { preHandler: authMiddleware },
    async (
      request: AuthenticatedRequest<{ Params: GetMessagesParams; Body: { isTyping: boolean } }>,
      reply: FastifyReply
    ) => {
      try {
        const userId = request.userId;
        if (!userId) {
          return reply.code(401).send({ error: 'User ID not found' });
        }

        const { conversationId } = request.params;
        const { isTyping } = request.body;

        // Verify user is a participant
        const participant = await db
          .select()
          .from(conversationParticipants)
          .where(
            and(
              eq(conversationParticipants.conversation_id, conversationId),
              eq(conversationParticipants.user_id, userId),
              sql`${conversationParticipants.deleted_at} IS NULL`
            )
          )
          .limit(1);

        if (participant.length === 0) {
          return reply.code(403).send({ error: 'Not a participant in this conversation' });
        }

        // Broadcast typing indicator
        wsMessagingService.handleTyping(conversationId, userId, isTyping);

        return { success: true };
      } catch (error) {
        console.error('Error sending typing indicator:', error);
        return reply.code(500).send({ error: 'Failed to send typing indicator' });
      }
    }
  );
}
