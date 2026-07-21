import { ThemedButton } from 'components/themed/ThemedButton';
import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { COMMUNITY_GUIDELINES_TEXT } from '../../assets/legal/community-guidelines';

interface CommunityGuidelinesScreenProps {
  onBack: () => void;
  backLabel?: string;
}

export const CommunityGuidelinesScreen: React.FC<CommunityGuidelinesScreenProps> = ({
  onBack,
  backLabel = 'Back to Settings',
}) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const paragraphs = COMMUNITY_GUIDELINES_TEXT.split(/\n\n+/);

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="security" title="Community Guidelines" onBack={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 96 }}>
        <SettingsSection>
          <View style={s.textBlock}>
            {paragraphs.map((p, i) => (
              <Text key={i} style={s.paragraph}>{p}</Text>
            ))}
          </View>
        </SettingsSection>

        <ThemedButton variant="secondary" label={backLabel} onPress={onBack} style={s.backButton} />
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
    textBlock: {
      padding: 16,
    },
    paragraph: {
      fontSize: 14,
      lineHeight: 21,
      color: t.text,
      marginBottom: 12,
    },
    backButton: {
      marginTop: 4,
      alignSelf: 'flex-start',
    },
  });
}
