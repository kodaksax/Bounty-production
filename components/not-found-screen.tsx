import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';

interface NotFoundScreenProps {
  title?: string;
  message?: string;
  icon?: keyof typeof MaterialIcons.glyphMap;
  actionText?: string;
  onAction?: () => void;
}

/**
 * Generic 404 Not Found screen component
 * Used for missing bounties, profiles, conversations, etc.
 */
export function NotFoundScreen({
  title = 'Not Found',
  message = 'The resource you\'re looking for could not be found.',
  icon = 'search-off',
  actionText = 'Go Back',
  onAction,
}: NotFoundScreenProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <MaterialIcons name={icon} size={64} color={theme.textSecondary} />
        </View>
        
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        
        {onAction && (
          <TouchableOpacity accessibilityRole="button" 
            onPress={onAction}
            style={styles.button}
            activeOpacity={0.8}
          >
            <Text style={styles.buttonText}>{actionText}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  content: {
    alignItems: 'center',
    maxWidth: 400,
  },
  iconContainer: {
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  button: {
    backgroundColor: theme.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    minWidth: 120,
  },
  buttonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
});
}
