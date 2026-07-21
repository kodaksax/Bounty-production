import { MaterialIcons } from '@expo/vector-icons';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from './screen-header';

interface SettingsScreenHeaderProps {
  icon?: keyof typeof MaterialIcons.glyphMap;
  title: string;
  onBack?: () => void;
  rightNode?: React.ReactNode;
}

/**
 * Canonical header for every Settings sub-screen: back button on the left,
 * an icon + title centered, safe-area aware. Keeps every settings screen's
 * header identical instead of each one rolling its own back-button/logo row.
 */
export function SettingsScreenHeader({ icon, title, onBack, rightNode }: SettingsScreenHeaderProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const s = makeStyles(theme);

  return (
    <View style={[s.wrapper, { paddingTop: insets.top }]}>
      <ScreenHeader
        showBack
        onBack={onBack}
        rightNode={rightNode}
        centerNode={
          <View style={s.titleRow}>
            {icon ? <MaterialIcons name={icon} size={18} color={theme.text} /> : null}
            <Text style={s.titleText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {title}
            </Text>
          </View>
        }
      />
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    wrapper: {
      backgroundColor: t.background,
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 1,
      maxWidth: '100%',
    },
    titleText: {
      fontSize: 17,
      fontWeight: '700',
      color: t.text,
      flexShrink: 1,
    },
  });
}
