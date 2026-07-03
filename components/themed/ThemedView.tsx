import { useAppThemeContext } from 'lib/themes';
import React from 'react';
import { View, ViewProps } from 'react-native';

type Level = 'page' | 'surface' | 'input';

interface ThemedViewProps extends ViewProps {
  level?: Level;
}

const bgForLevel = (level: Level, theme: ReturnType<typeof useAppThemeContext>['theme']) => {
  switch (level) {
    case 'surface': return theme.surface;
    case 'input':   return theme.surfaceSecondary;
    default:        return theme.background;
  }
};

export function ThemedView({ level = 'page', style, ...props }: ThemedViewProps) {
  const { theme } = useAppThemeContext();
  return (
    <View
      style={[{ backgroundColor: bgForLevel(level, theme) }, style]}
      {...props}
    />
  );
}
