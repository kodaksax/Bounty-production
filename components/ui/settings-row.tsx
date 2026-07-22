import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export interface SettingsRowProps {
  /** MaterialIcons name shown on the left. */
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  description?: string;
  onPress?: () => void;
  /** Hide the trailing chevron (e.g. for rows that render their own `right` control). */
  hideChevron?: boolean;
  /** Show a spinner instead of the chevron while an action is processing. */
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Custom trailing content (e.g. a Switch or a value label) instead of the chevron/spinner. */
  right?: React.ReactNode;
  /** 'destructive' tints the icon and label in the theme's error color. */
  tone?: 'default' | 'destructive';
}

/**
 * Themed Settings list row. Designed to sit inside a `SettingsSection` card —
 * rows are transparent and full-bleed; the section provides the surface,
 * border, and dividers between rows.
 */
export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon,
  label,
  description,
  onPress,
  hideChevron = false,
  loading = false,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  right,
  tone = 'default',
}) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const isDisabled = disabled || loading;
  const isDestructive = tone === 'destructive';

  const content = (
    <View style={[s.row, isDisabled && s.rowDisabled]}>
      <View style={[s.iconBadge, isDestructive && s.iconBadgeDestructive]}>
        <MaterialIcons name={icon} size={20} color={isDestructive ? theme.error : theme.primaryLight} />
      </View>
      <View style={s.textBlock}>
        <Text style={[s.label, isDestructive && s.labelDestructive]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={s.description} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {right !== undefined ? (
        right
      ) : loading ? (
        <ActivityIndicator size="small" color={theme.textSecondary} />
      ) : hideChevron || !onPress ? null : (
        <MaterialIcons name="chevron-right" size={22} color={theme.textDisabled} />
      )}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled }}
      activeOpacity={0.6}
    >
      {content}
    </TouchableOpacity>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 56,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    rowDisabled: {
      opacity: 0.5,
    },
    iconBadge: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
      marginRight: 12,
    },
    iconBadgeDestructive: {
      backgroundColor: t.isDark ? 'rgba(239,68,68,0.16)' : 'rgba(239,68,68,0.1)',
    },
    textBlock: {
      flex: 1,
      marginRight: 8,
    },
    label: {
      fontSize: 15,
      fontWeight: '600',
      color: t.text,
    },
    labelDestructive: {
      color: t.error,
    },
    description: {
      fontSize: 13,
      lineHeight: 17,
      color: t.textSecondary,
      marginTop: 2,
    },
  });
}
