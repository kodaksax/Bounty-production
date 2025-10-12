import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

interface OfflineStatusBadgeProps {
  onPress?: () => void;
}

export function OfflineStatusBadge({ onPress }: OfflineStatusBadgeProps) {
  const { pendingCount, failedCount, isOnline } = useOfflineQueue();

  // Don't show if online and no pending/failed items
  if (isOnline && pendingCount === 0 && failedCount === 0) {
    return null;
  }

  const hasFailures = failedCount > 0;
  const backgroundColor = hasFailures ? '#dc2626' : '#f59e0b';
  const icon = hasFailures ? 'error-outline' : isOnline ? 'sync' : 'cloud-off';

  return (
    <TouchableOpacity 
      onPress={onPress}
      style={[styles.container, { backgroundColor }]}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        <MaterialIcons name={icon} size={16} color="#fff" />
        <Text style={styles.text}>
          {hasFailures 
            ? `${failedCount} failed`
            : isOnline 
              ? `${pendingCount} syncing...`
              : `${pendingCount} pending`
          }
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
