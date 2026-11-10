import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { withAlpha } from '../lib/utils';

interface PinnedMessageHeaderProps {
  text: string;
  onPress?: () => void;
  onDismiss?: () => void;
}

/**
 * Header showing the currently pinned message
 */
export function PinnedMessageHeader({ text, onPress, onDismiss }: PinnedMessageHeaderProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <TouchableOpacity accessibilityRole="button" 
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={styles.content}>
        <MaterialIcons name="push-pin" size={18} color={theme.warningText} />
        <View style={styles.textContainer}>
          <Text style={styles.label}>Pinned Message</Text>
          <Text style={styles.text} numberOfLines={1}>
            {text}
          </Text>
        </View>
      </View>
      {onDismiss && (
        <TouchableOpacity accessibilityLabel="Close" accessibilityRole="button" 
          style={styles.dismissButton}
          onPress={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
        >
          <MaterialIcons name="close" size={20} color={theme.textSecondary} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    backgroundColor: withAlpha(theme.warning, 0.15), // amber tint
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(theme.warning, 0.3),
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
    fontSize: 12,
    color: theme.warningText,
    fontWeight: '600',
    marginBottom: 2,
  },
  text: {
    fontSize: 14,
    color: theme.textSecondary,
  },
  dismissButton: {
    padding: 4,
  },
});
}
