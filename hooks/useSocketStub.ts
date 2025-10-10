/**
 * Socket stub for dev/mock socket events
 * Simulates real-time features like typing indicators and message status updates
 */

import { useEffect, useRef } from 'react';

export interface TypingEvent {
  userId: string;
  conversationId: string;
}

export interface MessageStatusEvent {
  messageId: string;
  status: 'delivered' | 'read';
}

type TypingCallback = (event: TypingEvent) => void;
type MessageStatusCallback = (event: MessageStatusEvent) => void;

class SocketStub {
  private typingCallbacks: TypingCallback[] = [];
  private messageStatusCallbacks: MessageStatusCallback[] = [];
  // Use ReturnType<typeof setTimeout> for cross-environment compatibility (NodeJS or browser)
  private typingTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();

  /**
   * Emit a typing event (for testing/dev)
   */
  emitTyping(userId: string, conversationId: string) {
    const event: TypingEvent = { userId, conversationId };
    this.typingCallbacks.forEach(cb => cb(event));

    // Auto-clear typing after 3 seconds
    const key = `${userId}-${conversationId}`;
    const existingTimeout = this.typingTimeouts.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout);
    }
    
    const timeout = setTimeout(() => {
      // Emit stop typing (empty userId means stop)
      this.typingCallbacks.forEach(cb => cb({ userId: '', conversationId }));
      this.typingTimeouts.delete(key);
    }, 3000);
    
    this.typingTimeouts.set(key, timeout);
  }

  /**
   * Subscribe to typing events
   */
  onTyping(callback: TypingCallback): () => void {
    this.typingCallbacks.push(callback);
    return () => {
      const index = this.typingCallbacks.indexOf(callback);
      if (index > -1) {
        this.typingCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Emit a message delivered event
   */
  emitMessageDelivered(messageId: string) {
    const event: MessageStatusEvent = { messageId, status: 'delivered' };
    this.messageStatusCallbacks.forEach(cb => cb(event));
  }

  /**
   * Emit a message read event
   */
  emitMessageRead(messageId: string) {
    const event: MessageStatusEvent = { messageId, status: 'read' };
    this.messageStatusCallbacks.forEach(cb => cb(event));
  }

  /**
   * Subscribe to message status events
   */
  onMessageStatus(callback: MessageStatusCallback): () => void {
    this.messageStatusCallbacks.push(callback);
    return () => {
      const index = this.messageStatusCallbacks.indexOf(callback);
      if (index > -1) {
        this.messageStatusCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Simulate automatic status transitions for a message
   * delivered after 300ms, read after 3s
   */
  simulateMessageStatusTransition(messageId: string) {
    setTimeout(() => {
      this.emitMessageDelivered(messageId);
    }, 300);

    setTimeout(() => {
      this.emitMessageRead(messageId);
    }, 3000);
  }
}

// Singleton instance
export const socketStub = new SocketStub();

/**
 * Hook to subscribe to typing events for a conversation
 */
export function useTypingIndicator(conversationId: string) {
  const typingUsersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsubscribe = socketStub.onTyping((event) => {
      if (event.conversationId !== conversationId) return;

      if (event.userId === '') {
        // Stop typing
        typingUsersRef.current.clear();
      } else if (event.userId !== 'current-user') {
        // Someone is typing
        typingUsersRef.current.add(event.userId);
      }
    });

    return unsubscribe;
  }, [conversationId]);

  return typingUsersRef;
}

/**
 * Hook to subscribe to message status updates
 */
export function useMessageStatus(onStatusUpdate: (messageId: string, status: 'delivered' | 'read') => void) {
  useEffect(() => {
    const unsubscribe = socketStub.onMessageStatus((event) => {
      onStatusUpdate(event.messageId, event.status);
    });

    return unsubscribe;
  }, [onStatusUpdate]);
}
