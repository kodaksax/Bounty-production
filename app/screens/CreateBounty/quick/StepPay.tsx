import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { validateAmount, validateBalance } from '../../../../lib/utils/bounty-validation';
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
   * Retained for the shared insufficient-balance → top-up gate owned by
   * CreateBountyFlow (see app/screens/CreateBounty/index.tsx). This step no
   * longer calls it: under pay-at-accept, choosing an amount you cannot yet
   * cover is valid, because posting debits nothing. The gate now belongs
   * solely to the paths that really do charge — publish time for at_post/v2
   * bounties, and acceptance for pay-at-accept ones.
   */
  onInsufficientBalance?: (amount: number) => void;
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
 * Keeps the same validateAmount gate and the same post_switched_to_honor /
 * amount_set / payment_attached funnel events.
 *
 * There is deliberately NO balance gate on this step. Under pay-at-accept the
 * poster's wallet is untouched until they accept an applicant, so blocking (or
 * diverting to top-up) on a balance that only matters later would recreate the
 * activation barrier the funding change exists to remove. A shortfall is shown
 * as an informational note instead.
 */
export function StepPay({
  draft,
  onUpdate,
  onNext,
  onBack,
  step,
  totalSteps,
  ctaLabel = 'Continue',
  isSubmitting = false,
}: StepPayProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { balance } = useWallet();
  const [error, setError] = useState<string | null>(null);

  // Mirror of the amount/honor the poster has committed on this screen, updated
  // synchronously by every change handler. The CTA press reads this instead of
  // the `draft` prop, so a tap in the same frame as the last keystroke still
  // sees the typed amount rather than a value the parent has not propagated
  // back yet — the race that made the first Post Bounty tap do nothing.
  const committedRef = useRef({ amount: draft.amount, isForHonor: draft.isForHonor });

  // Keep the mirror current when the draft changes from outside these handlers
  // (an async draft load on mount, or a back-and-forward remount).
  useEffect(() => {
    committedRef.current = { amount: draft.amount, isForHonor: draft.isForHonor };
  }, [draft.amount, draft.isForHonor]);

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
    const nextAmount = next ? 0 : draft.amount;
    committedRef.current = { amount: nextAmount, isForHonor: next };
    onUpdate({ isForHonor: next, amount: nextAmount });
  };

  const handlePreset = (preset: number) => {
    setError(null);
    // Balance is irrelevant when choosing an amount: under pay-at-accept,
    // posting is publishing an offer and debits nothing. The poster is asked
    // for money only if and when they accept an applicant. Routing to the
    // top-up gate here would reintroduce, at the amount step, exactly the
    // activation block that deferring the charge exists to remove.
    committedRef.current = { amount: preset, isForHonor: false };
    onUpdate({ amount: preset, isForHonor: false });
  };

  const handleCustomAmount = (value: string) => {
    const digits = value.replace(/[^0-9]/g, '');
    const amount = digits ? parseInt(digits, 10) : 0;
    setError(null);
    committedRef.current = { amount, isForHonor: false };
    onUpdate({ amount, isForHonor: false });
  };

  const handleContinue = () => {
    // Read the committed value, not the `draft` prop: the prop can be one tick
    // behind the last keystroke, and the CTA is intentionally never disabled,
    // so this handler must see the amount the poster actually typed.
    const { amount, isForHonor } = committedRef.current;

    const amountError = validateAmount(amount, isForHonor);
    if (amountError) {
      setError(amountError);
      return;
    }

    const amountCovered = !isForHonor && amount > 0 && balance >= amount;

    // No balance gate here. Posting never debits the wallet, so an amount the
    // poster cannot currently cover is a perfectly valid offer to publish —
    // they have until someone applies and they choose to accept to fund it.
    // The publish path still holds the real gate for the cases that DO charge
    // at insert (kill switch off, or v2 Stripe-native funding), and the
    // acceptance path holds it for pay-at-accept bounties.

    analyticsService.trackEvent('amount_set', {
      surface: 'create_flow',
      amount: isForHonor ? 0 : amount,
      isForHonor,
      method: !isForHonor && amount > 0 && !AMOUNT_PRESETS.includes(amount) ? 'custom' : 'preset',
      category: draft.category || 'none',
      balance,
      balanceCovered: amountCovered,
    });

    if (amountCovered) {
      analyticsService.trackEvent('payment_attached', {
        surface: 'create_flow',
        amount,
        source: 'existing_balance',
        architecture: 1,
      });
    }

    onNext();
  };

  const showBalanceWarning =
    !draft.isForHonor && draft.amount > 0 && !validateBalance(draft.amount, balance, false);

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title="How much will you pay?"
      ctaLabel={isSubmitting ? 'Posting…' : ctaLabel}
      // The CTA stays pressable below $1 on purpose: disabling it swallows a tap
      // that lands in the same frame as the first digit. handleContinue shows
      // the amount validation error instead. `ctaBusy` still blocks a second
      // tap while a publish is in flight.
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
        // Informational, not a blocker. Posting is free; the charge lands when
        // the poster accepts someone, so the honest message is "you'll need
        // this later", not "add funds or lower the amount".
        <Text style={styles.warning}>
          {`Posting is free — you'll be charged $${draft.amount} only when you accept someone. ` +
            `Your balance is $${balance.toFixed(2)}, so you'll need to add funds before then.`}
        </Text>
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
