/**
 * Full-screen processing / success / failure state for both withdrawal
 * flows (standard bank transfer and Instant Cash Out). Replaces the
 * Alert.alert-based success/failure copy previously shown inline in
 * withdraw-with-bank-screen.tsx and instant-cash-out-screen.tsx — a native
 * alert can't show a receipt-style breakdown (amount/fee/destination/ETA)
 * or offer a Retry action, which the task's "polished ... success screens,
 * and failure screens" requirement calls for.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { formatCurrency } from '../../lib/utils';
import { FAILURE_CODE_MESSAGES, getFailureMessage } from './PayoutFailedBanner';

export type WithdrawalResultStatus = 'processing' | 'success' | 'failure';
export type WithdrawalMethod = 'standard' | 'instant';

// Client-side error codes from POST /connect/transfer and
// /connect/instant-payout (see supabase/functions/connect/withdrawal-validation.ts
// and instant-payout-validation.ts) — distinct from Stripe's own Payout
// failure_code vocabulary in FAILURE_CODE_MESSAGES above, which describes
// why a payout that already left Stripe never reached the bank/card.
const REQUEST_ERROR_MESSAGES: Record<string, string> = {
  account_not_eligible: 'Withdrawals are unavailable while your account is under review. Contact support for details.',
  connect_not_onboarded: 'Your payout account is not set up yet. Please complete Stripe Connect onboarding.',
  payouts_disabled: 'Payouts are currently disabled on your account. Please review your payout details and try again.',
  insufficient_balance: 'Insufficient available balance. Part of your balance may be on hold or already reserved.',
  balance_frozen: 'Your balance is temporarily frozen due to an open payment dispute.',
  no_bank_account: 'No bank account is linked. Add one from Manage Payout Methods.',
  no_debit_card: 'No debit card is linked for Instant Cash Out. Add one from Manage Payout Methods.',
  no_instant_eligible_card: "None of your linked debit cards currently support Instant Cash Out.",
  card_not_instant_eligible: 'This debit card does not currently support Instant Cash Out.',
  instant_cashout_disabled: 'Instant Cash Out is not currently available. Please use a standard withdrawal.',
  platform_balance_insufficient: 'Withdrawals are temporarily unavailable. Your balance has not been charged.',
  destination_account_invalid: 'Your linked bank account cannot receive transfers right now.',
  stripe_unreachable: 'We could not reach our payment provider. Your balance has not been charged.',
  bank_account_not_default: 'This bank account is not your default payout method. Set it as default in your payout dashboard, then try again.',
  above_instant_maximum: 'Instant Cash Out has a maximum amount per transfer. Try a smaller amount, or use a standard bank withdrawal.',
  insufficient_instant_balance: 'Your Stripe balance available for Instant Cash Out is lower than this amount right now. Try a smaller amount, or use a standard bank withdrawal.',
  daily_instant_limit_reached: "You've reached today's Instant Cash Out limit. Please try again tomorrow, or use a standard bank withdrawal.",
};

// Error codes where the fix lives in the Stripe payout dashboard (add/remove/
// default a bank account or debit card) — these get a direct "Manage Payout
// Methods" action instead of leaving the hunter to find their own way there.
// This is the "map the permission error to an actionable UI, not a raw
// error" requirement: these Connect accounts have
// controller.requirement_collection === "stripe", so the platform can never
// fix any of these server-side — only the hunter, via their dashboard, can.
const MANAGE_PAYOUT_METHODS_ERROR_CODES = new Set([
  'payouts_disabled',
  'no_bank_account',
  'no_debit_card',
  'no_instant_eligible_card',
  'card_not_instant_eligible',
  'bank_account_not_default',
  'destination_account_invalid',
]);

function resolveErrorCopy(errorCode: string | null | undefined, errorMessage: string | null | undefined): string {
  if (errorCode && REQUEST_ERROR_MESSAGES[errorCode]) return REQUEST_ERROR_MESSAGES[errorCode];
  if (errorCode && FAILURE_CODE_MESSAGES[errorCode]) return FAILURE_CODE_MESSAGES[errorCode];
  if (errorCode) return getFailureMessage(errorCode, errorMessage ?? undefined);
  return errorMessage || 'Something went wrong. Please try again.';
}

export interface WithdrawalResultScreenProps {
  status: WithdrawalResultStatus;
  method: WithdrawalMethod;
  amount: number;
  /** Instant Cash Out only — amount after the fee is deducted. */
  netAmount?: number;
  fee?: number;
  destinationLabel?: string;
  estimatedArrival?: string;
  transferId?: string | null;
  fellBackToStandard?: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  /** success (Done) or failure (Cancel) — always available. */
  onDismiss: () => void;
  /** failure only — re-attempt with the same amount/destination. */
  onRetry?: () => void;
  /** failure only — opens the Stripe payout dashboard (login link). Shown only for errorCodes in MANAGE_PAYOUT_METHODS_ERROR_CODES. */
  onManagePayoutMethods?: () => void;
}

