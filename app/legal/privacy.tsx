import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { LegalText } from '../../components/legal/LegalText';
import { SettingsScreenHeader } from '../../components/ui/settings-screen-header';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export default function PrivacyRoute() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="privacy-tip" title="Privacy Policy" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.content}>
        <LegalText text={PRIVACY_TEXT} />
      </ScrollView>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    content: {
      padding: 16,
      paddingBottom: 96,
    },
  });
}
