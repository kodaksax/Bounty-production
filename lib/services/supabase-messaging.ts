/**
 * supabase-messaging.ts - Supabase Realtime messaging service
 * 
 * Provides Supabase-backed messaging with Realtime subscriptions,
 * local caching via AsyncStorage for offline/fast boot, and
 * support for 1:1 conversations with soft delete.
 * 
 * Key features:
 * - Realtime message and conversation updates via Supabase subscriptions
 * - Local message cache (AsyncStorage) for fast boot and offline support
 * - Soft delete for conversations (conversation_participants.deleted_at)
 * - Profile avatar integration (Profilepictures bucket)
 * - Optimistic updates for better UX
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { RealtimeChannel } from '@supabase/supabase-js';
import { EventEmitter } from 'events';
import { supabase } from '../supabase';
import type { Conversation, Message } from '../types';
import { logClientError } from './monitoring';

// Storage keys for local cache
const CONVERSATIONS_CACHE_KEY = '@bountyexpo:conversations_cache';
const MESSAGES_CACHE_PREFIX = '@bountyexpo:messages_';

// EventEmitter for real-time updates to UI
const emitter = new EventEmitter();
emitter.setMaxListeners(50); // Increase limit for multiple subscriptions

// Active Realtime subscriptions
const subscriptions: Map<string, RealtimeChannel> = new Map();

/**
 * Cache conversations locally for fast boot
 */
async function cacheConversations(conversations: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONVERSATIONS_CACHE_KEY, JSON.stringify(conversations));
  } catch (error) {
    console.error('Error caching conversations:', error);
  }
}

/**
 * Load conversations from local cache
 */
async function loadCachedConversations(): Promise<Conversation[]> {
  try {
    const json = await AsyncStorage.getItem(CONVERSATIONS_CACHE_KEY);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error loading cached conversations:', error);
    return [];
  }
}

/**
 * Cache messages for a conversation locally
 */
async function cacheMessages(conversationId: string, messages: Message[]): Promise<void> {
  try {
    await AsyncStorage.setItem(
      `${MESSAGES_CACHE_PREFIX}${conversationId}`,
      JSON.stringify(messages)
    );
  } catch (error) {
    console.error('Error caching messages:', error);
  }
}

/**
 * Load messages from local cache for a conversation
 */
async function loadCachedMessages(conversationId: string): Promise<Message[]> {
  try {
    const json = await AsyncStorage.getItem(`${MESSAGES_CACHE_PREFIX}${conversationId}`);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error loading cached messages:', error);
    return [];
  }
}

/**
 * Get profile avatar URL from Profilepictures bucket
 */
export function getProfileAvatarUrl(avatarPath?: string | null): string | undefined {
  if (!avatarPath) return undefined;
  
  const { data } = supabase.storage
    .from('Profilepictures')
    .getPublicUrl(avatarPath);
  
  return data?.publicUrl;
}

/**
 * Generate initials from username or full name for avatar fallback
 */
export function generateInitials(username?: string, fullName?: string): string {
  if (fullName) {
    const parts = fullName.trim().split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return fullName.substring(0, 2).toUpperCase();
  }
  
  if (username) {
    return username.substring(0, 2).toUpperCase();
  }
  
  return '??';
}

/**
 * Fetch conversations for a user from Supabase
 */
