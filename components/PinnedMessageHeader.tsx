import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface PinnedMessageHeaderProps {
  text: string;
  onPress?: () => void;
  onDismiss?: () => void;
}

/**
 * Header showing the currently pinned message
 */
export function PinnedMessageHeader({ text, onPress, onDismiss }: PinnedMessageHeaderProps) {
  return (
    <TouchableOpacity 
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        <MaterialIcons name="push-pin" size={18} color="#fbbf24" />
        <View style={styles.textContainer}>
          <Text style={styles.label}>Pinned Message</Text>
          <Text style={styles.text} numberOfLines={1}>
            {text}
          </Text>
        </View>
      </View>
      {onDismiss && (
        <TouchableOpacity 
          style={styles.dismissButton}
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          <MaterialIcons name="close" size={20} color="#d5ecdc" />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)', // amber tint
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(251, 191, 36, 0.3)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 11,
    color: '#fbbf24',
    fontWeight: '600',
    marginBottom: 2,
  },
  text: {
    fontSize: 14,
    color: '#d5ecdc',
  },
  dismissButton: {
    padding: 4,
  },
});
