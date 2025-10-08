import type { Message, Conversation } from '../types';

// In-memory storage (replace with AsyncStorage or API calls later)
let messages: Message[] = [];
let conversations: Conversation[] = [];

// Seed data
const seedMessages: Message[] = [
  {
    id: 'm1',
    conversationId: 'c1',
    senderId: 'user-1',
    text: 'Hey! I saw your bounty for web development. I have 5 years of experience with React.',
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    status: 'sent',
  },
  {
    id: 'm2',
    conversationId: 'c1',
    senderId: 'current-user',
    text: 'Great! Can you share some of your recent work?',
    createdAt: new Date(Date.now() - 3000000).toISOString(),
    status: 'sent',
  },
  {
    id: 'm3',
    conversationId: 'c1',
    senderId: 'user-1',
    text: 'Sure! I just sent you my portfolio link.',
    createdAt: new Date(Date.now() - 1800000).toISOString(),
    status: 'sent',
  },
  {
    id: 'm4',
    conversationId: 'c2',
    senderId: 'user-2',
    text: 'When is the meeting scheduled?',
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    status: 'sent',
  },
];

const seedConversations: Conversation[] = [
  {
    id: 'c1',
    name: 'Olivia Grant',
    isGroup: false,
    avatar: undefined,
    lastMessage: 'Sure! I just sent you my portfolio link.',
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
    participantIds: ['current-user', 'user-1'],
    unread: 2,
  },
  {
    id: 'c2',
    name: 'Product Design Team',
    isGroup: true,
    avatar: undefined,
    lastMessage: 'When is the meeting scheduled?',
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
    participantIds: ['current-user', 'user-2', 'user-3'],
    unread: 1,
  },
  {
    id: 'c3',
    name: 'John Alfaro',
    isGroup: false,
    avatar: undefined,
    lastMessage: 'Nice work, I love it 👍',
    updatedAt: new Date(Date.now() - 14400000).toISOString(),
    participantIds: ['current-user', 'user-4'],
    unread: 0,
  },
];

// Initialize with seed data
const initializeData = () => {
  if (messages.length === 0) {
    messages = [...seedMessages];
  }
  if (conversations.length === 0) {
    conversations = [...seedConversations];
  }
};

export const messageService = {
  /**
   * Get all conversations for current user
   */
  getConversations: async (): Promise<Conversation[]> => {
    initializeData();
    return [...conversations].sort((a, b) => 
      new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
    );
  },

  /**
   * Get a specific conversation
   */
  getConversation: async (id: string): Promise<Conversation | null> => {
    initializeData();
    return conversations.find(c => c.id === id) || null;
  },

  /**
   * Get messages for a conversation
   */
  getMessages: async (conversationId: string): Promise<Message[]> => {
    initializeData();
    return messages
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  },

  /**
   * Send a message (optimistic update)
   */
  sendMessage: async (conversationId: string, text: string, senderId: string = 'current-user'): Promise<{ message: Message; error?: string }> => {
    initializeData();
    
    const message: Message = {
      id: `m${Date.now()}`,
      conversationId,
      senderId,
      text,
      createdAt: new Date().toISOString(),
      status: 'sending',
    };

    // Add message
    messages.push(message);

    // Update conversation
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      conversation.lastMessage = text;
      conversation.updatedAt = message.createdAt;
    }

    // Simulate network delay and success
    setTimeout(() => {
      const msg = messages.find(m => m.id === message.id);
      if (msg) {
        // Simulate 10% failure rate for testing
        if (Math.random() < 0.1) {
          msg.status = 'failed';
        } else {
          msg.status = 'sent';
        }
      }
    }, 1000);

    return { message };
  },

  /**
   * Retry a failed message
   */
  retryMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    const message = messages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    message.status = 'sending';

    // Simulate retry
    setTimeout(() => {
      const msg = messages.find(m => m.id === messageId);
      if (msg) {
        msg.status = 'sent';
      }
    }, 500);

    return { success: true };
  },

  /**
   * Mark conversation as read
   */
  markAsRead: async (conversationId: string): Promise<void> => {
    const conversation = conversations.find(c => c.id === conversationId);
    if (conversation) {
      conversation.unread = 0;
    }
  },

  /**
   * Create a new conversation
   */
  createConversation: async (participantIds: string[], name: string, isGroup: boolean = false): Promise<Conversation> => {
    initializeData();
    
    const conversation: Conversation = {
      id: `c${Date.now()}`,
      name,
      isGroup,
      participantIds: [...participantIds, 'current-user'],
      updatedAt: new Date().toISOString(),
      unread: 0,
    };

    conversations.push(conversation);
    return conversation;
  },

  /**
   * Pin a message (only one pinned message per conversation)
   */
  pinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    const message = messages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // Unpin all other messages in the same conversation
    messages.forEach(m => {
      if (m.conversationId === message.conversationId) {
        m.isPinned = false;
      }
    });

    // Pin this message
    message.isPinned = true;

    return { success: true };
  },

  /**
   * Unpin a message
   */
  unpinMessage: async (messageId: string): Promise<{ success: boolean; error?: string }> => {
    const message = messages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    message.isPinned = false;
    return { success: true };
  },

  /**
   * Get pinned message for a conversation
   */
  getPinnedMessage: async (conversationId: string): Promise<Message | null> => {
    initializeData();
    return messages.find(m => m.conversationId === conversationId && m.isPinned) || null;
  },

  /**
   * Report a message
   */
  reportMessage: async (messageId: string, reason?: string): Promise<{ success: boolean; error?: string }> => {
    const message = messages.find(m => m.id === messageId);
    if (!message) {
      return { success: false, error: 'Message not found' };
    }

    // In a real app, this would send to a moderation queue
    console.log(`Message ${messageId} reported${reason ? `: ${reason}` : ''}`);
    
    return { success: true };
  },

  /**
   * Update message status
   */
  updateMessageStatus: async (messageId: string, status: 'delivered' | 'read'): Promise<void> => {
    const message = messages.find(m => m.id === messageId);
    if (message) {
      message.status = status;
    }
  },
};
