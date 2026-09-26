import { LegalText } from 'components/legal/LegalText';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { ThemedButton } from 'components/themed/ThemedButton';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PRIVACY_TEXT } from '../../assets/legal/privacy';
import { TERMS_TEXT } from '../../assets/legal/terms';

interface TermsPrivacyScreenProps { onBack: () => void }

export const TermsPrivacyScreen: React.FC<TermsPrivacyScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const [tab, setTab] = useState<'terms' | 'privacy'>('terms');
  const content = tab === 'terms' ? TERMS_TEXT : PRIVACY_TEXT;

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="gavel" title="Legal" onBack={onBack} />

      <View style={s.tabBar}>
        <TouchableOpacity
          onPress={() => setTab('terms')}
          style={[s.tabButton, tab === 'terms' && s.tabButtonActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'terms' }}
        >
          <Text style={[s.tabButtonText, tab === 'terms' && s.tabButtonTextActive]}>Terms of Service</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setTab('privacy')}
          style={[s.tabButton, tab === 'privacy' && s.tabButtonActive]}
          accessibilityRole="tab"
          accessibilityState={{ selected: tab === 'privacy' }}
        >
          <Text style={[s.tabButtonText, tab === 'privacy' && s.tabButtonTextActive]}>Privacy Policy</Text>
        </TouchableOpacity>
      </View>

      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 96 }}>
        <LegalText text={content} />
        <ThemedButton variant="secondary" label="Back to Settings" onPress={onBack} style={s.backButton} />
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: t.background,
    },
    tabBar: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginBottom: 12,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      padding: 4,
      gap: 4,
    },
    tabButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 9,
    },
    tabButtonActive: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
    },
    tabButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: t.textSecondary,
    },
    tabButtonTextActive: {
      color: t.text,
    },
    backButton: {
      marginTop: 4,
      alignSelf: 'flex-start',
    },
  });
}