export async function fetchConversations(userId: string): Promise<Conversation[]> {
  try {
    // Query conversations where user is a participant and hasn't soft-deleted
    const { data: participants, error: participantsError } = await supabase
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (participantsError) throw participantsError;
    if (!participants || participants.length === 0) return [];

    const conversationIds = participants.map(p => p.conversation_id);

    // Fetch conversation details
    const { data: conversations, error: conversationsError } = await supabase
      .from('conversations')
      .select('id, is_group, bounty_id, created_at, updated_at')
      .in('id', conversationIds)
      .order('updated_at', { ascending: false });

    if (conversationsError) throw conversationsError;
    if (!conversations) return [];

    // For each conversation, get participants and last message
    const enrichedConversations: Conversation[] = await Promise.all(
      conversations.map(async (conv) => {
        // Get all participants for this conversation
        const { data: allParticipants } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', conv.id)
          .is('deleted_at', null);

        const participantIds = allParticipants?.map(p => p.user_id) || [];

        // For 1:1 chats, get the other user's profile
        let name = 'Unknown';
        let avatar: string | undefined;
        
        if (!conv.is_group && participantIds.length === 2) {
          const otherUserId = participantIds.find(id => id !== userId);
          if (otherUserId) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('username, full_name, avatar')
              .eq('id', otherUserId)
              .single();

            if (profile) {
              name = profile.username || profile.full_name || 'Unknown';
              avatar = getProfileAvatarUrl(profile.avatar);
            }
          }
        } else if (conv.is_group) {
          // For group chats, we'd need a name field or generate from participants
          name = 'Group Chat';
        }

        // Get last message
        const { data: lastMsg } = await supabase
          .from('messages')
          .select('text, created_at')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Count unread messages
        const participantRecord = participants.find(p => p.conversation_id === conv.id);
        const lastReadAt = participantRecord?.last_read_at;
        
        let unreadCount = 0;
        if (lastReadAt) {
          const { count } = await supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .gt('created_at', lastReadAt)
            .neq('sender_id', userId);
          
          unreadCount = count || 0;
        }

        return {
          id: conv.id,
          bountyId: conv.bounty_id,
          isGroup: conv.is_group,
          name,
          avatar,
          lastMessage: lastMsg?.text,
          updatedAt: conv.updated_at,
          participantIds,
          unread: unreadCount,
        };
      })
    );

    // Cache the conversations
    await cacheConversations(enrichedConversations);

    return enrichedConversations;
  } catch (error) {
    console.error('Error fetching conversations:', error);
    // Return cached data on error
    return await loadCachedConversations();
  }
}

/**
 * Fetch messages for a conversation from Supabase
 */
export async function fetchMessages(conversationId: string): Promise<Message[]> {
  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const formattedMessages: Message[] = (messages || []).map(msg => ({
      id: msg.id,
      conversationId: msg.conversation_id,
      senderId: msg.sender_id,
      text: msg.text,
      createdAt: msg.created_at,
      status: 'sent',
      mediaUrl: msg.media_url,
      replyTo: msg.reply_to,
      isPinned: msg.is_pinned,
    }));

    // Cache the messages
    await cacheMessages(conversationId, formattedMessages);

    return formattedMessages;
  } catch (error) {
    console.error('Error fetching messages:', error);
    // Return cached data on error
    return await loadCachedMessages(conversationId);
  }
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  senderId: string
): Promise<Message> {
  try {
    // First, try the canonical column name 'text'
    let attemptFields: Array<Record<string, any>> = [
      { conversation_id: conversationId, sender_id: senderId, text },
      // fallback alternatives in case DB schema uses a different column name
      { conversation_id: conversationId, sender_id: senderId, body: text },
      { conversation_id: conversationId, sender_id: senderId, message: text },
      { conversation_id: conversationId, sender_id: senderId, content: text },
    ];

    let inserted: any = null;
    let lastError: any = null;

    for (const fields of attemptFields) {
      try {
        const { data, error } = await supabase
          .from('messages')
          .insert(fields)
          .select()
          .single();

        if (error) throw error;
        inserted = data;
        break;
      } catch (err) {
        lastError = err;
        // If error indicates missing column for the attempted field, continue to next
        const msg = String((err && (err as any).message) || err);
        if (msg.includes("Could not find the 'text' column") || msg.includes('column') && msg.includes('does not exist')) {
          // try next candidate
          continue;
        }
        // For other errors, break and rethrow after logging
        break;
      }
    }

    if (!inserted) {
      // All attempts failed; log and throw the last error
      try { logClientError('Error sending message via supabase: all insert variants failed', { err: lastError, conversationId, senderId }) } catch {}
      throw lastError || new Error('Failed to insert message (unknown reason)');
    }

    const resolvedText = inserted.text ?? inserted.body ?? inserted.message ?? inserted.content ?? '';

    const message: Message = {
      id: inserted.id,
      conversationId: inserted.conversation_id,
      senderId: inserted.sender_id,
      text: resolvedText,
      createdAt: inserted.created_at,
      status: 'sent',
    };

    // Emit event for local UI update
    emitter.emit('messageSent', message);

    return message;
  } catch (error) {
    console.error('Error sending message:', error);
    try { logClientError('Error sending message', { err: error, conversationId, senderId }) } catch {}
    throw error;
  }
}

