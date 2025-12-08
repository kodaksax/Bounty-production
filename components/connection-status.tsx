/**
 * Connection Status Banner
 * Shows online/offline status with queued items count
 * Auto-dismisses when back online, persists when offline
 */

import React, { useEffect, useState } from 'react';
import { Text, View, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useOfflineMode } from '../hooks/useOfflineMode';
import { SPACING, TYPOGRAPHY, SIZING } from '../lib/constants/accessibility';

interface ConnectionStatusProps {
  /**
   * Whether to show count of queued items
   */
  showQueueCount?: boolean;
  
  /**
   * Auto-dismiss duration when back online (ms)
   */
  dismissDelay?: number;
}

/**
 * Connection status banner component
 * Appears at the top when offline, auto-dismisses when back online
 */
export function ConnectionStatus({ 
  showQueueCount = true,
  dismissDelay = 3000,
}: ConnectionStatusProps = {}) {
  const { isOnline, queuedItemsCount, checkConnection, isChecking } = useOfflineMode();
  const [showStatus, setShowStatus] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const slideAnim = React.useRef(new Animated.Value(-100)).current;

  // Track online/offline transitions
  useEffect(() => {
    if (!isOnline) {
      // Going offline - show banner
      setShowStatus(true);
      setWasOffline(true);
      
      // Slide down
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
    } else if (wasOffline) {
      // Coming back online - show briefly then hide
      setShowStatus(true);
      
      // Slide down
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start();
      
      // Auto-dismiss after delay
      const timer = setTimeout(() => {
        // Slide up
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }).start(() => {
          setShowStatus(false);
          setWasOffline(false);
        });
      }, dismissDelay);
      
      return () => clearTimeout(timer);
    }
  }, [isOnline, wasOffline, dismissDelay, slideAnim]);

  if (!showStatus) return null;

  const backgroundColor = isOnline ? '#10b981' : '#ef4444'; // green-500 : red-500
  const icon = isOnline ? 'wifi' : 'wifi-off';
  const message = isOnline 
    ? 'Back online' 
    : queuedItemsCount > 0 
      ? `You're offline. ${queuedItemsCount} ${queuedItemsCount === 1 ? 'item' : 'items'} queued.`
      : "You're offline. Some features unavailable.";

  return (
    <Animated.View
      style={[
        styles.container,
        { 
          backgroundColor,
          transform: [{ translateY: slideAnim }],
        },
      ]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <View style={styles.content}>
        <MaterialIcons 
          name={icon} 
          size={18} 
          color="#fff" 
          accessibilityElementsHidden
        />
        <Text 
          style={styles.message}
          accessibilityRole="text"
        >
          {message}
        </Text>
        
        {!isOnline && (
          <TouchableOpacity
            onPress={checkConnection}
            style={styles.retryButton}
            activeOpacity={0.7}
            disabled={isChecking}
            accessibilityRole="button"
            accessibilityLabel="Retry connection"
            accessibilityHint="Check if connection is available"
          >
            <MaterialIcons 
              name="refresh" 
              size={18} 
              color="#fff"
              style={isChecking && styles.spinning}
            />
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    paddingVertical: SPACING.COMPACT_GAP,
    paddingHorizontal: SPACING.ELEMENT_GAP,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.COMPACT_GAP,
  },
  message: {
    color: '#fff',
    fontSize: TYPOGRAPHY.SIZE_SMALL,
    fontWeight: '600',
  },
  retryButton: {
    padding: SPACING.COMPACT_GAP,
    minWidth: SIZING.MIN_TOUCH_TARGET,
    minHeight: SIZING.MIN_TOUCH_TARGET,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: SPACING.COMPACT_GAP,
  },
  spinning: {
    // Note: Actual spinning animation would require additional Animated setup
    // For now, this is a placeholder for the style
  },
});
