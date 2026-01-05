import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';

type WebsocketConnection = {
  socket: {
    on: (event: string, listener: (...args: any[]) => void) => void;
    readyState: number;
    send: (data: string) => void;
  };
};

// Message event payload interfaces
export interface MessageEvent {
  type: 'message.new' | 'message.delivered' | 'message.read' | 'typing.start' | 'typing.stop' | 'presence.update';
  conversationId: string;
  messageId?: string;
  senderId: string;
  text?: string;
  timestamp: string;
  status?: 'sent' | 'delivered' | 'read';
  userId?: string; // for presence updates
  isOnline?: boolean; // for presence updates
}

export interface ConversationClient {
  userId: string;
  conversationIds: Set<string>;
  connection: WebsocketConnection;
  isAuthenticated: boolean;
  lastSeen: Date;
}

export class WebSocketMessagingService {
  private supabaseClient: ReturnType<typeof createClient<Database>> | null = null;
  // Map of userId -> ConversationClient
  private clients: Map<string, ConversationClient> = new Map();
  // Map of conversationId -> Set of userIds
  private conversationRooms: Map<string, Set<string>> = new Map();
  // Presence tracking: userId -> online status
  private presenceStatus: Map<string, boolean> = new Map();

  constructor() {
    // Support both server-style env names and Expo public env names (fallback)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    // Initialize Supabase client if credentials are available
    if (supabaseUrl && supabaseAnon) {
      this.supabaseClient = createClient<Database>(supabaseUrl, supabaseAnon);
      console.log('📡 WebSocket Messaging Service - Supabase client initialized');
    } else {
      console.log('⚠️  WebSocket Messaging Service - Supabase credentials not found');
    }
  }

  /**
   * Authenticate WebSocket connection using JWT token
   */
  async authenticateConnection(token: string): Promise<{ userId: string; user: any } | null> {
    if (!this.supabaseClient) {
      console.log('⚠️  Auth disabled - no Supabase client');
      return null;
    }

    try {
      const { data, error } = await this.supabaseClient.auth.getUser(token);
      
      if (error || !data.user) {
        console.error('WebSocket auth failed:', error);
        return null;
      }

      return { userId: data.user.id, user: data.user };
    } catch (error) {
      console.error('WebSocket auth error:', error);
      return null;
    }
  }

  /**
   * Add authenticated client connection
   */
  async addClient(userId: string, connection: WebsocketConnection, conversationIds: string[] = []): Promise<void> {
    const client: ConversationClient = {
      userId,
      conversationIds: new Set(conversationIds),
      connection,
      isAuthenticated: true,
      lastSeen: new Date(),
    };

    this.clients.set(userId, client);
    this.presenceStatus.set(userId, true);

    // Join conversation rooms
    conversationIds.forEach(convId => {
      this.joinRoom(userId, convId);
    });

    // Set up event handlers
    connection.socket.on('close', () => {
      this.removeClient(userId);
    });

    connection.socket.on('error', (error: any) => {
      console.error(`WebSocket error for user ${userId}:`, error);
      this.removeClient(userId);
    });

    console.log(`✅ Client connected: ${userId}, conversations: ${conversationIds.length}, total clients: ${this.clients.size}`);

    // Broadcast presence update
    this.broadcastPresenceUpdate(userId, true);
  }

  /**
   * Remove client connection
   */
  removeClient(userId: string): void {
    const client = this.clients.get(userId);
    if (!client) return;

    // Leave all rooms
    client.conversationIds.forEach(convId => {
      this.leaveRoom(userId, convId);
    });

    this.clients.delete(userId);
    this.presenceStatus.set(userId, false);

    console.log(`❌ Client disconnected: ${userId}, remaining clients: ${this.clients.size}`);

    // Broadcast presence update
    this.broadcastPresenceUpdate(userId, false);
  }

  /**
   * Join a conversation room
   */
  joinRoom(userId: string, conversationId: string): void {
    const client = this.clients.get(userId);
    if (!client) return;

    client.conversationIds.add(conversationId);

    if (!this.conversationRooms.has(conversationId)) {
      this.conversationRooms.set(conversationId, new Set());
    }

    this.conversationRooms.get(conversationId)!.add(userId);
    console.log(`👥 User ${userId} joined conversation ${conversationId}`);
  }

  /**
   * Leave a conversation room
   */
  leaveRoom(userId: string, conversationId: string): void {
    const client = this.clients.get(userId);
    if (client) {
      client.conversationIds.delete(conversationId);
    }

    const room = this.conversationRooms.get(conversationId);
    if (room) {
      room.delete(userId);
      if (room.size === 0) {
        this.conversationRooms.delete(conversationId);
      }
    }

    console.log(`👋 User ${userId} left conversation ${conversationId}`);
  }

