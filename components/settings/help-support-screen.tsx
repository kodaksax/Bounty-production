import { SettingsRow } from 'components/ui/settings-row';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface HelpSupportScreenProps {
  onBack: () => void;
  onNavigateContact: () => void;
  onNavigateTerms: () => void;
  onNavigateFAQ: () => void;
}

export const HelpSupportScreen: React.FC<HelpSupportScreenProps> = ({
  onBack,
  onNavigateContact,
  onNavigateTerms,
  onNavigateFAQ,
}) => {
  const { theme } = useAppThemeContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.screen}>
      <SettingsScreenHeader icon="help-center" title="Help & Support" onBack={onBack} />
      <ScrollView
        contentContainerStyle={[s.scrollContent, { paddingBottom: Math.max(insets.bottom, 24) + 24 }]}
      >
        <SettingsSection>
          {/* The plain-language explainer of fees, escrow, verification and
              disputes. It existed only behind pre-auth onboarding and the
              poster's price step, so a signed-in hunter had no route to it at
              all — they could not find out how or when they get paid. */}
          <SettingsRow
            icon="shield"
            label="How Bounty works"
            description="Fees, escrow, getting paid, and what happens if something goes wrong."
            onPress={() => router.push('/legal/how-it-works' as Href)}
          />
          <SettingsRow
            icon="support-agent"
            label="Contact Support"
            description="Submit issues, disputes, or detailed questions directly."
            onPress={onNavigateContact}
          />
          <SettingsRow
            icon="gavel"
            label="Terms & Privacy Policy"
            description="Read our platform's terms of use and privacy handling."
            onPress={onNavigateTerms}
          />
          <SettingsRow
            icon="help-outline"
            label="FAQ"
            description="Browse common questions and quick answers."
            onPress={onNavigateFAQ}
          />
        </SettingsSection>
      </ScrollView>
    </View>
  );
};

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: t.background,
    },
    scrollContent: {
      paddingHorizontal: 16,
      paddingTop: 20,
    },
  });
}
