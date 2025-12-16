import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { logger } from 'lib/utils/error-logger';
import type { Bounty } from './database.types';

// Queue item types
export type QueueItemType = 'bounty' | 'message';

export interface QueueItem {
  id: string;
  type: QueueItemType;
  timestamp: number;
  retryCount: number;
  data: BountyQueueData | MessageQueueData;
  status: 'pending' | 'processing' | 'failed';
  error?: string;
}

export interface BountyQueueData {
  bounty: Omit<Bounty, 'id' | 'created_at'>;
  tempId?: string; // Temporary ID for optimistic UI
}

export interface MessageQueueData {
  conversationId: string;
  text: string;
  senderId: string;
  tempId?: string; // Temporary ID for optimistic UI
}

const QUEUE_KEY = 'offline-queue-v1';
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000; // 1 second

class OfflineQueueService {
  private queue: QueueItem[] = [];
  private isOnline = true;
  private isProcessing = false;
  private listeners: Set<() => void> = new Set();

  constructor() {
    // Listen for network state changes
    NetInfo.addEventListener(state => {
      const wasOffline = !this.isOnline;
      this.isOnline = !!state.isConnected;
      
      // If we just came back online, process the queue
      if (wasOffline && this.isOnline) {
        this.processQueue();
      }
    });

    // Load queue from storage on initialization
    this.loadQueue();
  }

