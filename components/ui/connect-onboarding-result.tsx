/**
 * Full-screen outcome state for the Stripe Connect "Set up payouts" flow
 * (app/wallet/connect/embedded-onboarding.tsx), shown once onboarding
 * status has been reconciled with Stripe. Replaces the previous behavior
 * of silently calling router.back() the instant the "Finalizing…" spinner
 * finished, which gave the user no indication of whether payouts were
 * actually enabled. Modeled on the WithdrawalResultScreen layout
 * (icon circle + title + message + actions) for visual consistency.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Animated, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

export type ConnectOnboardingOutcome =
  | 'success'
  | 'pending'
  | 'action_required'
  | 'cancelled'
  | 'verify_error';

// Common Stripe `requirements.currently_due` codes, humanized. Anything not
// listed here falls back to a generic dot/underscore -> Title Case pass.
const STRIPE_REQUIREMENT_LABELS: Record<string, string> = {
  'external_account': 'A linked bank account or debit card',
  'individual.verification.document': 'A government-issued ID',
  'individual.verification.additional_document': 'An additional identity document',
  'individual.id_number': 'Your Social Security number (or last 4 digits)',
  'individual.dob.day': 'Your date of birth',
  'individual.dob.month': 'Your date of birth',
  'individual.dob.year': 'Your date of birth',
  'individual.address.line1': 'Your home address',
  'individual.phone': 'Your phone number',
  'individual.email': 'Your email address',
  'individual.first_name': 'Your legal first name',
  'individual.last_name': 'Your legal last name',
  'business_profile.url': 'A business website or description',
  'business_profile.mcc': 'A business category',
  'tos_acceptance.date': 'Acceptance of Stripe’s terms of service',
};

function humanizeRequirement(code: string): string {
  if (STRIPE_REQUIREMENT_LABELS[code]) return STRIPE_REQUIREMENT_LABELS[code];
  const last = code.split('.').pop() ?? code;
  const spaced = last.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanizeDisabledReason(reason: string | null): string | null {
  if (!reason) return null;
  if (reason.includes('rejected')) {
    return 'Stripe was unable to verify your information and could not approve this account.';
  }
  if (reason.includes('pending_verification')) {
    return 'Stripe needs a bit more information to finish verifying your identity.';
  }
  return 'Stripe needs additional information before payouts can be enabled.';
}

export interface ConnectOnboardingResultProps {
  outcome: ConnectOnboardingOutcome;
  currentlyDue?: string[];
  disabledReason?: string | null;
  /** success / pending / verify_error (secondary) */
  onDone: () => void;
  /** success only, optional secondary action */
  onGoToWallet?: () => void;
  /** action_required: relaunch the hosted onboarding flow */
  onContinueVerification?: () => void;
  /** cancelled: relaunch the hosted onboarding flow */
  onContinueSetup?: () => void;
  /** cancelled: dismiss without finishing */
  onMaybeLater?: () => void;
  /** verify_error: re-run just the status check */
  onRetryVerify?: () => void;
}

const ICONS: Record<ConnectOnboardingOutcome, keyof typeof MaterialIcons.glyphMap> = {
  success: 'check-circle',
  pending: 'hourglass-top',
  action_required: 'error-outline',
  cancelled: 'pause-circle-outline',
  verify_error: 'wifi-off',
};

const ICON_COLORS: Record<ConnectOnboardingOutcome, string> = {
  success: '#22c55e',
  pending: '#f59e0b',
  action_required: '#f59e0b',
  cancelled: '#9CA3AF',
  verify_error: '#ef4444',
};