export function WithdrawalResultScreen({
  status,
  method,
  amount,
  netAmount,
  fee,
  destinationLabel,
  estimatedArrival,
  transferId,
  fellBackToStandard,
  errorCode,
  errorMessage,
  onDismiss,
  onRetry,
  onManagePayoutMethods,
}: WithdrawalResultScreenProps) {
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const showManagePayoutMethods =
    !!onManagePayoutMethods && !!errorCode && MANAGE_PAYOUT_METHODS_ERROR_CODES.has(errorCode);

  if (status === 'processing') {
    return (
      <View style={[s.container, s.centered]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={s.processingTitle}>
          {method === 'instant' ? 'Sending your Instant Cash Out…' : 'Sending your withdrawal…'}
        </Text>
        <Text style={s.processingSubtitle}>This usually only takes a few seconds.</Text>
      </View>
    );
  }

  if (status === 'failure') {
    const message = resolveErrorCopy(errorCode, errorMessage);
    return (
      <View style={[s.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
        <View style={s.centered}>
          <View style={[s.iconCircle, s.iconCircleError]}>
            <MaterialIcons name="error-outline" size={44} color="#ef4444" />
          </View>
          <Text style={s.resultTitle}>
            {method === 'instant' ? 'Cash Out Failed' : 'Withdrawal Failed'}
          </Text>
          <Text style={s.resultAmount}>{formatCurrency(amount)}</Text>
          <Text style={s.errorMessage}>{message}</Text>
        </View>

        <View style={s.actions}>
          {showManagePayoutMethods ? (
            <TouchableOpacity
              style={s.primaryButton}
              onPress={onManagePayoutMethods}
              accessibilityRole="button"
              accessibilityLabel="Manage payout methods"
              accessibilityHint="Opens your Stripe payout dashboard"
            >
              <Text style={s.primaryButtonText}>Manage Payout Methods</Text>
            </TouchableOpacity>
          ) : (
            onRetry && (
              <TouchableOpacity style={s.primaryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Try again">
                <Text style={s.primaryButtonText}>Try Again</Text>
              </TouchableOpacity>
            )
          )}
          <TouchableOpacity style={s.secondaryButton} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss">
            <Text style={s.secondaryButtonText}>{onRetry || showManagePayoutMethods ? 'Cancel' : 'Done'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // success
  const isInstant = method === 'instant' && !fellBackToStandard;
  return (
    <View style={[s.container, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]}>
      <View style={s.centered}>
        <View style={[s.iconCircle, s.iconCircleSuccess]}>
          <MaterialIcons name={isInstant ? 'bolt' : 'check'} size={44} color="#22c55e" />
        </View>
        <Text style={s.resultTitle}>
          {fellBackToStandard ? 'Sent via Standard Transfer' : isInstant ? 'Cash Out Sent' : 'Withdrawal Initiated'}
        </Text>
        <Text style={s.resultAmount}>
          {formatCurrency(isInstant && netAmount != null ? netAmount : amount)}
        </Text>
        {isInstant && fee != null && fee > 0 && (
          <Text style={s.feeNote}>{formatCurrency(amount)} minus a {formatCurrency(fee)} instant fee</Text>
        )}

        <View style={s.receipt}>
          {destinationLabel && (
            <View style={s.receiptRow}>
              <Text style={s.receiptLabel}>To</Text>
              <Text style={s.receiptValue}>{destinationLabel}</Text>
            </View>
          )}
          <View style={s.receiptRow}>
            <Text style={s.receiptLabel}>Estimated arrival</Text>
            <Text style={s.receiptValue}>
              {estimatedArrival ?? (isInstant ? 'Usually within minutes' : '1-2 business days')}
            </Text>
          </View>
          {transferId && (
            <View style={s.receiptRow}>
              <Text style={s.receiptLabel}>Reference</Text>
              <Text style={s.receiptValueMono} numberOfLines={1}>{transferId}</Text>
            </View>
          )}
        </View>

        {fellBackToStandard && (
          <Text style={s.fallbackNote}>
            Instant Cash Out couldn&apos;t complete, so this was sent as a standard bank transfer instead. You were not charged an instant fee.
          </Text>
        )}
      </View>

      <View style={s.actions}>
        <TouchableOpacity style={s.primaryButton} onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={s.primaryButtonText}>Done</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background, paddingHorizontal: 24, justifyContent: 'space-between' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  processingTitle: { fontSize: 18, fontWeight: '600', color: t.text, marginTop: 20, textAlign: 'center' },
  processingSubtitle: { fontSize: 14, color: t.textSecondary, marginTop: 6, textAlign: 'center' },
  iconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  iconCircleSuccess: { backgroundColor: 'rgba(34,197,94,0.15)' },
  iconCircleError: { backgroundColor: 'rgba(239,68,68,0.15)' },
  resultTitle: { fontSize: 20, fontWeight: '700', color: t.text, textAlign: 'center' },
  resultAmount: { fontSize: 34, fontWeight: 'bold', color: t.text, marginTop: 8 },
  feeNote: { fontSize: 13, color: t.textSecondary, marginTop: 4 },
  errorMessage: { fontSize: 14, color: t.textSecondary, textAlign: 'center', marginTop: 12, lineHeight: 20, paddingHorizontal: 8 },
  receipt: { width: '100%', backgroundColor: t.surface, borderRadius: 14, padding: 16, marginTop: 24 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  receiptLabel: { fontSize: 13, color: t.textSecondary },
  receiptValue: { fontSize: 13, fontWeight: '600', color: t.text, flexShrink: 1, textAlign: 'right', marginLeft: 12 },
  receiptValueMono: { fontSize: 12, fontWeight: '500', color: t.textSecondary, flexShrink: 1, textAlign: 'right', marginLeft: 12, maxWidth: 180 },
  fallbackNote: { fontSize: 12, color: t.textSecondary, textAlign: 'center', marginTop: 16, lineHeight: 17, paddingHorizontal: 8 },
  actions: { paddingBottom: 8 },
  primaryButton: {
    backgroundColor: t.primary, borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginBottom: 10,
  },
  primaryButtonText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  secondaryButton: { paddingVertical: 12, alignItems: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '600', color: t.textSecondary },
}); }