  /**
   * Add a listener for queue changes
   */
  addListener(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of queue changes
   */
  private notifyListeners() {
    this.listeners.forEach(listener => listener());
  }

  /**
   * Load queue from AsyncStorage
   */
  private async loadQueue() {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
  logger.info(`Loaded ${this.queue.length} items from offline queue`);
        // Debug: inspect queued bounty items for attachments_json presence
        try {
          this.queue.forEach(q => {
            if (q.type === 'bounty') {
              const b = (q.data as BountyQueueData).bounty as any
              const hasAttachmentsJson = !!b?.attachments_json
              const attachmentsLen = Array.isArray(b?.attachments) ? b.attachments.length : 0
              if (!hasAttachmentsJson && attachmentsLen > 0) {
              }
            }
          })
        } catch (e) {
          logger.warning('[offlineQueue] error inspecting loaded queue for debug', { error: (e as any)?.message })
        }
        
        // Process if online
        if (this.isOnline) {
          this.processQueue();
        }
      }
    } catch (error) {
      console.error('Failed to load offline queue:', error);
    }
  }

  /**
   * Save queue to AsyncStorage
   */
  private async saveQueue() {
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (error) {
      console.error('Failed to save offline queue:', error);
    }
  }

  /**
   * Add an item to the queue
   */
  async enqueue(type: QueueItemType, data: BountyQueueData | MessageQueueData): Promise<QueueItem> {
    const item: QueueItem = {
      id: `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type,
      timestamp: Date.now(),
      retryCount: 0,
      data,
      status: 'pending',
    };

    this.queue.push(item);
    await this.saveQueue();

    logger.info(`Enqueued ${type} item: ${item.id}`)

    // Extra debug: if this is a bounty, print whether attachments are present on the queued payload
    try {
      if (type === 'bounty') {
        const payload = (data as BountyQueueData).bounty as any
        const hasAttachmentsJson = !!payload?.attachments_json
        const attachmentsArrayLength = Array.isArray(payload?.attachments) ? payload.attachments.length : 0
        logger.info(`[offlineQueue] queued bounty payload attachments_json: ${hasAttachmentsJson}, attachments.length: ${attachmentsArrayLength}`)
      }
    } catch (e) {
      logger.warning('[offlineQueue] failed to inspect queued payload for debug', { error: (e as any)?.message })
    }

    // If online, try to process immediately
    if (this.isOnline) {
      this.processQueue();
    }

    return item;
  }

  /**
   * Process the queue - retry failed items
   */
  async processQueue() {
    if (this.isProcessing || !this.isOnline) {
      return;
    }

    this.isProcessing = true;

    try {
      // Get all pending items
      const pendingItems = this.queue.filter(item => item.status === 'pending');

      if (pendingItems.length === 0) {
        return;
      }


      for (const item of pendingItems) {
        // Check if item has exceeded max retries
        if (item.retryCount >= MAX_RETRIES) {
          item.status = 'failed';
          item.error = 'Max retries exceeded';
          console.error(`❌ Item ${item.id} failed: max retries exceeded`);
          continue;
        }

        // Calculate backoff delay
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, item.retryCount);
        const timeSinceLastAttempt = Date.now() - item.timestamp;

        if (timeSinceLastAttempt < backoffMs) {
          // Too soon to retry, skip for now
          continue;
        }

        // Mark as processing
        item.status = 'processing';
        await this.saveQueue();

        try {
          // Process based on type
          if (item.type === 'bounty') {
            await this.processBountyItem(item);
          } else if (item.type === 'message') {
            await this.processMessageItem(item);
          }

          // Remove from queue on success
          this.queue = this.queue.filter(i => i.id !== item.id);
        } catch (error) {
          // Mark as pending for retry
          item.status = 'pending';
          item.retryCount++;
          item.timestamp = Date.now();
          item.error = error instanceof Error ? error.message : 'Unknown error';
          console.error(`⚠️ Failed to process item ${item.id}, retry ${item.retryCount}/${MAX_RETRIES}:`, error);
        }

        await this.saveQueue();
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a bounty queue item
   */
  private async processBountyItem(item: QueueItem) {
    const data = item.data as BountyQueueData;
    // Import bounty service dynamically to avoid circular dependency
      try {
        // Debug: show attachments_json presence before processing
        const b = data.bounty as any
        const hasAttachmentsJson = !!b?.attachments_json
        const attachmentsLen = Array.isArray(b?.attachments) ? b.attachments.length : 0
        logger.info(`[offlineQueue] processing queued bounty item ${item.id} - attachments_json: ${hasAttachmentsJson}, attachments.length: ${attachmentsLen}`)
      } catch (e) {
        logger.warning('[offlineQueue] failed to inspect bounty payload before processing', { error: (e as any)?.message })
      }
      const { bountyService } = await import('./bounty-service');
      await bountyService.processQueuedBounty(data.bounty);
  }

  /**
   * Process a message queue item
   */
  private async processMessageItem(item: QueueItem) {
    const data = item.data as MessageQueueData;
    // Import message service dynamically to avoid circular dependency
    const { messageService } = await import('./message-service');
    await messageService.processQueuedMessage(data.conversationId, data.text, data.senderId);
  }

  /**
   * Get all queue items
   */
  getQueue(): QueueItem[] {
    return [...this.queue];
  }

  /**
   * Get queue items by type
   */
  getQueueByType(type: QueueItemType): QueueItem[] {
    return this.queue.filter(item => item.type === type);
  }

  /**
   * Remove an item from the queue
   */
  async removeItem(itemId: string): Promise<boolean> {
    const initialLength = this.queue.length;
    this.queue = this.queue.filter(item => item.id !== itemId);
    
    if (this.queue.length < initialLength) {
      await this.saveQueue();
      return true;
    }
    
    return false;
  }

  /**
   * Clear all failed items from the queue
   */
  async clearFailedItems() {
    const before = this.queue.length;
    this.queue = this.queue.filter(item => item.status !== 'failed');
    const removed = before - this.queue.length;
    
    if (removed > 0) {
      await this.saveQueue();
    }
  }

  /**
   * Retry a specific item
   */
  async retryItem(itemId: string) {
    const item = this.queue.find(i => i.id === itemId);
    
    if (!item) {
      return false;
    }

    // Reset retry count and mark as pending
    item.status = 'pending';
    item.retryCount = 0;
    item.timestamp = Date.now();
    item.error = undefined;
    
    await this.saveQueue();

    // Process immediately if online
    if (this.isOnline) {
      this.processQueue();
    }

    return true;
  }

  /**
   * Check if there are pending items
   */
  hasPendingItems(): boolean {
    return this.queue.some(item => item.status === 'pending' || item.status === 'processing');
  }

  /**
   * Get current online status
   */
  getOnlineStatus(): boolean {
    return this.isOnline;
  }
}

// Export singleton instance
export const offlineQueueService = new OfflineQueueService();
