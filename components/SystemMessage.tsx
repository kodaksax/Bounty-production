// components/SystemMessage.tsx - System message component for chat
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface SystemMessageProps {
  message: string;
  type?: 'info' | 'warning' | 'revision';
  timestamp?: string;
}

/**
 * System message component for displaying non-user messages in chat
 * Used for system notifications like revision requests, status updates, etc.
 */
export function SystemMessage({ message, type = 'info', timestamp }: SystemMessageProps) {
  const getIconName = () => {
    switch (type) {
      case 'warning':
        return 'error'; // Using 'error' as it's a standard Material icon for warnings
      case 'revision':
        return 'feedback';
      default:
        return 'info-outline';
    }
  };

  const getIconColor = () => {
    switch (type) {
      case 'warning':
        return '#fbbf24';
      case 'revision':
        return '#fbbf24';
      default:
        return '#80c795';
    }
  };

  return (
    <View style={styles.container}>
      <View style={[
        styles.messageBox,
        type === 'revision' && styles.revisionBox,
        type === 'warning' && styles.warningBox
      ]}>
        <MaterialIcons name={getIconName()} size={16} color={getIconColor()} />
        <View style={styles.textContainer}>
          <Text style={styles.messageText}>{message}</Text>
          {timestamp && (
            <Text style={styles.timestamp}>
              {new Date(timestamp).toLocaleString()}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  messageBox: {
    backgroundColor: 'rgba(0, 117, 35, 0.15)',
    borderRadius: 12,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    maxWidth: '85%',
    borderWidth: 1,
    borderColor: 'rgba(128, 199, 149, 0.3)',
  },
  revisionBox: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
    borderColor: 'rgba(251, 191, 36, 0.5)',
  },
  warningBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  textContainer: {
    flex: 1,
    gap: 4,
  },
  messageText: {
    color: '#fff',
    fontSize: 13,
    lineHeight: 18,
  },
  timestamp: {
    color: 'rgba(255,254,245,0.5)',
    fontSize: 11,
  },
});