  /**
   * Broadcast message to all participants in a conversation
   */
  broadcastToConversation(conversationId: string, event: MessageEvent, excludeUserId?: string): void {
    const room = this.conversationRooms.get(conversationId);
    if (!room || room.size === 0) {
      console.log(`📭 No clients in conversation ${conversationId}`);
      return;
    }

    const message = JSON.stringify(event);
    let successCount = 0;
    let errorCount = 0;

    room.forEach(userId => {
      // Skip sender if excludeUserId is specified
      if (excludeUserId && userId === excludeUserId) {
        return;
      }

      const client = this.clients.get(userId);
      if (!client || !client.isAuthenticated) {
        return;
      }

      try {
        if (client.connection.socket.readyState === 1) { // OPEN state
          client.connection.socket.send(message);
          successCount++;
        } else {
          this.removeClient(userId);
        }
      } catch (error) {
        console.error(`Error sending to user ${userId}:`, error);
        this.removeClient(userId);
        errorCount++;
      }
    });

    console.log(`📤 Broadcast to conversation ${conversationId}: ${successCount} delivered, ${errorCount} errors`);
  }

  /**
   * Send message to specific user
   */
  sendToUser(userId: string, event: MessageEvent): boolean {
    const client = this.clients.get(userId);
    if (!client || !client.isAuthenticated) {
      return false;
    }

    try {
      if (client.connection.socket.readyState === 1) {
        client.connection.socket.send(JSON.stringify(event));
        return true;
      } else {
        this.removeClient(userId);
        return false;
      }
    } catch (error) {
      console.error(`Error sending to user ${userId}:`, error);
      this.removeClient(userId);
      return false;
    }
  }

  /**
   * Handle new message event
   */
  handleNewMessage(conversationId: string, messageId: string, senderId: string, text: string): void {
    const event: MessageEvent = {
      type: 'message.new',
      conversationId,
      messageId,
      senderId,
      text,
      timestamp: new Date().toISOString(),
      status: 'sent',
    };

    // Broadcast to all participants except sender
    this.broadcastToConversation(conversationId, event, senderId);
  }

  /**
   * Handle message delivered event
   */
  handleMessageDelivered(conversationId: string, messageId: string, userId: string): void {
    const event: MessageEvent = {
      type: 'message.delivered',
      conversationId,
      messageId,
      senderId: userId,
      timestamp: new Date().toISOString(),
      status: 'delivered',
    };

    this.broadcastToConversation(conversationId, event);
  }

  /**
   * Handle message read event
   */
  handleMessageRead(conversationId: string, messageId: string, userId: string): void {
    const event: MessageEvent = {
      type: 'message.read',
      conversationId,
      messageId,
      senderId: userId,
      timestamp: new Date().toISOString(),
      status: 'read',
    };

    this.broadcastToConversation(conversationId, event);
  }

  /**
   * Handle typing indicator
   */
  handleTyping(conversationId: string, userId: string, isTyping: boolean): void {
    const event: MessageEvent = {
      type: isTyping ? 'typing.start' : 'typing.stop',
      conversationId,
      senderId: userId,
      timestamp: new Date().toISOString(),
    };

    // Broadcast to all participants except the typer
    this.broadcastToConversation(conversationId, event, userId);
  }

  /**
   * Broadcast presence update
   */
  broadcastPresenceUpdate(userId: string, isOnline: boolean): void {
    const event: MessageEvent = {
      type: 'presence.update',
      conversationId: '', // Will be set per conversation
      userId,
      senderId: userId,
      isOnline,
      timestamp: new Date().toISOString(),
    };

    // Find all conversations this user is part of and broadcast to them
    const client = this.clients.get(userId);
    const conversationIds = client ? Array.from(client.conversationIds) : [];

    conversationIds.forEach(convId => {
      const convEvent = { ...event, conversationId: convId };
      this.broadcastToConversation(convId, convEvent, userId);
    });
  }

  /**
   * Get presence status for a user
   */
  getUserPresence(userId: string): boolean {
    return this.presenceStatus.get(userId) || false;
  }

  /**
   * Get all users in a conversation
   */
  getConversationParticipants(conversationId: string): string[] {
    const room = this.conversationRooms.get(conversationId);
    return room ? Array.from(room) : [];
  }

  /**
   * Get connection stats
   */
  getStats(): {
    totalClients: number;
    totalRooms: number;
    onlineUsers: number;
    supabaseEnabled: boolean;
  } {
    const onlineUsers = Array.from(this.presenceStatus.values()).filter(isOnline => isOnline).length;

    return {
      totalClients: this.clients.size,
      totalRooms: this.conversationRooms.size,
      onlineUsers,
      supabaseEnabled: !!this.supabaseClient,
    };
  }
}

export const wsMessagingService = new WebSocketMessagingService();
