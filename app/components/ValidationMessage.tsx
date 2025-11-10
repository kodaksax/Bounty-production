import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';

interface ValidationMessageProps {
  message: string;
  type?: 'error' | 'warning' | 'info';
}

export function ValidationMessage({ message, type = 'error' }: ValidationMessageProps) {
  const iconName = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
  const iconColor = type === 'error' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#3b82f6';
  const textColor = type === 'error' ? 'text-red-400' : type === 'warning' ? 'text-yellow-400' : 'text-blue-400';

  return (
    <View className="flex-row items-start mt-2">
      <MaterialIcons name={iconName} size={16} color={iconColor} style={{ marginRight: 6, marginTop: 2 }} />
      <Text className={`${textColor} text-sm flex-1`}>
        {message}
      </Text>
    </View>
  );
}

export default ValidationMessage;
