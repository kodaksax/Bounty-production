import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from './button';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
  type?: 'error' | 'warning' | 'info';
}

export function ErrorBanner({ 
  message, 
  onRetry, 
  onDismiss, 
  type = 'error' 
}: ErrorBannerProps) {
  const getIconName = () => {
    switch (type) {
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'error';
    }
  };

  const getColors = () => {
    switch (type) {
      case 'warning': 
        return {
          bg: 'rgba(245, 158, 11, 0.2)',
          border: 'rgba(245, 158, 11, 0.4)',
          text: '#fbbf24',
          icon: '#f59e0b'
        };
      case 'info':
        return {
          bg: 'rgba(59, 130, 246, 0.2)',
          border: 'rgba(59, 130, 246, 0.4)',
          text: '#93c5fd',
          icon: '#3b82f6'
        };
      default:
        return {
          bg: 'rgba(220, 38, 38, 0.2)',
          border: 'rgba(220, 38, 38, 0.4)',
          text: '#fca5a5',
          icon: '#dc2626'
        };
    }
  };

  const colors = getColors();

  return (
    <View 
      style={[
        styles.container,
        {
          backgroundColor: colors.bg,
          borderColor: colors.border,
        }
      ]}
      accessible={true}
      accessibilityRole="alert"
      accessibilityLabel={message}
    >
      <View style={styles.content}>
        <MaterialIcons 
          name={getIconName()} 
          size={20} 
          color={colors.icon}
          style={styles.icon}
          accessibilityElementsHidden={true}
        />
        <Text 
          style={[styles.message, { color: colors.text }]}
          numberOfLines={2}
        >
          {message}
        </Text>
      </View>
      
      <View style={styles.actions}>
        {onRetry && (
          <Button
            variant="ghost"
            size="sm"
            onPress={onRetry}
            style={styles.actionButton}
            accessibilityLabel="Retry action"
            accessibilityHint="Tap to try the failed action again"
          >
            Retry
          </Button>
        )}
        {onDismiss && (
          <Button
            variant="ghost"
            size="icon"
            onPress={onDismiss}
            style={styles.dismissButton}
            accessibilityLabel="Dismiss error"
            accessibilityHint="Tap to hide this error message"
          >
            <MaterialIcons name="close" size={16} color={colors.text} />
          </Button>
        )}
      </View>
    </View>
  );
}

interface ConnectionStatusProps {
  isOffline: boolean;
  onRetry?: () => void;
}

export function ConnectionStatus({ isOffline, onRetry }: ConnectionStatusProps) {
  if (!isOffline) return null;

  return (
    <ErrorBanner
      type="warning"
      message="You're offline. Some features may not be available."
      onRetry={onRetry}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    // Add subtle shadow
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  icon: {
    marginRight: 12,
  },
  message: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    minHeight: 32,
  },
  dismissButton: {
    width: 32,
    height: 32,
    marginLeft: 4,
  },
});