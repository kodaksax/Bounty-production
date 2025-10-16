/**
 * Messaging Service Usage Examples
 * 
 * This file demonstrates how to use the messaging service in various scenarios.
 */

import { messageService } from '../lib/services/message-service';
import { messagingService } from '../lib/services/messaging';
import { getCurrentUserId } from '../lib/utils/data-utils';

// ============================================================================
// Example 1: Creating a conversation from a bounty detail screen
// ============================================================================
async function example_createChatFromBounty(
  bountyPosterId: string,
  posterUsername: string,
  bountyId: number
) {
  const currentUserId = getCurrentUserId();
  
  // Use getOrCreateConversation to prevent duplicates
  const conversation = await messageService.getOrCreateConversation(
    [bountyPosterId],  // Poster's user ID
    posterUsername,    // Display name for the conversation
    bountyId.toString() // Optional: link to bounty
  );
  
  console.log('Conversation created:', conversation.id);
  
  // Optionally send an initial message
  await messageService.sendMessage(
    conversation.id,
    `Hi! I'm interested in your bounty: "${bountyId}"`,
    currentUserId
  );
  
  return conversation;
}

// ============================================================================
// Example 2: Auto-creating a conversation when accepting a request
// ============================================================================
async function example_autoCreateChatOnAccept(
  hunterId: string,
  hunterUsername: string,
  bountyTitle: string,
  bountyId: number
) {
  const posterId = getCurrentUserId();
  
  // Create conversation
  const conversation = await messageService.getOrCreateConversation(
    [hunterId],
    hunterUsername,
    bountyId.toString()
  );
  
  // Send welcome message
  await messageService.sendMessage(
    conversation.id,
    `Welcome! You've been selected for: "${bountyTitle}". Let's coordinate the details.`,
    posterId
  );
  
  console.log('Chat auto-created for accepted request');
  return conversation;
}

// ============================================================================
// Example 3: Using the messaging service in a React component
// ============================================================================
import { useEffect, useState } from 'react';
import type { Conversation } from '../lib/types';

function ExampleMessengerComponent() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const currentUserId = getCurrentUserId();
  
  useEffect(() => {
    // Initial load
    loadConversations();
    
    // Subscribe to real-time updates
    const handleUpdate = () => {
      console.log('Conversations updated, reloading...');
      loadConversations();
    };
    
    messagingService.on('conversationsUpdated', handleUpdate);
    messagingService.on('messageSent', handleUpdate);
    
    // Cleanup
    return () => {
      messagingService.off('conversationsUpdated', handleUpdate);
      messagingService.off('messageSent', handleUpdate);
    };
  }, []);
  
  async function loadConversations() {
    const convos = await messagingService.listConversations(currentUserId);
    setConversations(convos);
  }
  
  // Component renders conversation list...
  return null;
}

// ============================================================================
// Example 4: Sending a message in a chat
// ============================================================================
async function example_sendMessage(
  conversationId: string,
  messageText: string
) {
  const currentUserId = getCurrentUserId();
  
  try {
    const res = await messageService.sendMessage(
      conversationId,
      messageText,
      currentUserId
    );
    const message = (res as any).message ?? res;
    console.log('Message sent:', (message as any).id);
    return message as any;
  } catch (error) {
    console.error('Failed to send message:', error);
    throw error;
  }
}

// ============================================================================
// Example 5: Loading messages for a conversation
// ============================================================================
async function example_loadMessages(conversationId: string) {
  try {
    const messages = await messagingService.getMessages(conversationId);
    
    console.log(`Loaded ${messages.length} messages`);
    
    // Messages are sorted chronologically (oldest first)
    messages.forEach(msg => {
      console.log(`[${msg.createdAt}] ${msg.senderId}: ${msg.text}`);
    });
    
    return messages;
  } catch (error) {
    console.error('Failed to load messages:', error);
    throw error;
  }
}

// ============================================================================
// Example 6: Marking a conversation as read
// ============================================================================
async function example_markAsRead(conversationId: string) {
  const currentUserId = getCurrentUserId();
  
  await messagingService.markAsRead(conversationId, currentUserId);
  console.log('Conversation marked as read');
}

// ============================================================================
// Example 7: Creating a group conversation
// ============================================================================
async function example_createGroupChat(
  participantIds: string[],
  groupName: string
) {
  const currentUserId = getCurrentUserId();
  
  // For group chats, use createConversation (not getOrCreate)
  const conversation = await messagingService.createConversation(
    [...participantIds, currentUserId], // Include all participants
    groupName,
    true // isGroup = true
  );
  
  console.log('Group chat created:', conversation.id);
  return conversation;
}

// ============================================================================
// Example 8: Checking if a conversation already exists
// ============================================================================
async function example_checkExistingConversation(
  otherUserId: string
): Promise<Conversation | null> {
  const currentUserId = getCurrentUserId();
  
  // Get all conversations
  const conversations = await messagingService.listConversations(currentUserId);
  
  // Find existing 1:1 conversation with this user
  const existing = conversations.find(conv => {
    if (conv.isGroup || !conv.participantIds) return false;
    
    const participants = new Set(conv.participantIds);
    return participants.has(currentUserId) && 
           participants.has(otherUserId) &&
           participants.size === 2;
  });
  
  if (existing) {
    console.log('Found existing conversation:', existing.id);
  } else {
    console.log('No existing conversation found');
  }
  
  return existing || null;
}

// ============================================================================
// Example 9: Using message service wrapper (recommended for most cases)
// ============================================================================
async function example_usingMessageServiceWrapper(
  otherUserId: string,
  otherUsername: string
) {
  const currentUserId = getCurrentUserId();
  
  // The message service wrapper automatically includes current user
  // and provides a simpler API
  
  // Get or create conversation
  const conversation = await messageService.getOrCreateConversation(
    [otherUserId],     // Just provide other user's ID
    otherUsername
  );
  
  // Send message
  const { message, error } = await messageService.sendMessage(
    conversation.id,
    'Hello!',
    currentUserId
  );
  
  if (error) {
    console.error('Send error:', error);
  } else {
    console.log('Message sent:', message.id);
  }
  
  // Mark as read
  await messageService.markAsRead(conversation.id);
  
  return conversation;
}

// ============================================================================
// Example 10: Handling offline scenarios
// ============================================================================
async function example_offlineMessageHandling(
  conversationId: string,
  messageText: string
) {
  const currentUserId = getCurrentUserId();
  
  // The message service automatically handles offline scenarios
  // Messages are queued when offline and sent when back online
  
  const { message, error } = await messageService.sendMessage(
    conversationId,
    messageText,
    currentUserId
  );
  
  if (message.status === 'sending') {
    console.log('Message queued for sending (offline)');
  } else if (message.status === 'sent') {
    console.log('Message sent successfully');
  } else if (message.status === 'failed') {
    console.error('Message failed to send');
  }
  
  return message;
}

// ============================================================================
// Export examples for use in documentation
// ============================================================================
export const messagingExamples = {
  createChatFromBounty: example_createChatFromBounty,
  autoCreateChatOnAccept: example_autoCreateChatOnAccept,
  sendMessage: example_sendMessage,
  loadMessages: example_loadMessages,
  markAsRead: example_markAsRead,
  createGroupChat: example_createGroupChat,
  checkExistingConversation: example_checkExistingConversation,
  usingMessageServiceWrapper: example_usingMessageServiceWrapper,
  offlineMessageHandling: example_offlineMessageHandling,
};