/**
 * Create a new conversation
 */
export async function createConversation(
  participantIds: string[],
  isGroup: boolean = false,
  bountyId?: string,
  creatorId?: string
): Promise<Conversation> {
  try {
    let resolvedCreatorId: string | undefined;
    try {
      const { data } = await supabase.auth.getUser();
      resolvedCreatorId = data.user?.id ?? undefined;
    } catch {
      resolvedCreatorId = undefined;
    }

    if (!resolvedCreatorId) {
      resolvedCreatorId = creatorId;
    }

    if (!resolvedCreatorId) {
      throw new Error('Unable to determine authenticated Supabase user. Please sign in again.');
    }

    // Ensure the authenticating user is always a participant so RLS policies grant access
    const ensureCreatorIncluded = participantIds.includes(resolvedCreatorId)
      ? participantIds
      : [...participantIds, resolvedCreatorId];

    // Create conversation
    const attemptedRows = [
      {
        is_group: isGroup,
        bounty_id: bountyId,
        created_by: resolvedCreatorId,
      },
      {
        is_group: isGroup,
        bounty_id: bountyId,
      },
    ];

    let conversation: any = null;
    let lastError: any = null;

    for (const payload of attemptedRows) {
      try {
        const { data, error } = await supabase
          .from('conversations')
          .insert(payload)
          .select()
          .single();

        if (error) throw error;
        conversation = data;
        break;
      } catch (err) {
        lastError = err;
        const msg = String((err as any)?.message || err);
        if (msg.includes('created_by')) {
          // Retry without created_by if column missing in older schemas
          continue;
        }
        break;
      }
    }

    if (!conversation) {
      try {
        logClientError('Supabase createConversation failed', { err: lastError, participantIds, bountyId });
      } catch {}
      throw lastError || new Error('Unable to create conversation');
    }

    // Add participants
    const participantRecords = ensureCreatorIncluded.map(userId => ({
      conversation_id: conversation.id,
      user_id: userId,
    }));

    const { error: participantsError } = await supabase
      .from('conversation_participants')
      .insert(participantRecords);

    if (participantsError) throw participantsError;

    // For 1:1 chats, get the other user's info
    let name = 'New Conversation';
    let avatar: string | undefined;

    if (!isGroup && participantIds.length === 2) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar')
        .in('id', participantIds);

      if (profiles && profiles.length > 0) {
        // Get the first profile (could be either user)
        const profile = profiles[0];
        name = profile.username || profile.full_name || 'Unknown';
        avatar = getProfileAvatarUrl(profile.avatar);
      }
    }

    const newConversation: Conversation = {
      id: conversation.id,
      bountyId: conversation.bounty_id,
      isGroup: conversation.is_group,
      name,
      avatar,
      participantIds,
      updatedAt: conversation.updated_at,
    };

    emitter.emit('conversationCreated', newConversation);

    return newConversation;
  } catch (error) {
    console.error('Error creating conversation:', error);
    throw error;
  }
}

/**
 * Get or create a 1:1 conversation (prevents duplicates)
 */
