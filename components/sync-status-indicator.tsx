/**
 * Sync Status Indicator
 * Shows real-time sync progress for offline queue items
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineQueue } from '../hooks/useOfflineQueue';

interface SyncStatusIndicatorProps {
  /**
   * Whether to show details or just an icon
   */
  detailed?: boolean;
  
  /**
   * Size of the indicator
   */
  size?: 'small' | 'medium' | 'large';
  
  /**
   * Custom style
   */
  style?: any;
}

/**
 * Component that displays the current sync status
 * Shows different states: syncing, idle, error
 * 
 * @example
 * ```tsx
 * <SyncStatusIndicator detailed={true} size="medium" />
 * ```
 */
export function SyncStatusIndicator({ 
  detailed = false, 
  size = 'medium',
  style 
}: SyncStatusIndicatorProps) {
  const { pendingCount, failedCount, isOnline } = useOfflineQueue();
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Show syncing state when online with pending items
    setIsSyncing(isOnline && pendingCount > 0);
  }, [isOnline, pendingCount]);

  // Don't show if nothing to display
  if (!isSyncing && failedCount === 0 && (isOnline || pendingCount === 0)) {
    return null;
  }

  const iconSize = size === 'small' ? 16 : size === 'medium' ? 20 : 24;
  const textSize = size === 'small' ? 11 : size === 'medium' ? 13 : 15;

  return (
    <View style={[styles.container, style]}>
      {isSyncing ? (
        <>
          <ActivityIndicator size="small" color="#3b82f6" />
          {detailed && (
            <Text style={[styles.text, { fontSize: textSize }]}>
              Syncing {pendingCount} {pendingCount === 1 ? 'item' : 'items'}
            </Text>
          )}
        </>
      ) : failedCount > 0 ? (
        <>
          <MaterialIcons name="error-outline" size={iconSize} color="#dc2626" />
          {detailed && (
            <Text style={[styles.text, styles.errorText, { fontSize: textSize }]}>
              {failedCount} failed
            </Text>
          )}
        </>
      ) : !isOnline && pendingCount > 0 ? (
        <>
          <MaterialIcons name="cloud-off" size={iconSize} color="#f59e0b" />
          {detailed && (
            <Text style={[styles.text, styles.warningText, { fontSize: textSize }]}>
              {pendingCount} pending
            </Text>
          )}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  text: {
    color: '#3b82f6',
    fontWeight: '500',
  },
  errorText: {
    color: '#dc2626',
  },
  warningText: {
    color: '#f59e0b',
  },
});

/**
 * Badge version that shows a count
 */
export function SyncStatusBadge({ style }: { style?: any }) {
  const { pendingCount, failedCount, isOnline } = useOfflineQueue();

  if (pendingCount === 0 && failedCount === 0) {
    return null;
  }

  const count = failedCount > 0 ? failedCount : pendingCount;
  const backgroundColor = failedCount > 0 ? '#dc2626' : '#f59e0b';

  return (
    <View style={[badgeStyles.badge, { backgroundColor }, style]}>
      <Text style={badgeStyles.badgeText}>{count}</Text>
    </View>
  );
}

const badgeStyles = StyleSheet.create({
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
});

// (Intentional) badge styles already defined above; no duplicate export.
