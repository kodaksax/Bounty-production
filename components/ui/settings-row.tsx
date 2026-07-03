import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

export interface SettingsRowProps {
  /** MaterialIcons name shown on the left. */
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  description?: string;
  onPress?: () => void;
  /** Hide the trailing chevron (e.g. for action rows that open external apps). */
  hideChevron?: boolean;
  /** Show a spinner instead of the chevron while an action is processing. */
  loading?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
}

/**
 * Reusable Settings list row. Matches the emerald Settings styling used across
 * the app and works in both light and dark mode (palette is mode-agnostic).
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
}) => {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      accessibilityState={{ disabled: isDisabled }}
      className={`bg-black/30 rounded-xl p-4 mb-3 flex-row items-center ${
        isDisabled ? 'opacity-60' : ''
      }`}
    >
      <MaterialIcons name={icon} size={22} color="#34d399" />
      <View className="ml-3 flex-1">
        <Text className="text-white font-medium text-sm" numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text className="text-emerald-200 text-xs leading-4 mt-1" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator size="small" color="#34d399" />
      ) : hideChevron ? null : (
        <MaterialIcons name="keyboard-arrow-right" size={24} color="#a7f3d0" />
      )}
    </TouchableOpacity>
  );
};
