import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SettingsScreenHeader } from '../../components/ui/settings-screen-header';
import { PLATFORM_FEE_DISPLAY } from '../../lib/constants/fees';
import { EMAIL_SUBJECTS, SUPPORT_EMAIL } from '../../lib/constants/support';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

/**
 * Public, pre-auth trust page: fees, escrow custody, identity verification,
 * cancellation and disputes in plain language. Reachable at
 * `/legal/how-it-works` without an account — linked from the onboarding
 * welcome screen, the poster task/price step, and the create-flow pay step.
 *
 * Every claim here mirrors the Terms of Service (assets/legal/terms.ts,
 * rendered at /legal/terms) — §7 Refunds, §21 Dispute Resolution, §30
 * Payments & Escrow. This screen only restates them in non-legalese and
 * points back to the binding text.
 */

type Section = {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  body: string;
  /** Which Terms section backs this, shown as a pointer. */
  terms: string;
};

const SECTIONS: Section[] = [
  {
    icon: 'sell',
    title: 'No fee to post',
    // Deliberately does not promise "not charged when you post": pay-at-accept
    // only applies to some first bounties (lib/experiments/deferred-funding-variant.ts
    // plus server eligibility); everyone else funds at posting. Shoal 2026-09-19
    // posters read the old wording and then hit the funding step.
    body:
      `There is no charge for posting beyond the reward itself. You pay the amount you named either when you post or, for some first bounties, when you accept a hunter — the app tells you which before any money moves. A ${PLATFORM_FEE_DISPLAY} service fee is deducted from that amount when it is released, so the hunter takes home the rest — both of you see the exact numbers before you commit.`,
    terms: 'Terms §30 (Payments & Escrow)',
  },
  {
    icon: 'lock',
    title: 'Your money is held in escrow',
    body:
      'When you fund a bounty, the money is authorized or captured and held in escrow through Stripe / Stripe Connect. It is not paid to the hunter while the job is in progress. Funds are released to the hunter only when you confirm the work is done in the app. Bounty may delay a release to run fraud checks or resolve a dispute.',
    terms: 'Terms §30 (Payments & Escrow)',
  },
  {
    // Not a shield icon and not "verify their identity" on its own: 5 Shoal
    // agents (2026-09-19) read that as hunter screening, and the ones who
    // worked out it was only payout KYC trusted the page less for it.
    icon: 'badge',
    title: 'Hunters verify with Stripe to get paid',
    body:
      'Before a hunter can be paid, Stripe checks their identity and banking details — the check any payout account requires. It confirms who receives the money. It is not a background check and does not vouch for a hunter’s skills or conduct; their profile and ratings are the place to judge that. Payout timing and limits are set by Stripe and the receiving bank.',
    terms: 'Terms §30 (Stripe Connect and Payouts)',
  },
  {
    icon: 'undo',
    title: 'Cancelling a bounty',
    body:
      'You can request to cancel a bounty before a hunter starts work. Whether the held funds are returned depends on the state of the bounty and the outcome of our dispute review.',
    terms: 'Terms §7 (Refunds) and §30 (Cancellation & Refunds)',
  },
  {
    icon: 'payments',
    title: 'Getting paid as a hunter',
    body:
      `When you apply, nothing is owed to you yet. Once the poster accepts you, their money is already held in escrow — it is committed before you start work. You submit the finished work in the app, the poster approves it, and the bounty amount less the ${PLATFORM_FEE_DISPLAY} service fee lands in your Bounty wallet. Every bounty shows you what you take home before you apply.`,
    terms: 'Terms §30 (Payments & Escrow)',
  },
  {
    icon: 'account-balance',
    title: 'Cashing out',
    body:
      'Money in your Bounty wallet is yours. Cash out to a linked bank account or debit card from the Wallet tab. Before your first cash-out you verify your identity with Stripe, which is what lets money be sent to you at all. Payout timing and limits are set by Stripe and the receiving bank.',
    terms: 'Terms §30 (Stripe Connect and Payouts)',
  },
  {
    icon: 'gavel',
    title: 'If something goes wrong',
    body:
      'If the work is not done right, you can open a dispute in the app. Bounty reviews the dispute and decides how the money held in escrow is handled. Disputes that are not resolved this way are settled by binding individual arbitration; you can opt out of arbitration within 30 days of accepting the Terms.',
    terms: 'Terms §21 (Dispute Resolution)',
  },
];

