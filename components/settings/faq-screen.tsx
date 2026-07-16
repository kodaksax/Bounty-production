import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { ThemedButton } from 'components/themed/ThemedButton';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PLATFORM_FEE_PERCENTAGE } from 'lib/wallet-context';

interface FAQScreenProps { onBack: () => void }

// Derive the fee display from the source-of-truth constant used at completion
// time so the FAQ copy can never drift from the actual deduction.
const PLATFORM_FEE_DISPLAY = `${(PLATFORM_FEE_PERCENTAGE * 100).toFixed(
  Number.isInteger(PLATFORM_FEE_PERCENTAGE * 100) ? 0 : 1
)}%`;

const FAQS = [
  { q: 'How does escrow work?', a: 'Funds are reserved when a bounty is accepted and released on completion.' },
  { q: 'Can I cancel a bounty?', a: 'Open bounties may be archived. Funded disputes will have a formal flow later.' },
  { q: 'What fees apply?', a: `A ${PLATFORM_FEE_DISPLAY} platform service fee is deducted from the bounty amount when funds are released to the hunter on completion. Standard Stripe processing fees (typically 2.9% + $0.30 on card transactions) may also apply when funding your wallet. The exact totals are shown before you confirm.` },
  { q: 'How do I report abuse?', a: 'Use Contact Support with detailed information. Our moderation team reviews all reports promptly.' },
];

export const FAQScreen: React.FC<FAQScreenProps> = ({ onBack }) => {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="help-outline" title="FAQ" onBack={onBack} />
      <ScrollView className="px-4" contentContainerStyle={{ paddingBottom: 64, paddingTop: 16 }}>
        <SettingsSection>
          {FAQS.map((f, i) => (
            <View key={i} style={s.faqItem}>
              <Text style={s.question}>{f.q}</Text>
              <Text style={s.answer}>{f.a}</Text>
            </View>
          ))}
        </SettingsSection>

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
    faqItem: {
      padding: 16,
    },
    question: {
      fontSize: 15,
      fontWeight: '600',
      color: t.text,
      marginBottom: 4,
    },
    answer: {
      fontSize: 13,
      lineHeight: 19,
      color: t.textSecondary,
    },
    backButton: {
      alignSelf: 'flex-start',
    },
  });
}