export function ConnectOnboardingResult({
  outcome,
  currentlyDue = [],
  disabledReason = null,
  onDone,
  onGoToWallet,
  onContinueVerification,
  onContinueSetup,
  onMaybeLater,
  onRetryVerify,
}: ConnectOnboardingResultProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const { createSpring, createTiming, prefersReducedMotion } = useAccessibleAnimation();
  // Initial value only — intentionally computed once so the Animated.Value
  // instances stay stable across re-renders (createSpring/createTiming
  // still consult the live prefersReducedMotion when starting the animation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const scale = useMemo(() => new Animated.Value(prefersReducedMotion ? 1 : 0.6), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opacity = useMemo(() => new Animated.Value(prefersReducedMotion ? 1 : 0), []);

  useEffect(() => {
    Animated.parallel([createTiming(opacity, 1, 220), createSpring(scale, 1)]).start();
    if (outcome === 'success') hapticFeedback.success();
    else if (outcome === 'verify_error') hapticFeedback.error();
    // Only animate in on mount / outcome change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcome]);

  const title =
    outcome === 'success'
      ? 'Payouts are ready!'
      : outcome === 'pending'
        ? "We're reviewing your information."
        : outcome === 'action_required'
          ? 'Additional verification is needed'
          : outcome === 'cancelled'
            ? "Payout setup wasn't completed."
            : "We couldn't confirm your payout status.";

  const message =
    outcome === 'success'
      ? 'Your identity has been verified and your payout account is now active. You can now withdraw earnings whenever your balance becomes available.'
      : outcome === 'pending'
        ? "This usually completes within a few minutes but may take longer. Withdrawals will automatically become available once verification finishes."
        : outcome === 'action_required'
          ? (humanizeDisabledReason(disabledReason) ??
            'Stripe needs a bit more information before payouts can be enabled for your account.')
          : outcome === 'cancelled'
            ? 'You can finish verification anytime from Wallet or Settings.'
            : 'Check your connection and try again. Your Stripe account status has not changed.';

  const humanRequirements = useMemo(
    () => Array.from(new Set(currentlyDue.map(humanizeRequirement))),
    [currentlyDue]
  );

  return (
    <ScrollView
      contentContainerStyle={s.container}
      showsVerticalScrollIndicator={false}
      accessibilityLiveRegion="polite"
    >
      <View style={s.centered}>
        <Animated.View
          style={[
            s.iconCircle,
            { backgroundColor: `${ICON_COLORS[outcome]}26`, opacity, transform: [{ scale }] },
          ]}
        >
          <MaterialIcons name={ICONS[outcome]} size={44} color={ICON_COLORS[outcome]} />
        </Animated.View>

        <Text style={s.title}>{title}</Text>
        <Text style={s.message}>{message}</Text>

        {outcome === 'action_required' && humanRequirements.length > 0 && (
          <View style={s.requirementsBox}>
            <Text style={s.requirementsHeading}>Still needed:</Text>
            {humanRequirements.map(item => (
              <View key={item} style={s.requirementRow}>
                <View style={s.requirementDot} />
                <Text style={s.requirementText}>{item}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={s.actions}>
        {outcome === 'success' && (
          <>
            <TouchableOpacity style={s.primaryButton} onPress={onDone} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={s.primaryButtonText}>Done</Text>
            </TouchableOpacity>
            {onGoToWallet && (
              <TouchableOpacity style={s.secondaryButton} onPress={onGoToWallet} accessibilityRole="button" accessibilityLabel="Go to Wallet">
                <Text style={s.secondaryButtonText}>Go to Wallet</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {outcome === 'pending' && (
          <TouchableOpacity style={s.primaryButton} onPress={onDone} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={s.primaryButtonText}>Done</Text>
          </TouchableOpacity>
        )}

        {outcome === 'action_required' && (
          <>
            <TouchableOpacity
              style={s.primaryButton}
              onPress={onContinueVerification}
              accessibilityRole="button"
              accessibilityLabel="Continue verification"
            >
              <Text style={s.primaryButtonText}>Continue Verification</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryButton} onPress={onDone} accessibilityRole="button" accessibilityLabel="Do this later">
              <Text style={s.secondaryButtonText}>Later</Text>
            </TouchableOpacity>
          </>
        )}

        {outcome === 'cancelled' && (
          <>
            <TouchableOpacity
              style={s.primaryButton}
              onPress={onContinueSetup}
              accessibilityRole="button"
              accessibilityLabel="Continue setup"
            >
              <Text style={s.primaryButtonText}>Continue Setup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryButton} onPress={onMaybeLater} accessibilityRole="button" accessibilityLabel="Maybe later">
              <Text style={s.secondaryButtonText}>Maybe Later</Text>
            </TouchableOpacity>
          </>
        )}

        {outcome === 'verify_error' && (
          <>
            <TouchableOpacity style={s.primaryButton} onPress={onRetryVerify} accessibilityRole="button" accessibilityLabel="Retry">
              <MaterialIcons name="refresh" size={18} color="#ffffff" style={s.retryIcon} />
              <Text style={s.primaryButtonText}>Retry</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryButton} onPress={onDone} accessibilityRole="button" accessibilityLabel="Done">
              <Text style={s.secondaryButtonText}>Done</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: {
      flexGrow: 1,
      paddingHorizontal: 24,
      paddingTop: 8,
      paddingBottom: 24,
      justifyContent: 'space-between',
    },
    centered: { alignItems: 'center', paddingTop: 24 },
    iconCircle: {
      width: 88,
      height: 88,
      borderRadius: 44,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 20,
    },
    title: { fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center' },
    message: {
      marginTop: 10,
      fontSize: 14,
      lineHeight: 20,
      color: t.textSecondary,
      textAlign: 'center',
      maxWidth: 340,
    },
    requirementsBox: {
      width: '100%',
      backgroundColor: t.surface,
      borderRadius: 14,
      padding: 16,
      marginTop: 20,
    },
    requirementsHeading: { fontSize: 13, fontWeight: '700', color: t.text, marginBottom: 8 },
    requirementRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, gap: 10 },
    requirementDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: t.textSecondary },
    requirementText: { fontSize: 13, color: t.textSecondary, flexShrink: 1 },
    actions: { marginTop: 24, paddingBottom: 8 },
    primaryButton: {
      flexDirection: 'row',
      backgroundColor: t.primary,
      borderRadius: 12,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 10,
    },
    retryIcon: { marginRight: 6 },
    primaryButtonText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
    secondaryButton: { paddingVertical: 12, alignItems: 'center' },
    secondaryButtonText: { fontSize: 15, fontWeight: '600', color: t.textSecondary },
  });
}
