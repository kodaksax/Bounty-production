/**
 * The top of the poster's job page: who acts next, what is happening, the one
 * thing to do, and where the money is. "Get help with this job" sits on every
 * state, so recovery never depends on finding a menu.
 *
 * Senior-first sizes: 17px body, 22px title, a 56px primary button with 19px
 * bold text (large text, so the brand green passes contrast), 48px secondary
 * targets. Nothing is icon-only and nothing relies on colour alone: the
 * who-acts pill always carries words.
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import type { PosterActionKey, PosterNextStep } from '../../lib/utils/poster-plain-copy';

interface Props {
  step: PosterNextStep;
  onAction: (key: PosterActionKey) => void;
  onGetHelp: () => void;
  busyKey?: PosterActionKey | null;
  /** Shown under the money sentence when the payment read failed. */
  showPaymentRetry?: boolean;
}

export function NextStepCard({ step, onAction, onGetHelp, busyKey, showPaymentRetry }: Props) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const pillTone =
    step.whoActs === 'you'
      ? { bg: theme.warningTint, fg: theme.warningText, icon: 'touch-app' as const }
      : step.whoActs === 'done'
        ? { bg: theme.successTint, fg: theme.successText, icon: 'check-circle' as const }
        : step.whoActs === 'bounty'
          ? { bg: theme.infoTint, fg: theme.infoText, icon: 'support-agent' as const }
          : { bg: theme.neutralTint, fg: theme.textSecondary, icon: 'hourglass-empty' as const };

  return (
    <View style={s.card} testID="poster-next-step">
      <View style={[s.pill, { backgroundColor: pillTone.bg }]}>
        <MaterialIcons name={pillTone.icon} size={18} color={pillTone.fg} />
        <Text style={[s.pillText, { color: pillTone.fg }]}>{step.whoActsLabel}</Text>
      </View>

      <Text style={s.title} accessibilityRole="header">
        {step.title}
      </Text>
      <Text style={s.body}>{step.body}</Text>

      {step.money ? (
        <View style={s.moneyRow} testID="poster-money-line" accessibilityLiveRegion="polite">
          <MaterialIcons name="account-balance-wallet" size={20} color={theme.textSecondary} />
          <Text style={s.moneyText}>{step.money}</Text>
        </View>
      ) : null}
      {showPaymentRetry ? (
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => onAction('retry_payment_check')}
          accessibilityRole="button"
          accessibilityLabel="Check payment again"
          testID="bounty-payment-retry"
        >
          <MaterialIcons name="refresh" size={20} color={theme.text} />
          <Text style={s.secondaryBtnText}>Check again</Text>
        </TouchableOpacity>
      ) : null}

      {step.primary ? (
        <TouchableOpacity
          style={[s.primaryBtn, busyKey === step.primary.key && s.busy]}
          onPress={() => onAction(step.primary!.key)}
          disabled={busyKey === step.primary.key}
          accessibilityRole="button"
          accessibilityLabel={step.primary.label}
          accessibilityState={{ busy: busyKey === step.primary.key, disabled: busyKey === step.primary.key }}
          testID="poster-next-step-primary"
        >
          {busyKey === step.primary.key ? (
            <ActivityIndicator color={theme.onPrimary} />
          ) : (
            <Text style={s.primaryBtnText}>{step.primary.label}</Text>
          )}
        </TouchableOpacity>
      ) : null}

      {step.secondary ? (
        <TouchableOpacity
          style={s.secondaryBtn}
          onPress={() => onAction(step.secondary!.key)}
          disabled={busyKey === step.secondary.key}
          accessibilityRole="button"
          accessibilityLabel={step.secondary.label}
          accessibilityState={{ busy: busyKey === step.secondary.key }}
          testID="poster-next-step-secondary"
        >
          {busyKey === step.secondary.key ? <ActivityIndicator color={theme.text} /> : null}
          <Text style={s.secondaryBtnText}>{step.secondary.label}</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={s.helpBtn}
        onPress={onGetHelp}
        accessibilityRole="button"
        accessibilityLabel="Get help with this job"
        accessibilityHint="Shows what you can do if something is wrong, and how to reach a person at Bounty"
        testID="poster-get-help"
      >
        <MaterialIcons name="support-agent" size={22} color={theme.primaryLight} />
        <Text style={s.helpText}>Get help with this job</Text>
        <MaterialIcons name="chevron-right" size={22} color={theme.primaryLight} />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    card: {
      backgroundColor: t.surface,
      borderRadius: 18,
      borderWidth: 1,
      ...t.insetBorder,
      padding: 18,
      marginBottom: 16,
      gap: 12,
    },
    pill: {
      flexDirection: 'row',
      alignSelf: 'flex-start',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 999,
    },
    pillText: { fontSize: 15, fontWeight: '700' },
    title: { color: t.text, fontSize: 22, fontWeight: '800', lineHeight: 28 },
    body: { color: t.text, fontSize: 17, lineHeight: 25 },
    moneyRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      backgroundColor: t.surfaceSecondary,
      borderRadius: 12,
      padding: 12,
    },
    moneyText: { flex: 1, color: t.text, fontSize: 17, lineHeight: 24 },
    primaryBtn: {
      minHeight: 56,
      borderRadius: 14,
      backgroundColor: t.primary,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 16,
      marginTop: 4,
    },
    busy: { opacity: 0.8 },
    primaryBtnText: { color: t.onPrimary, fontSize: 19, fontWeight: '700', textAlign: 'center' },
    secondaryBtn: {
      minHeight: 48,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingHorizontal: 16,
    },
    secondaryBtnText: { color: t.text, fontSize: 17, fontWeight: '600', textAlign: 'center' },
    helpBtn: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: t.borderSubtle,
    },
    helpText: { flex: 1, color: t.primaryLight, fontSize: 17, fontWeight: '700' },
  });
}
