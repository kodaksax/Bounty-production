import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';

export function TrustSafetyNotice({ message, urgent = false }: { message: string; urgent?: boolean }) {
  const { theme } = useAppThemeContext();
  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
      <MaterialIcons
        name={urgent ? 'warning-amber' : 'shield'}
        size={20}
        color={theme.primary}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <Text style={[styles.text, { color: theme.text }]} accessibilityRole="text">
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, marginVertical: 8 },
  text: { flex: 1, fontSize: 14, lineHeight: 21 },
});
