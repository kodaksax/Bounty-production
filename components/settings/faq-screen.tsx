import { SettingsScreenHeader } from 'components/ui/settings-screen-header';
import { SettingsSection } from 'components/ui/settings-section';
import { ThemedButton } from 'components/themed/ThemedButton';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { PLATFORM_FEE_DISPLAY } from 'lib/constants/fees';
import { trustSafetyStrings } from 'lib/strings/trust-safety';

interface FAQScreenProps { onBack: () => void }

// PLATFORM_FEE_DISPLAY is derived from lib/constants/fees.ts, which mirrors
// the server's PLATFORM_FEE_PERCENT, so this copy cannot drift from the
// deduction that actually happens. (It previously derived from a client-only
// constant that had drifted to twice the real rate.)
const FAQS = [
  {
    q: 'What is a bounty?',
    a: 'A bounty is a small job someone needs done. The person who needs it is the poster; the person who does it is the hunter. You can be either, on different bounties, with the same account.',
  },
  {
    q: 'How does escrow work?',
    a: 'Funding happens at posting or acceptance, as shown in the app. Funds handled through Bounty may be authorized or captured through Stripe and held for the job. An open listing is not proof of funding. Release depends on in-app completion and any dispute review.',
  },
  {
    q: 'Can I pay or get paid outside Bounty?',
    a: trustSafetyStrings.paymentProtection,
  },
  {
    q: 'What fees apply?',
    a: `A ${PLATFORM_FEE_DISPLAY} service fee is deducted from the bounty amount when funds are released to the hunter on completion — so on a $100 bounty the poster pays $100 and the hunter takes home the amount shown on the bounty before they apply. Standard Stripe processing fees (typically 2.9% + $0.30 on card transactions) may also apply when adding money to your wallet. Exact totals are shown before you confirm.`,
  },
  {
    q: 'When do I get paid for work I finished?',
    a: 'Use Bounty’s completion and payment flow. Release and availability depend on processing, fraud checks, and any dispute review. Check Wallet for payment status and available funds. Cash-out requires Stripe payout setup; timing depends on Stripe and the receiving bank.',
  },
  {
    q: 'What if the poster never approves my work?',
    a: 'Message them first from the bounty — most cases are a misunderstanding. If that goes nowhere, open a dispute from the bounty and Bounty reviews it and decides how the escrowed money is handled. The money stays held while a dispute is open; it does not go back to the poster automatically.',
  },
  {
    q: 'Can I cancel a bounty?',
    a: `You can request cancellation in the app. Once a hunter is working, cancellation sends them a request rather than cancelling unilaterally. ${trustSafetyStrings.escrowLimits}`,
  },
  {
    q: 'How do I report abuse?',
    a: 'Report the bounty or the person from their profile, or use Contact Support with details. Our moderation team reviews all reports. You can also block someone, which stops them messaging you.',
  },
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
