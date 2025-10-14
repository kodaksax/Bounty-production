/**
 * messaging.ts - Persistent messaging data layer
 * 
 * Provides a minimal local-first message store using AsyncStorage (persisted)
 * + an EventEmitter for UI updates. No backend is assumed; structured so it's
 * easy to swap with a real backend later.
 * 
 * API:
 * - listConversations(userId: string): Promise<Conversation[]>
 * - getConversation(conversationId: string): Promise<Conversation | null>
 * - getMessages(conversationId: string): Promise<Message[]>
 * - sendMessage(conversationId: string, text: string, senderId: string): Promise<Message>
 * - createConversation(participantIds: string[], name: string, isGroup?: boolean, bountyId?: string): Promise<Conversation>
 * - markAsRead(conversationId: string, userId: string): Promise<void>
 * - getOrCreateConversation(participantIds: string[], name: string, bountyId?: string): Promise<Conversation>
 * - on(event: string, handler: Function): void
 * - off(event: string, handler: Function): void
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { EventEmitter } from 'events';
import type { Conversation, Message } from '../types';

// Storage keys
const CONVERSATIONS_KEY = '@bountyexpo:conversations';
const MESSAGES_KEY = '@bountyexpo:messages';

// EventEmitter for real-time updates
const emitter = new EventEmitter();

/**
 * Load conversations from AsyncStorage
 */
async function loadConversations(): Promise<Conversation[]> {
  try {
    const json = await AsyncStorage.getItem(CONVERSATIONS_KEY);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error loading conversations:', error);
    return [];
  }
}

/**
 * Save conversations to AsyncStorage
 */
async function saveConversations(conversations: Conversation[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
    emitter.emit('conversationsUpdated', conversations);
  } catch (error) {
    console.error('Error saving conversations:', error);
  }
}

/**
 * Load messages from AsyncStorage
 */
async function loadMessages(): Promise<Message[]> {
  try {
    const json = await AsyncStorage.getItem(MESSAGES_KEY);
    return json ? JSON.parse(json) : [];
  } catch (error) {
    console.error('Error loading messages:', error);
    return [];
  }
}

/**
 * Save messages to AsyncStorage
 */
async function saveMessages(messages: Message[]): Promise<void> {
  try {
    await AsyncStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
    emitter.emit('messagesUpdated', messages);
  } catch (error) {
    console.error('Error saving messages:', error);
  }
}

/**
 * Get all conversations for a user, sorted by most recent
 */
export async function listConversations(userId: string): Promise<Conversation[]> {
  const conversations = await loadConversations();
  
  // Filter to conversations where userId is a participant
  const userConversations = conversations.filter((c) =>
    c.participantIds?.includes(userId)
  );
  
  // Sort by most recent first
  return userConversations.sort((a, b) => {
    const aTime = new Date(a.updatedAt || 0).getTime();
    const bTime = new Date(b.updatedAt || 0).getTime();
    return bTime - aTime;
  });
}

/**
 * Get a specific conversation by ID
 */
export async function getConversation(conversationId: string): Promise<Conversation | null> {
  const conversations = await loadConversations();
  return conversations.find((c) => c.id === conversationId) || null;
}

/**
 * Get all messages for a conversation, sorted chronologically
 */
export async function getMessages(conversationId: string): Promise<Message[]> {
  const messages = await loadMessages();
  
  const conversationMessages = messages.filter((m) => m.conversationId === conversationId);
  
  // Sort by creation time (oldest first)
  return conversationMessages.sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return aTime - bTime;
  });
}

/**
 * Send a message in a conversation
 */
export async function sendMessage(
  conversationId: string,
  text: string,
  senderId: string
): Promise<Message> {
  const messages = await loadMessages();
  const conversations = await loadConversations();
  
  const message: Message = {
    id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    conversationId,
    senderId,
    text,
    createdAt: new Date().toISOString(),
    status: 'sent',
  };
  
  messages.push(message);
  await saveMessages(messages);
  
  // Update conversation's lastMessage and updatedAt
  const conversation = conversations.find((c) => c.id === conversationId);
  if (conversation) {
    conversation.lastMessage = text;
    conversation.updatedAt = message.createdAt;
    await saveConversations(conversations);
  }
  
  emitter.emit('messageSent', message);
  
  return message;
}

/**
 * Create a new conversation
 */
export async function createConversation(
  participantIds: string[],
  name: string,
  isGroup: boolean = false,
  bountyId?: string
): Promise<Conversation> {
  const conversations = await loadConversations();
  
  const conversation: Conversation = {
    id: `conv-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    bountyId,
    isGroup,
    name,
    participantIds,
    updatedAt: new Date().toISOString(),
    unread: 0,
  };
  
  conversations.push(conversation);
  await saveConversations(conversations);
  
  return conversation;
}

/**
 * Mark a conversation as read for a user
 */
export async function markAsRead(conversationId: string, userId: string): Promise<void> {
  const conversations = await loadConversations();
  
  const conversation = conversations.find((c) => c.id === conversationId);
  if (conversation) {
    conversation.unread = 0;
    await saveConversations(conversations);
  }
}

/**
 * Get or create a 1:1 conversation between users
 * This prevents duplicate conversations for the same pair of users
 */
export async function getOrCreateConversation(
  participantIds: string[],
  name: string,
  bountyId?: string
): Promise<Conversation> {
  const conversations = await loadConversations();
  
  // Sort participant IDs for consistent comparison
  const sortedIds = [...participantIds].sort();
  
  // Look for existing conversation with same participants (for 1:1 chats)
  if (sortedIds.length === 2) {
    const existing = conversations.find((c) => {
      if (c.isGroup || !c.participantIds) return false;
      const cSorted = [...c.participantIds].sort();
      return (
        cSorted.length === 2 &&
        cSorted[0] === sortedIds[0] &&
        cSorted[1] === sortedIds[1]
      );
    });
    
    if (existing) {
      return existing;
    }
  }
  
  // Create new conversation
  return createConversation(participantIds, name, false, bountyId);
}

/**
 * Subscribe to events
 * Events: 'conversationsUpdated', 'messagesUpdated', 'messageSent'
 */
export function on(event: string, handler: (...args: any[]) => void): void {
  emitter.on(event, handler);
}

/**
 * Unsubscribe from events
 */
export function off(event: string, handler: (...args: any[]) => void): void {
  emitter.off(event, handler);
}

/**
 * Export the messaging service as default
 */
export const messagingService = {
  listConversations,
  getConversation,
  getMessages,
  sendMessage,
  createConversation,
  markAsRead,
  getOrCreateConversation,
  on,
  off,
};

export default messagingService;
