/**
 * The one status badge. Words use each tone's text colour on its quiet tint,
 * so every state stays readable in both themes.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export type StatusTone = 'success' | 'warning' | 'error' | 'info' | 'neutral';

export function statusToneColors(theme: AppTheme, tone: StatusTone) {
  switch (tone) {
    case 'success':
      return { fg: theme.successText, bg: theme.successTint };
    case 'warning':
      return { fg: theme.warningText, bg: theme.warningTint };
    case 'error':
      return { fg: theme.errorText, bg: theme.errorTint };
    case 'info':
      return { fg: theme.infoText, bg: theme.infoTint };
    default:
      return { fg: theme.textSecondary, bg: theme.neutralTint };
  }
}

interface StatusPillProps {
  label: string;
  tone?: StatusTone;
  icon?: keyof typeof MaterialIcons.glyphMap;
}

export function StatusPill({ label, tone = 'neutral', icon }: StatusPillProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { fg, bg } = statusToneColors(theme, tone);

  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <MaterialIcons name={icon} size={13} color={fg} /> : null}
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radius.full,
    },
    label: {
      ...theme.textStyles.micro,
      fontWeight: '600',
    },
  });
}
