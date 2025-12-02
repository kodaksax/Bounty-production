import React, { memo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { cn } from '../lib/utils';

export interface MessageBubbleProps {
  id: string;
  text: string;
  isUser: boolean;
  status?: 'sending' | 'sent' | 'delivered' | 'read' | 'failed';
  isPinned?: boolean;
  onLongPress?: (messageId: string) => void;
  onRetry?: (messageId: string) => void;
}

/**
 * Individual message bubble with status indicators and long-press support
 */
export const MessageBubble = memo(({ 
  id,
  text, 
  isUser, 
  status,
  isPinned,
  onLongPress,
  onRetry
}: MessageBubbleProps) => {
  const handleLongPress = () => {
    if (onLongPress) {
      onLongPress(id);
    }
  };

  const handleRetry = () => {
    if (onRetry) {
      onRetry(id);
    }
  };

  const renderStatusIcon = () => {
    if (!isUser || !status) return null;

    switch (status) {
      case 'sending':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="schedule" size={12} color="rgba(209, 250, 229, 0.6)" />
          </View>
        );
      case 'sent':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="check" size={12} color="#d5ecdc" />
          </View>
        );
      case 'delivered':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="done-all" size={12} color="#d5ecdc" />
          </View>
        );
      case 'read':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="done-all" size={12} color="#60a5fa" />
          </View>
        );
      case 'failed':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="error" size={12} color="#ef4444" />
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onLongPress={handleLongPress}
      delayLongPress={500}
    >
      <View className={cn('mb-3 px-3 max-w-[80%]', isUser ? 'ml-auto' : 'mr-auto')}>
        <View className={cn(
          'px-3 py-2 rounded-2xl',
          isUser 
            ? 'bg-emerald-500 rounded-br-none' // Current user: emerald-500, right-aligned
            : 'bg-neutral-200 rounded-bl-none' // Peer: neutral-200, left-aligned
        )}>
          {isPinned && (
            <View style={styles.pinnedBadge}>
              <MaterialIcons name="push-pin" size={12} color="#fbbf24" />
              <Text style={styles.pinnedText}>Pinned</Text>
            </View>
          )}
          <Text className={cn(
            'text-sm',
            isUser ? 'text-white' : 'text-gray-900' // Current user: white text; Peer: dark text
          )}>{text}</Text>
          {renderStatusIcon()}
        </View>
        {/* Retry button for failed messages */}
        {status === 'failed' && isUser && onRetry && (
          <TouchableOpacity 
            onPress={handleRetry}
            style={styles.retryButton}
            activeOpacity={0.7}
          >
            <MaterialIcons name="refresh" size={16} color="#ef4444" />
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
});

MessageBubble.displayName = 'MessageBubble';

const styles = StyleSheet.create({
  statusContainer: {
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  pinnedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
    paddingVertical: 2,
    paddingHorizontal: 6,
    backgroundColor: 'rgba(251, 191, 36, 0.2)',
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  pinnedText: {
    fontSize: 10,
    color: '#fbbf24',
    fontWeight: '600',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 4,
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ef4444',
    alignSelf: 'flex-end',
  },
  retryText: {
    fontSize: 12,
    color: '#ef4444',
    fontWeight: '600',
  },
});
