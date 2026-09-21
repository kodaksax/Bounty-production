import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { type Href, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { usePostingPolicy } from '../../../../hooks/usePostingPolicy';
import { analyticsService } from '../../../../lib/services/analytics-service';
import { PLATFORM_FEE_DISPLAY, calculateHunterEarnings } from '../../../../lib/constants/fees';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { detectTrustTier } from '../../../../lib/utils/trust-tier';
import { validateAmount, validateBalance, validateContactInfo } from '../../../../lib/utils/bounty-validation';
import { useWallet } from '../../../../lib/wallet-context';
import { QuickStepLayout } from './QuickStepLayout';

interface StepPayProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: (payment: Pick<BountyDraft, 'amount' | 'isForHonor'>) => void;
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

// Temporarily hides the "Posting is free" balance note under the amount field.
const SHOW_BALANCE_WARNING = false;

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
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const { balance } = useWallet();
  const { honorPostsEnabled, minimumAmount } = usePostingPolicy();
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

  // A draft saved while the honor option was still available would otherwise
  // sit here as an un-toggleable $0 the poster cannot see or clear, and would
  // then be refused by the server at publish with no obvious cause. Clear it
  // as soon as we learn the option is off.
  useEffect(() => {
    if (!honorPostsEnabled && draft.isForHonor) {
      committedRef.current = { amount: 0, isForHonor: false };
      onUpdate({ isForHonor: false, amount: 0 });
    }
  }, [honorPostsEnabled, draft.isForHonor, onUpdate]);

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

    const amountError = validateAmount(amount, isForHonor, minimumAmount);
    if (amountError) {
      setError(amountError);
      return;
    }

    // Same gate as the amount floor, same red line under the CTA: a title or
    // description carrying a phone number, email, or link never publishes.
    // Both fields are scanned because this is the last stop before the
    // bounty exists — the description is usually empty here (it's added
    // post-publish, see StepPhotos), but a restored draft can carry one.
    const contactError = validateContactInfo(draft.title, draft.description);
    if (contactError) {
      setError(contactError);
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

    onNext({ amount, isForHonor });
  };

  // Hidden for now: the "Posting is free — you'll be charged … when you
  // accept someone" note. Flip SHOW_BALANCE_WARNING to bring it back; the
  // balance check itself is kept so nothing else has to change.
  const showBalanceWarning =
    SHOW_BALANCE_WARNING &&
    !draft.isForHonor && draft.amount > 0 && !validateBalance(draft.amount, balance, false);

  // Bounty-level trust requirement system (lib/utils/trust-tier.ts). Detection
  // is a recommendation, never a forced category: most bounties (errands,
  // delivery, general labor, standard writing) match no tier and this card
  // never renders. Title is the only reliable signal at this step — the
  // two-step flow publishes after Task + Compensation and defers the
  // description entirely to post-publish enrichment (see
  // app/screens/CreateBounty/index.tsx), so draft.description is normally
  // empty here; detection still runs against it in case a draft carries one.
  const detection = useMemo(
    () => detectTrustTier(draft.title, draft.description),
    [draft.title, draft.description]
  );
  const detectionKey = `${draft.title}||${draft.description}`;
  const dismissedForTextRef = useRef<string | null>(null);

  useEffect(() => {
    if (!detection.recommendIdVerified) return;
    // Already reflects this tier (whether auto-applied or the poster's own
    // prior choice) -- don't stomp a manual toggle within the same tier.
    if (draft.trustTier === detection.tier) return;
    // Explicitly dismissed for this exact text -- stays dismissed until the
    // poster changes the title/description (which changes detectionKey).
    if (dismissedForTextRef.current === detectionKey) return;
    onUpdate({ trustTier: detection.tier, requiresIdVerified: detection.defaultIdVerified });
    // onUpdate is stable from the parent's useCallback; including it would
    // re-run this on every parent render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detection.tier, detection.recommendIdVerified, detection.defaultIdVerified, detectionKey, draft.trustTier]);

  const handleDismissTrustTier = () => {
    dismissedForTextRef.current = detectionKey;
    onUpdate({ trustTier: 'standard', requiresIdVerified: false });
  };

  const requiresIdVerified = draft.requiresIdVerified ?? detection.defaultIdVerified;

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
          // "50" alone reads as a filled-in amount next to the $ glyph: a poster
          // typed nothing, pressed the CTA and got "set a price" for a field that
          // looked answered. "e.g." is what makes it unmistakably a hint.
          placeholder="e.g. 50"
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
              : "You're charged when you accept a hunter."}
          </Text>
          <Text style={styles.infoBody}>
            {draft.isForHonor
              ? 'No payment is involved. Someone helps out voluntarily.'
              : `You pay $${draft.amount || 0}. It is held then, and released when you approve the work. Bounty takes a ${PLATFORM_FEE_DISPLAY} service fee out of it, so the hunter takes home $${calculateHunterEarnings(
                  draft.amount
                ).net.toFixed(2)} — and they see that number before they apply.`}
          </Text>
          {draft.isForHonor ? null : (
            <TouchableOpacity
              onPress={() => router.push('/legal/how-it-works' as Href)}
              accessibilityRole="link"
              accessibilityLabel="How payments and escrow work"
            >
              <Text style={styles.infoLink}>How payments &amp; escrow work</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* For honor option.
          Hidden while the server refuses $0 posts (the default). This is the
          mechanism that turned high-intent posters into dead listings: a
          poster who could not fund picked "free" instead, and 49% of all
          bounties ever created are for-honor while no external user has
          funded escrow since 1 Sep. The recovery from "I cannot pay right
          now" is pay-at-accept — which is what the card above already says —
          not "make it free". */}
      {honorPostsEnabled ? (
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
      ) : null}

      {detection.recommendIdVerified ? (
        <View style={styles.trustCard}>
          <View style={styles.trustCardHeader}>
            <MaterialIcons name="shield" size={18} color={theme.text} style={styles.infoIcon} />
            <Text style={styles.trustCardText}>{detection.bannerCopy}</Text>
          </View>
          <View style={styles.trustCardRow}>
            <Text style={styles.trustCardToggleLabel}>Require ID-verified hunters</Text>
            <Switch
              value={requiresIdVerified}
              onValueChange={(value) => onUpdate({ trustTier: detection.tier, requiresIdVerified: value })}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={requiresIdVerified ? theme.primary : theme.textDisabled}
              accessibilityLabel="Require ID-verified hunters"
            />
          </View>
          {draft.trustTier === detection.tier ? (
            <TouchableOpacity onPress={handleDismissTrustTier} accessibilityRole="button">
              <Text style={styles.trustCardDismiss}>Doesn&apos;t apply? Dismiss</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

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
    infoLink: {
      marginTop: 6,
      fontSize: 13,
      fontWeight: '700',
      color: theme.primary,
      textDecorationLine: 'underline',
    },
    trustCard: {
      marginTop: 16,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
    },
    trustCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
    trustCardText: { flex: 1, fontSize: 13, lineHeight: 18, color: theme.text },
    trustCardRow: {
      marginTop: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    trustCardToggleLabel: { fontSize: 13, fontWeight: '600', color: theme.text },
    trustCardDismiss: {
      marginTop: 8,
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
      textDecorationLine: 'underline',
    },
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
