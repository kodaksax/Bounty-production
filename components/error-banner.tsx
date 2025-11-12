import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { UserFriendlyError } from '../lib/utils/error-messages';

interface ErrorBannerProps {
  error: UserFriendlyError;
  onDismiss?: () => void;
  onAction?: () => void;
}

/**
 * Reusable error banner component with user-friendly messages
 * Shows at the top of screens with dismiss and action buttons
 */
export function ErrorBanner({ error, onDismiss, onAction }: ErrorBannerProps) {
  const backgroundColor = error.type === 'validation' ? '#f59e0b' : '#dc2626';
  
  return (
    <View style={[styles.container, { backgroundColor }]}>
      <View style={styles.content}>
        <MaterialIcons name="error-outline" size={20} color="#fff" />
        <View style={styles.textContainer}>
          <Text style={styles.title}>{error.title}</Text>
          <Text style={styles.message}>{error.message}</Text>
        </View>
      </View>
      
      <View style={styles.actions}>
        {error.retryable && onAction && error.action && (
          <TouchableOpacity 
            onPress={onAction}
            style={styles.actionButton}
            activeOpacity={0.7}
          >
            <Text style={styles.actionText}>{error.action}</Text>
          </TouchableOpacity>
        )}
        
        {onDismiss && (
          <TouchableOpacity 
            onPress={onDismiss}
            style={styles.dismissButton}
            activeOpacity={0.7}
          >
            <MaterialIcons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderRadius: 8,
    marginBottom: 12,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  message: {
    color: '#fff',
    fontSize: 13,
    opacity: 0.95,
    lineHeight: 18,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 4,
  },
  actionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  dismissButton: {
    padding: 4,
  },
});
