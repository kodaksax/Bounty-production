/**
 * Global Offline Mode Banner
 * Displays when the device is offline or has pending sync items
 * Shows sync status and provides manual refresh action
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineMode } from '../hooks/useOfflineMode';

interface OfflineModeBannerProps {
  /**
   * Whether to show sync details (queued items count)
   */
  showDetails?: boolean;
  
  /**
   * Custom style for the banner
   */
  style?: any;
}

/**
 * Banner component that appears at the top of the screen when offline
 * or when there are pending sync items.
 * 
 * Features:
 * - Shows offline status with appropriate icon
 * - Displays count of pending sync items
 * - Allows manual sync trigger when online
 * - Auto-hides when online with no pending items
 * 
 * @example
 * ```tsx
 * <OfflineModeBanner showDetails={true} />
 * ```
 */
export function OfflineModeBanner({ showDetails = true, style }: OfflineModeBannerProps) {
  const { isOnline, isChecking, queuedItemsCount, checkConnection } = useOfflineMode();
  const [fadeAnim] = React.useState(new Animated.Value(1));

  // Don't show banner if online and no queued items
  const shouldShow = !isOnline || queuedItemsCount > 0;

  React.useEffect(() => {
    if (shouldShow) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [shouldShow, fadeAnim]);

  if (!shouldShow) {
    return null;
  }

  const backgroundColor = !isOnline ? '#f59e0b' : queuedItemsCount > 0 ? '#3b82f6' : '#10b981';
  const icon = !isOnline ? 'cloud-off' : isChecking ? 'sync' : 'cloud-done';

  return (
    <Animated.View style={[styles.container, { backgroundColor, opacity: fadeAnim }, style]}>
      <View style={styles.content}>
        <MaterialIcons 
          name={icon} 
          size={20} 
          color="#fff" 
          style={isChecking ? styles.spinningIcon : undefined}
        />
        
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            {!isOnline 
              ? 'No Internet Connection' 
              : queuedItemsCount > 0 
                ? 'Syncing...'
                : 'Connected'
            }
          </Text>
          
          {showDetails && queuedItemsCount > 0 && (
            <Text style={styles.subtitle}>
              {queuedItemsCount} {queuedItemsCount === 1 ? 'item' : 'items'} pending
            </Text>
          )}
          
          {showDetails && !isOnline && (
            <Text style={styles.subtitle}>
              Changes will sync when you're back online
            </Text>
          )}
        </View>

        {isOnline && queuedItemsCount > 0 && !isChecking && (
          <TouchableOpacity 
            onPress={checkConnection}
            style={styles.refreshButton}
            activeOpacity={0.7}
          >
            <MaterialIcons name="refresh" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    paddingVertical: 12,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: '#fff',
    fontSize: 12,
    opacity: 0.9,
    marginTop: 2,
  },
  refreshButton: {
    padding: 4,
  },
  spinningIcon: {
    // Add animation class if needed
  },
});

/**
 * Compact version of the offline banner for use in specific screens
 */
export function CompactOfflineBanner({ style }: { style?: any }) {
  const { isOnline, queuedItemsCount } = useOfflineMode();

  if (isOnline && queuedItemsCount === 0) {
    return null;
  }

  return (
    <View style={[styles.compactContainer, style]}>
      <MaterialIcons 
        name={!isOnline ? 'cloud-off' : 'sync'} 
        size={16} 
        color="#f59e0b" 
      />
      <Text style={styles.compactText}>
        {!isOnline 
          ? 'Offline' 
          : `${queuedItemsCount} syncing`
        }
      </Text>
    </View>
  );
}

const compactStyles = StyleSheet.create({
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fef3c7',
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  compactText: {
    color: '#92400e',
    fontSize: 12,
    fontWeight: '600',
  },
});

// Merge styles for compact banner
Object.assign(styles, compactStyles);
