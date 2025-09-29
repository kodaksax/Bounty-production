import NetInfo from '@react-native-community/netinfo';
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ErrorBanner } from 'components/ui/error-banner';

interface ConnectionState {
  isConnected: boolean;
  type: string;
  isInternetReachable: boolean | null;
}

export function useNetworkStatus() {
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    isConnected: true,
    type: 'unknown',
    isInternetReachable: null,
  });

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setConnectionState({
        isConnected: state.isConnected ?? false,
        type: state.type,
        isInternetReachable: state.isInternetReachable,
      });
    });

    return () => unsubscribe();
  }, []);

  return connectionState;
}

interface NetworkStatusBarProps {
  style?: any;
}

export function NetworkStatusBar({ style }: NetworkStatusBarProps) {
  const { isConnected, isInternetReachable } = useNetworkStatus();
  
  // Don't show anything if connected and internet is reachable
  if (isConnected && isInternetReachable !== false) {
    return null;
  }

  const getMessage = () => {
    if (!isConnected) {
      return "No internet connection. Please check your network settings.";
    }
    if (isInternetReachable === false) {
      return "Connected to network but no internet access.";
    }
    return "Connection issues detected.";
  };

  return (
    <View style={[styles.container, style]}>
      <ErrorBanner
        type="warning"
        message={getMessage()}
        onRetry={() => {
          // Force a network state check
          NetInfo.fetch().then(state => {
            console.log('Network state:', state);
          });
        }}
      />
    </View>
  );
}

// Component to show cached content indicator
interface OfflineIndicatorProps {
  isVisible: boolean;
  style?: any;
}

export function OfflineIndicator({ isVisible, style }: OfflineIndicatorProps) {
  if (!isVisible) return null;

  return (
    <View style={[styles.offlineContainer, style]}>
      <Text style={styles.offlineText}>
        📱 Offline Mode - Showing cached content
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    zIndex: 1000,
  },
  offlineContainer: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  offlineText: {
    color: '#fbbf24',
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});