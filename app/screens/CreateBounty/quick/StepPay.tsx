import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import {
  getInsufficientBalanceMessage,
  validateAmount,
  validateBalance,
} from '../../../../lib/utils/bounty-validation';
import { useWallet } from '../../../../lib/wallet-context';
import { QuickStepLayout } from './QuickStepLayout';

interface StepPayProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
  step: number;
  totalSteps: number;
}

const AMOUNT_PRESETS = [20, 40, 60, 100, 150];

/**
 * Step 5 — compensation, including the for-honor option.
 *
 * Keeps the previous compensation step's business logic verbatim: the same
 * balance guard on presets, the same validateAmount gate, and the same
 * post_switched_to_honor / post_amount_blocked_by_balance / amount_set /
 * payment_attached funnel events.
 */
export function StepPay({ draft, onUpdate, onNext, onBack, step, totalSteps }: StepPayProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { balance } = useWallet();
  const [error, setError] = useState<string | null>(null);

  const isCustom = !draft.isForHonor && draft.amount > 0 && !AMOUNT_PRESETS.includes(draft.amount);

  const handleHonorToggle = () => {
    const next = !draft.isForHonor;
    if (next) {
      // Sizes the single biggest known leak in the posting funnel: posters who
      // pick a real amount and then switch to a $0 post.
      analyticsService.trackEvent('post_switched_to_honor', {
        surface: 'create_flow',
        previousAmount: draft.amount,
        hadAmount: draft.amount > 0,
        balance,
        balanceCovered: draft.amount > 0 && balance >= draft.amount,
      });
    }
    setError(null);
    onUpdate({ isForHonor: next, amount: next ? 0 : draft.amount });
  };

  const handlePreset = (preset: number) => {
    if (!validateBalance(preset, balance, false)) {
      // Dead end: the preset is refused and this screen offers no way to add
      // funds. Counting these shows how often the amount step is unusable.
      analyticsService.trackEvent('post_amount_blocked_by_balance', {
        surface: 'create_flow',
        attemptedAmount: preset,
        balance,
        shortfall: Number((preset - balance).toFixed(2)),
        method: 'preset',
      });
      Alert.alert('Insufficient Balance', getInsufficientBalanceMessage(preset, balance), [
        { text: 'OK', style: 'default' },
      ]);
      return;
    }
    setError(null);
    onUpdate({ amount: preset, isForHonor: false });
  };

  const handleCustomAmount = (value: string) => {
    const digits = value.replace(/[^0-9]/g, '');
    setError(null);
    onUpdate({ amount: digits ? parseInt(digits, 10) : 0, isForHonor: false });
  };

  const handleContinue = () => {
    const amountError = validateAmount(draft.amount, draft.isForHonor);
    if (amountError) {
      setError(amountError);
      return;
    }

    // Balance is not blocking here — it is a warning, and final submission
    // enforces it. This lets a poster finish the draft and top up afterwards.
    const amountCovered = !draft.isForHonor && draft.amount > 0 && balance >= draft.amount;

    analyticsService.trackEvent('amount_set', {
      surface: 'create_flow',
      amount: draft.isForHonor ? 0 : draft.amount,
      isForHonor: draft.isForHonor,
      method: isCustom ? 'custom' : 'preset',
      category: draft.category || 'none',
      balance,
      balanceCovered: amountCovered,
    });

    if (amountCovered) {
      analyticsService.trackEvent('payment_attached', {
        surface: 'create_flow',
        amount: draft.amount,
        source: 'existing_balance',
        architecture: 1,
      });
    }

    onNext();
  };

  const showBalanceWarning =
    !draft.isForHonor && draft.amount > 0 && !validateBalance(draft.amount, balance, false);
  const isValid = draft.isForHonor || draft.amount >= 1;

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title="How much will you pay?"
      ctaLabel="Continue"
      ctaDisabled={!isValid}
      onCta={handleContinue}
    >
      {/* Amount display / custom entry */}
      <View style={styles.amountRow}>
        <Text
          style={[
            styles.currency,
            { color: draft.isForHonor || draft.amount <= 0 ? theme.textDisabled : theme.text },
          ]}
        >
          $
        </Text>
        <TextInput
          value={draft.isForHonor ? '0' : draft.amount > 0 ? String(draft.amount) : ''}
          onChangeText={handleCustomAmount}
          editable={!draft.isForHonor}
          placeholder="50"
          placeholderTextColor={theme.textDisabled}
          keyboardType="number-pad"
          style={[
            styles.amount,
            { color: draft.isForHonor || draft.amount <= 0 ? theme.textDisabled : theme.text },
          ]}
          accessibilityLabel="Bounty amount in dollars"
        />
      </View>

      {/* Presets */}
      <View style={styles.presetRow}>
        {AMOUNT_PRESETS.map((preset) => {
          const active = !draft.isForHonor && draft.amount === preset;
          return (
            <TouchableOpacity
              key={preset}
              onPress={() => handlePreset(preset)}
              activeOpacity={0.85}
              style={[
                styles.preset,
                {
                  backgroundColor: active
                    ? theme.isDark
                      ? 'rgba(5,150,105,0.22)'
                      : 'rgba(5,150,105,0.12)'
                    : theme.surfaceSecondary,
                  borderColor: active ? theme.primary : 'transparent',
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Pay $${preset}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.presetLabel, { color: active ? theme.primary : theme.text }]}>
                ${preset}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Reassurance card */}
      <View style={styles.infoCard}>
        <MaterialIcons
          name={draft.isForHonor ? 'volunteer-activism' : 'verified-user'}
          size={22}
          color={theme.primary}
          style={styles.infoIcon}
        />
        <View style={styles.infoTextWrap}>
          <Text style={styles.infoTitle}>
            {draft.isForHonor
              ? 'This is a for-honor bounty.'
              : "You'll only pay when the job is completed."}
          </Text>
          <Text style={styles.infoBody}>
            {draft.isForHonor
              ? 'No payment is involved. Someone helps out voluntarily.'
              : "Flat-rate payment. Hunters know exactly what they'll earn."}
          </Text>
        </View>
      </View>

      {/* For honor option */}
      <TouchableOpacity
        onPress={handleHonorToggle}
        activeOpacity={0.8}
        style={styles.honorRow}
        accessibilityRole="checkbox"
        accessibilityLabel="Post this for honor with no payment"
        accessibilityState={{ checked: draft.isForHonor }}
      >
        <View style={[styles.checkbox, { borderColor: draft.isForHonor ? theme.primary : theme.border }]}>
          {draft.isForHonor ? <MaterialIcons name="check" size={18} color={theme.primary} /> : null}
        </View>
        <Text style={[styles.honorLabel, { color: draft.isForHonor ? theme.primary : theme.text }]}>
          Post for honor — no payment
        </Text>
      </TouchableOpacity>

      {showBalanceWarning ? (
        <Text style={styles.warning}>{getInsufficientBalanceMessage(draft.amount, balance)}</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </QuickStepLayout>
  );
}

export default StepPay;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    amountRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 28,
    },
    currency: { fontSize: 34, fontWeight: '700', marginRight: 4 },
    amount: {
      fontSize: 72,
      fontWeight: '800',
      letterSpacing: -2,
      minWidth: 120,
      padding: 0,
      textAlign: 'center',
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
    },
    preset: {
      paddingHorizontal: 24,
      paddingVertical: 14,
      borderRadius: 24,
      borderWidth: 2,
    },
    presetLabel: { fontSize: 18, fontWeight: '700' },
    infoCard: {
      marginTop: 26,
      flexDirection: 'row',
      padding: 18,
      borderRadius: 20,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.18)' : 'rgba(5,150,105,0.10)',
    },
    infoIcon: { marginRight: 12, marginTop: 2 },
    infoTextWrap: { flex: 1 },
    infoTitle: { fontSize: 16, fontWeight: '700', color: theme.text },
    infoBody: { marginTop: 6, fontSize: 15, lineHeight: 21, color: theme.textSecondary },
    honorRow: { marginTop: 22, flexDirection: 'row', alignItems: 'center' },
    checkbox: {
      width: 26,
      height: 26,
      borderRadius: 8,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    honorLabel: { marginLeft: 14, fontSize: 17, fontWeight: '600' },
    warning: { marginTop: 16, fontSize: 14, color: theme.warning },
    error: { marginTop: 12, fontSize: 14, color: theme.error },
  });
}