export default function HowItWorksRoute() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);

  return (
    <View style={s.container}>
      <SettingsScreenHeader icon="shield" title="How Bounty works" onBack={() => router.back()} />
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.intro}>
          Bounty is a way to pay someone nearby to do a small job — or to get paid for doing one.
          Here is exactly what happens to the money, and what protects you on either side.
        </Text>

        {SECTIONS.map(section => (
          <View key={section.title} style={s.card}>
            <View style={s.cardHead}>
              <MaterialIcons name={section.icon} size={20} color={theme.primary} style={s.cardIcon} />
              <Text style={s.cardTitle}>{section.title}</Text>
            </View>
            <Text style={s.cardBody}>{section.body}</Text>
            <Text style={s.cardTerms}>{section.terms}</Text>
          </View>
        ))}

        <TouchableOpacity
          style={s.termsButton}
          onPress={() => router.push('/legal/terms')}
          accessibilityRole="button"
          accessibilityLabel="Read the full Terms of Service"
        >
          <Text style={s.termsButtonText}>Read the full Terms of Service</Text>
          <MaterialIcons name="arrow-forward" size={18} color={theme.primary} />
        </TouchableOpacity>

        {/* This page is the only info surface reachable from the pre-auth
            welcome screen, so privacy, guidelines and a contact route live
            here too (Shoal trust-audit 2026-09-19: 4 of 5 found none of them
            before signing up). */}
        <View style={s.links}>
          <TouchableOpacity
            style={s.linkRow}
            onPress={() => router.push('/legal/privacy')}
            accessibilityRole="link"
          >
            <MaterialIcons name="privacy-tip" size={18} color={theme.textSecondary} />
            <Text style={s.linkText}>Privacy Policy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkRow}
            onPress={() => router.push('/legal/community-guidelines')}
            accessibilityRole="link"
          >
            <MaterialIcons name="groups" size={18} color={theme.textSecondary} />
            <Text style={s.linkText}>Community Guidelines</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.linkRow}
            onPress={() =>
              Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(EMAIL_SUBJECTS.general)}`)
            }
            accessibilityRole="link"
            accessibilityLabel={`Contact support at ${SUPPORT_EMAIL}`}
          >
            <MaterialIcons name="mail-outline" size={18} color={theme.textSecondary} />
            <Text style={s.linkText}>Questions? {SUPPORT_EMAIL}</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.disclaimer}>
          This page is a plain-language summary. The Terms of Service are the binding agreement.
        </Text>
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
    intro: {
      fontSize: 15,
      lineHeight: 22,
      color: t.text,
      marginBottom: 20,
    },
    card: {
      backgroundColor: t.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      padding: 14,
      marginBottom: 12,
    },
    cardHead: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 8,
    },
    cardIcon: {
      marginRight: 8,
    },
    cardTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: t.text,
      flexShrink: 1,
    },
    cardBody: {
      fontSize: 14,
      lineHeight: 20,
      color: t.textSecondary,
    },
    cardTerms: {
      marginTop: 8,
      fontSize: 12,
      fontWeight: '600',
      color: t.textDisabled,
    },
    termsButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      marginTop: 8,
      paddingVertical: 14,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: t.border,
    },
    termsButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: t.primary,
    },
    links: {
      marginTop: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surface,
    },
    linkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 13,
      paddingHorizontal: 14,
    },
    linkText: {
      fontSize: 14,
      fontWeight: '600',
      color: t.text,
      flexShrink: 1,
    },
    disclaimer: {
      marginTop: 16,
      fontSize: 12,
      lineHeight: 17,
      color: t.textDisabled,
      textAlign: 'center',
    },
  });
}