export async function getOrCreateConversation(
  userId: string,
  otherUserId: string,
  bountyId?: string
): Promise<Conversation> {
  try {
    // Check if a 1:1 conversation already exists between these users
    const { data: existingParticipants } = await supabase
      .from('conversation_participants')
      .select('conversation_id')
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (existingParticipants && existingParticipants.length > 0) {
      const conversationIds = existingParticipants.map(p => p.conversation_id);

      // Check if any of these conversations includes the other user
      for (const convId of conversationIds) {
        const { data: otherUserParticipant } = await supabase
          .from('conversation_participants')
          .select('user_id')
          .eq('conversation_id', convId)
          .eq('user_id', otherUserId)
          .is('deleted_at', null)
          .single();

        if (otherUserParticipant) {
          // Found existing conversation, check if it's 1:1
          const { data: conversation } = await supabase
            .from('conversations')
            .select('*')
            .eq('id', convId)
            .eq('is_group', false)
            .single();

          if (conversation) {
            // Fetch conversation details
            const conversations = await fetchConversations(userId);
            const found = conversations.find(c => c.id === convId);
            if (found) return found;
          }
        }
      }
    }

    // No existing 1:1 conversation found, create new one
    return await createConversation([userId, otherUserId], false, bountyId, userId);
  } catch (error) {
    console.error('Error in getOrCreateConversation:', error);
    throw error;
  }
}

/**
 * Soft delete a conversation for the current user
 */
export async function softDeleteConversation(
  conversationId: string,
  userId: string
): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_participants')
      .update({ deleted_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) throw error;

    emitter.emit('conversationDeleted', conversationId);
  } catch (error) {
    console.error('Error soft deleting conversation:', error);
    throw error;
  }
}

/**
 * Mark conversation as read for the current user
 */
export async function markAsRead(conversationId: string, userId: string): Promise<void> {
  try {
    const { error } = await supabase
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);

    if (error) throw error;
  } catch (error) {
    console.error('Error marking conversation as read:', error);
  }
}

/**
 * Subscribe to realtime updates for conversations
 */
export function subscribeToConversations(
  userId: string,
  onUpdate: () => void
): RealtimeChannel {
  const channelName = `conversations:${userId}`;
  
  // Check if already subscribed
  if (subscriptions.has(channelName)) {
    const existing = subscriptions.get(channelName);
    if (existing) return existing;
  }

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_participants',
        filter: `user_id=eq.${userId}`,
      },
      () => {
        onUpdate();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversations',
      },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  subscriptions.set(channelName, channel);
  return channel;
}

/**
 * Subscribe to realtime updates for messages in a conversation
 */
export function subscribeToMessages(
  conversationId: string,
  onUpdate: (message?: Message) => void
): RealtimeChannel {
  const channelName = `messages:${conversationId}`;
  
  // Check if already subscribed
  if (subscriptions.has(channelName)) {
    const existing = subscriptions.get(channelName);
    if (existing) return existing;
  }

  const channel = supabase
    .channel(channelName)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => {
        const message: Message = {
          id: payload.new.id,
          conversationId: payload.new.conversation_id,
          senderId: payload.new.sender_id,
          text: payload.new.text,
          createdAt: payload.new.created_at,
          status: 'sent',
          mediaUrl: payload.new.media_url,
          replyTo: payload.new.reply_to,
          isPinned: payload.new.is_pinned,
        };
        onUpdate(message);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      () => {
        onUpdate();
      }
    )
    .subscribe();

  subscriptions.set(channelName, channel);
  return channel;
}

/**
 * Unsubscribe from a channel
 */
export async function unsubscribe(channelNameOrId: string): Promise<void> {
  const channel = subscriptions.get(channelNameOrId);
  if (channel) {
    await supabase.removeChannel(channel);
    subscriptions.delete(channelNameOrId);
  }
}

/**
 * Unsubscribe from all channels
 */
export async function unsubscribeAll(): Promise<void> {
  for (const [name, channel] of subscriptions.entries()) {
    await supabase.removeChannel(channel);
    subscriptions.delete(name);
  }
}

/**
 * Event emitter for UI updates
 */
export function on(event: string, handler: (...args: any[]) => void): void {
  emitter.on(event, handler);
}

export function off(event: string, handler: (...args: any[]) => void): void {
  emitter.off(event, handler);
}

/**
 * Get the EventEmitter instance (for advanced use cases)
 */
export function getEmitter(): EventEmitter {
  return emitter;
}
