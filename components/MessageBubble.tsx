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
  onLongPress 
}: MessageBubbleProps) => {
  const handleLongPress = () => {
    if (onLongPress) {
      onLongPress(id);
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
            <MaterialIcons name="check" size={12} color="#d1fae5" />
          </View>
        );
      case 'delivered':
        return (
          <View style={styles.statusContainer}>
            <MaterialIcons name="done-all" size={12} color="#d1fae5" />
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
        <View className={cn('px-3 py-2 rounded-2xl', isUser ? 'bg-white rounded-br-none' : 'bg-emerald-700/60 rounded-bl-none')}>
          {isPinned && (
            <View style={styles.pinnedBadge}>
              <MaterialIcons name="push-pin" size={12} color="#fbbf24" />
              <Text style={styles.pinnedText}>Pinned</Text>
            </View>
          )}
          <Text className={cn('text-sm', isUser ? 'text-gray-900' : 'text-white')}>{text}</Text>
          {renderStatusIcon()}
        </View>
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
});
