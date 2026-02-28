import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/database.types';

// Realtime event payload interface
export interface RealtimeEvent {
  type: 'bounty.status';
  id: string;
  status: 'open' | 'in_progress' | 'completed' | 'archived';
  timestamp: string;
}

export class RealtimeService {
  private supabaseClient: ReturnType<typeof createClient<Database>> | null = null;
  private wsClients: Set<any> = new Set();

  constructor() {
    // Support both server-style env names and Expo public env names (fallback)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL
    const supabaseAnon = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

    // Initialize Supabase client if credentials are available
    if (supabaseUrl && supabaseAnon) {
      this.supabaseClient = createClient<Database>(
        supabaseUrl,
        supabaseAnon
      );
      console.log('📡 Supabase Realtime client initialized');
    } else {
      console.log('⚠️  Supabase credentials not found, using WebSocket fallback only');
    }
  }

  /**
   * Add WebSocket client for fallback realtime
   */
  addWebSocketClient(ws: any): void {
    this.wsClients.add(ws);
    
    ws.socket.on('close', () => {
      this.wsClients.delete(ws);
    });

    ws.socket.on('error', (error: any) => {
      console.error('WebSocket client error:', error);
      this.wsClients.delete(ws);
    });

    console.log(`📡 WebSocket client connected, total clients: ${this.wsClients.size}`);
  }

  /**
   * Publish bounty status change event
   */
  async publishBountyStatusChange(bountyId: string, status: 'open' | 'in_progress' | 'completed' | 'archived'): Promise<void> {
    const event: RealtimeEvent = {
      type: 'bounty.status',
      id: bountyId,
      status,
      timestamp: new Date().toISOString(),
    };

    // Try Supabase Realtime first
    if (this.supabaseClient) {
      try {
        const channel = this.supabaseClient
          .channel('bounty-events')
          .send({
            type: 'broadcast',
            event: 'bounty.status',
            payload: event,
          });

        console.log(`📡 Published bounty status event via Supabase: ${bountyId} -> ${status}`);
      } catch (error) {
        console.error('❌ Failed to publish via Supabase Realtime:', error);
        // Fall back to WebSocket
        this.publishViaWebSocket(event);
      }
    } else {
      // Use WebSocket fallback
      this.publishViaWebSocket(event);
    }
  }

  /**
   * Publish event via WebSocket fallback
   */
  private publishViaWebSocket(event: RealtimeEvent): void {
    if (this.wsClients.size === 0) {
      console.log('📡 No WebSocket clients connected, event not published');
      return;
    }

    const message = JSON.stringify(event);
    let successCount = 0;
    let errorCount = 0;

    this.wsClients.forEach((ws) => {
      try {
        if (ws.socket.readyState === 1) { // OPEN state
          ws.socket.send(message);
          successCount++;
        } else {
          this.wsClients.delete(ws);
        }
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        this.wsClients.delete(ws);
        errorCount++;
      }
    });

    console.log(`📡 Published bounty status event via WebSocket: ${event.id} -> ${event.status} (${successCount} clients, ${errorCount} errors)`);
  }

  /**
   * Get connection stats
   */
  getStats(): { supabaseEnabled: boolean; wsClientCount: number } {
    return {
      supabaseEnabled: !!this.supabaseClient,
      wsClientCount: this.wsClients.size,
    };
  }
}

export const realtimeService = new RealtimeService();