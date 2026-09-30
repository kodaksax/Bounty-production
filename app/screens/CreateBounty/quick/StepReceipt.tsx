import { MaterialIcons } from '@expo/vector-icons';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { PaymentMethodsModal } from 'components/payment-methods-modal';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useWalletPostingFee } from '../../../../hooks/useWalletPostingFee';
import type { StripePaymentMethod } from '../../../../lib/services/stripe-internal';
import { useStripe } from '../../../../lib/stripe-context';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';
import { QuickStepLayout } from './QuickStepLayout';

interface StepReceiptProps {
  draft: BountyDraft;
  onPost: () => void;
  onBack: () => void;
  isSubmitting?: boolean;
  step: number;
  totalSteps: number;
}

function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/** "Visa •••• 4242" for a card, "Chase •••• 6789" for a linked bank. */
function paymentMethodLabel(pm: StripePaymentMethod): string {
  if (pm.type === 'us_bank_account') {
    const name = pm.us_bank_account?.bank_name?.trim() || 'Bank account';
    const last4 = pm.us_bank_account?.last4;
    return last4 ? `${name} •••• ${last4}` : name;
  }
  const brand = pm.card?.brand ? pm.card.brand.charAt(0).toUpperCase() + pm.card.brand.slice(1) : 'Card';
  return pm.card?.last4 ? `${brand} •••• ${pm.card.last4}` : brand;
}

/**
 * Purchase summary shown between the amount step and publishing.
 *
 * The fee line is the server's wallet posting fee (useWalletPostingFee), not a
 * hard-coded $1, so the receipt never itemises a charge the server will not
 * make. The payment method shown is `paymentMethods[0]`, the same default the
 * Stripe context charges when no id is passed.
 *
 * With no payment method on file, the Post CTA opens PaymentMethodsModal
 * instead of publishing; once a method is linked the row appears and the next
 * tap posts.
 */
export function StepReceipt({
  draft,
  onPost,
  onBack,
  isSubmitting = false,
  step,
  totalSteps,
}: StepReceiptProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const postingFee = useWalletPostingFee();
  const { paymentMethods, isLoading: methodsLoading, loadPaymentMethods } = useStripe();
  const [showPaymentMethods, setShowPaymentMethods] = useState(false);

  // The context loads methods on sign-in; refresh here so a card added on
  // another screen since then is reflected on the receipt.
  useEffect(() => {
    loadPaymentMethods().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const subtotal = draft.isForHonor ? 0 : draft.amount || 0;
  const total = subtotal + postingFee;
  const paymentMethod = paymentMethods[0];

  const handleCta = () => {
    if (!paymentMethod) {
      setShowPaymentMethods(true);
      return;
    }
    onPost();
  };

  const closePaymentMethods = () => {
    setShowPaymentMethods(false);
    loadPaymentMethods().catch(() => {});
  };

  return (
    <QuickStepLayout
      step={step}
      totalSteps={totalSteps}
      onBack={onBack}
      title="Purchase summary"
      ctaLabel={isSubmitting ? 'Posting…' : 'Post Bounty'}
      onCta={handleCta}
      // Blocks the tap while methods are still loading, so a poster who has a
      // card is not sent to set one up just because the list is empty so far.
      ctaBusy={isSubmitting || (methodsLoading && !paymentMethod)}
    >
      <View style={styles.row}>
        <Text style={styles.label}>Subtotal</Text>
        <Text style={styles.value}>{money(subtotal)}</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.label}>Posting fee</Text>
        <Text style={styles.value}>{money(postingFee)}</Text>
      </View>
      <View style={styles.feeNote}>
        <MaterialIcons name="info-outline" size={15} color={theme.textSecondary} />
        <Text style={styles.feeNoteText}>
          A one-time, non-refundable fee to list your bounty. It is not part of the reward.
        </Text>
      </View>

      <View style={[styles.row, styles.totalRow]}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>{money(total)}</Text>
      </View>

      {paymentMethod ? (
        <View style={styles.methodRow} testID="receipt-payment-method">
          <MaterialIcons
            name={paymentMethod.type === 'us_bank_account' ? 'account-balance' : 'credit-card'}
            size={18}
            color={theme.textSecondary}
          />
          <Text style={styles.methodText}>{paymentMethodLabel(paymentMethod)}</Text>
        </View>
      ) : null}

      {showPaymentMethods && (
        <PaymentMethodsModal
          isOpen={showPaymentMethods}
          onClose={closePaymentMethods}
          onBackdropPress={closePaymentMethods}
          preferredType="card"
        />
      )}
    </QuickStepLayout>
  );
}

const makeStyles = (theme: AppTheme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 12,
    },
    label: { color: theme.text, fontSize: 15, fontWeight: '600' },
    value: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    feeNote: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      marginTop: -4,
      marginBottom: 8,
    },
    feeNoteText: { flex: 1, color: theme.textSecondary, fontSize: 12, lineHeight: 17 },
    totalRow: {
      borderTopWidth: 1,
      borderTopColor: theme.border,
      marginTop: 4,
      paddingTop: 14,
    },
    totalLabel: { color: theme.text, fontSize: 17, fontWeight: '700' },
    totalValue: {
      color: theme.text,
      fontSize: 18,
      fontWeight: '700',
      fontVariant: ['tabular-nums'],
    },
    methodRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
    methodText: { color: theme.textSecondary, fontSize: 14, fontWeight: '500' },
  });

export default StepReceipt;
