import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
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
  /**
   * The amount the poster just committed to (preset tap, or Continue with a
   * custom amount) exceeds their wallet balance. CreateBountyFlow handles
   * this by showing the shared insufficient-balance → top-up gate and
   * returning here once resolved — see app/screens/CreateBounty/index.tsx.
   */
  onInsufficientBalance: (amount: number) => void;
  /**
   * Label for the bottom CTA. Defaults to 'Continue'. The two-step flow makes
   * this the final step and passes 'Post Bounty', since `onNext` publishes
   * rather than advancing.
   */
  ctaLabel?: string;
  /** Publish in flight — shows the CTA spinner and blocks a second tap. */
  isSubmitting?: boolean;
}

const AMOUNT_PRESETS = [20, 40, 60, 100, 150];

/**
 * Step 5 — compensation, including the for-honor option.
 *
 * Keeps the previous compensation step's business logic verbatim: the same
 * validateAmount gate and the same post_switched_to_honor / amount_set /
 * payment_attached funnel events. The balance guard no longer blocks with a
 * raw Alert — insufficient balance routes to the shared top-up flow instead
 * (see onInsufficientBalance), so a poster who can't afford their chosen
 * amount is never left at a dead end.
 */
export function StepPay({
  draft,
  onUpdate,
  onNext,
  onBack,
  step,
  totalSteps,
  onInsufficientBalance,
  ctaLabel = 'Continue',
  isSubmitting = false,
}: StepPayProps) {
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
    setError(null);
    // Select the amount regardless of balance — the poster's next step when
    // they can't yet afford it is the top-up gate below, not a block on the
    // tap itself (see onInsufficientBalance).
    onUpdate({ amount: preset, isForHonor: false });

    if (!validateBalance(preset, balance, false)) {
      analyticsService.trackEvent('post_amount_blocked_by_balance', {
        surface: 'create_flow',
        attemptedAmount: preset,
        balance,
        shortfall: Number((preset - balance).toFixed(2)),
        method: 'preset',
      });
      onInsufficientBalance(preset);
    }
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

    const amountCovered = !draft.isForHonor && draft.amount > 0 && balance >= draft.amount;

    // A custom-typed amount over balance never blocked here before — it just
    // showed a passive warning and let the poster proceed to Review with an
    // unfundable draft, deferring the reckoning to publish time. Route to the
    // same top-up gate the preset tap uses instead, so this step behaves
    // consistently no matter how the amount was chosen.
    if (!draft.isForHonor && draft.amount > 0 && !amountCovered) {
      analyticsService.trackEvent('post_amount_blocked_by_balance', {
        surface: 'create_flow',
        attemptedAmount: draft.amount,
        balance,
        shortfall: Number((draft.amount - balance).toFixed(2)),
        method: 'continue',
      });
      onInsufficientBalance(draft.amount);
      return;
    }

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
      ctaLabel={isSubmitting ? 'Posting…' : ctaLabel}
      ctaDisabled={!isValid}
      ctaBusy={isSubmitting}
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
          size={18}
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
          {draft.isForHonor ? <MaterialIcons name="check" size={15} color={theme.primary} /> : null}
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
      marginBottom: 18,
    },
    currency: { fontSize: 26, fontWeight: '700', marginRight: 3 },
    amount: {
      fontSize: 54,
      fontWeight: '800',
      letterSpacing: -1.5,
      minWidth: 96,
      padding: 0,
      textAlign: 'center',
    },
    presetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
    },
    preset: {
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 18,
      borderWidth: 2,
    },
    presetLabel: { fontSize: 16, fontWeight: '700' },
    infoCard: {
      marginTop: 16,
      flexDirection: 'row',
      padding: 12,
      borderRadius: 14,
      backgroundColor: theme.isDark ? 'rgba(5,150,105,0.18)' : 'rgba(5,150,105,0.10)',
    },
    infoIcon: { marginRight: 10, marginTop: 1 },
    infoTextWrap: { flex: 1 },
    infoTitle: { fontSize: 14, fontWeight: '700', color: theme.text },
    infoBody: { marginTop: 3, fontSize: 13, lineHeight: 17, color: theme.textSecondary },
    honorRow: { marginTop: 14, flexDirection: 'row', alignItems: 'center' },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 6,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    honorLabel: { marginLeft: 10, fontSize: 15, fontWeight: '600' },
    warning: { marginTop: 10, fontSize: 13, color: theme.warning },
    error: { marginTop: 8, fontSize: 13, color: theme.error },
  });
}
