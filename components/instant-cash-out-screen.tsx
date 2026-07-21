import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthContext } from '../hooks/use-auth-context';
import type { UseConnectEligibilityResult } from '../hooks/use-connect-eligibility';
import type { UsePayoutMethodsResult } from '../hooks/use-payout-methods';
import { config } from '../lib/config';
import { API_BASE_URL } from '../lib/config/api';
import { formatCurrency } from '../lib/utils';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { useWallet } from '../lib/wallet-context';
import { AddDebitCardModal } from './add-debit-card-modal';
import { WithdrawalConfirmSheet } from './ui/withdrawal-confirm-sheet';
import { WithdrawalResultScreen, type WithdrawalResultStatus } from './ui/withdrawal-result-screen';

// Mirrors the server-side defaults (INSTANT_PAYOUT_FEE_PERCENT /
// INSTANT_PAYOUT_FEE_MIN_USD in supabase/functions/connect/index.ts) for
// PRE-CONFIRMATION display only. The authoritative fee is always whatever
// POST /connect/instant-payout / the resulting webhook actually records.
const ESTIMATED_FEE_PERCENT = 1;
const ESTIMATED_FEE_MIN_USD = 0.5;
function estimateFee(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.max(Math.round(amount * ESTIMATED_FEE_PERCENT) / 100, ESTIMATED_FEE_MIN_USD);
}

const BOTTOM_NAV_OFFSET = 60;

interface InstantCashOutScreenProps {
  onBack: () => void;
  /** Called after a successful (or gracefully-fallen-back) cash out so the caller can refresh balance/history. */
  onComplete?: () => void;
  balance?: number;
  eligibility: UseConnectEligibilityResult;
  payoutMethods: UsePayoutMethodsResult;
}

export function InstantCashOutScreen({
  onBack,
  onComplete,
  balance: propBalance,
  eligibility,
  payoutMethods,
}: InstantCashOutScreenProps) {
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [showAddCard, setShowAddCard] = useState(false);
  const [showConfirmSheet, setShowConfirmSheet] = useState(false);
  const [cashOutResult, setCashOutResult] = useState<{
    status: WithdrawalResultStatus;
    payoutId?: string | null;
    fellBackToStandard?: boolean;
    errorCode?: string | null;
    errorMessage?: string | null;
  } | null>(null);

  const { balance: walletBalance, refreshFromApi } = useWallet();
  const { session } = useAuthContext();
  const { theme } = useAppThemeContext();
  const s = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();

  const balance = propBalance ?? walletBalance;
  const idempotencyKeyRef = useRef(`instant_${session?.user?.id ?? 'u'}_${Date.now()}`);

  const authHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token ?? ''}`,
      ...(config.supabase.anonKey ? { apikey: config.supabase.anonKey } : {}),
    }),
    [session?.access_token]
  );

  const { debitCards, availableBalance, hasInstantEligibleCard } = payoutMethods;
  const loading = eligibility.loading || payoutMethods.isLoading;
  const loadError = eligibility.error ?? payoutMethods.error;

  // Auto-select the first instant-eligible card whenever the shared card
  // list changes (e.g. after adding one via AddDebitCardModal).
  useEffect(() => {
    if (selectedCardId && debitCards.some(c => c.id === selectedCardId && c.instantEligible)) return;
    const eligibleCard = debitCards.find(c => c.instantEligible);
    if (eligibleCard) setSelectedCardId(eligibleCard.id);
  }, [debitCards, selectedCardId]);

  const parsedAmount = parseFloat(amount);
  const effectiveAvailable = availableBalance ?? balance;
  const isFullyEligible =
    eligibility.connectedAccountExists &&
    eligibility.chargesEnabled &&
    eligibility.payoutsEnabled &&
    hasInstantEligibleCard;

  const isCashOutDisabled =
    !isFullyEligible ||
    !amount ||
    isNaN(parsedAmount) ||
    parsedAmount <= 0 ||
    parsedAmount > effectiveAvailable ||
    !selectedCardId;

  const estimatedFee = estimateFee(parsedAmount || 0);
  const estimatedNet = Math.max((parsedAmount || 0) - estimatedFee, 0);
  const selectedCard = debitCards.find(c => c.id === selectedCardId);
  const destinationLabel = selectedCard
    ? `${selectedCard.brand ?? 'card'} •••• ${selectedCard.last4 ?? ''}`
    : 'your debit card';

  const handleCashOut = () => {
    setShowConfirmSheet(true);
  };

  const performCashOut = async () => {
    setCashOutResult({ status: 'processing' });
    try {
      if (!session?.access_token) throw new Error('Not authenticated. Please sign in again.');

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      let response: Response;
      try {
        response = await fetch(`${API_BASE_URL}/connect/instant-payout`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({
            amount: parsedAmount,
            currency: 'usd',
            idempotencyKey: idempotencyKeyRef.current,
            debitCardId: selectedCardId,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = new Error(data?.error ?? 'Instant Cash Out failed. Please try again.') as Error & { code?: string };
        err.code = data?.code;
        throw err;
      }

      await refreshFromApi(session.access_token);
      idempotencyKeyRef.current = `instant_${session?.user?.id ?? 'u'}_${Date.now()}`;

      setCashOutResult({
        status: 'success',
        payoutId: data.payoutId ?? data.transferId ?? null,
        fellBackToStandard: !!data.fellBackToStandard,
      });
    } catch (error: any) {
      setCashOutResult({
        status: 'failure',
        errorCode: error?.code,
        errorMessage: error?.message ?? 'Something went wrong. Please try again.',
      });
    }
  };

  if (showAddCard) {
    return (
      <AddDebitCardModal
        onBack={() => setShowAddCard(false)}
        onSave={() => payoutMethods.refresh()}
      />
    );
  }

  if (cashOutResult) {
    return (
      <WithdrawalResultScreen
        status={cashOutResult.status}
        method="instant"
        amount={parsedAmount || 0}
        netAmount={cashOutResult.fellBackToStandard ? undefined : estimatedNet}
        fee={cashOutResult.fellBackToStandard ? undefined : estimatedFee}
        destinationLabel={cashOutResult.fellBackToStandard ? undefined : destinationLabel}
        transferId={cashOutResult.payoutId}
        fellBackToStandard={cashOutResult.fellBackToStandard}
        errorCode={cashOutResult.errorCode}
        errorMessage={cashOutResult.errorMessage}
        onDismiss={() => {
          const wasSuccess = cashOutResult.status === 'success';
          setCashOutResult(null);
          if (wasSuccess) {
            setAmount('');
            onComplete?.();
            onBack();
          }
        }}
        onRetry={cashOutResult.status === 'failure' ? () => performCashOut() : undefined}
      />
    );
  }

  // Ordered, exact-reason eligibility checklist — never a generic failure.
  const checklist: { label: string; met: boolean; hint?: string }[] = [
    { label: 'Payout account connected', met: eligibility.connectedAccountExists, hint: 'Complete Stripe Connect onboarding from the Withdraw screen.' },
    { label: 'Identity details submitted', met: eligibility.detailsSubmitted, hint: 'Finish submitting your identity details with Stripe.' },
    { label: 'Charges enabled', met: eligibility.chargesEnabled },
    { label: 'Payouts enabled', met: eligibility.payoutsEnabled, hint: 'Review your payout details — something may need attention.' },
    { label: 'Eligible debit card linked', met: hasInstantEligibleCard, hint: 'Add a debit card. Not every card supports Instant Cash Out.' },
    { label: 'Sufficient available balance', met: effectiveAvailable > 0 },
  ];

  return (
    <View style={s.container}>
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={onBack} style={s.backButton} accessibilityLabel="Go back" accessibilityRole="button">
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Instant Cash Out</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={s.content}>
        <View style={s.balanceCard}>
          <Text style={s.balanceLabel}>Available for Instant Cash Out</Text>
          <Text style={s.balanceAmount}>{formatCurrency(effectiveAvailable)}</Text>
        </View>

        {loading ? (
          <ActivityIndicator size="small" color={theme.primary} style={{ marginVertical: 16 }} />
        ) : (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Eligibility</Text>
            {checklist.map(item => (
              <View key={item.label} style={s.checklistRow}>
                <MaterialIcons
                  name={item.met ? 'check-circle' : 'radio-button-unchecked'}
                  size={20}
                  color={item.met ? '#22c55e' : theme.textDisabled}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[s.checklistLabel, item.met && s.checklistLabelMet]}>{item.label}</Text>
                  {!item.met && item.hint ? <Text style={s.checklistHint}>{item.hint}</Text> : null}
                </View>
              </View>
            ))}
            {loadError ? <Text style={s.errorText}>{loadError}</Text> : null}
          </View>
        )}

        {hasInstantEligibleCard && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Send To</Text>
            {debitCards.filter(c => c.instantEligible).map(card => (
              <TouchableOpacity
                key={card.id}
                style={[s.cardRow, selectedCardId === card.id && s.cardRowSelected]}
                onPress={() => setSelectedCardId(card.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedCardId === card.id }}
                accessibilityLabel={`${card.brand ?? 'Card'} ending in ${card.last4}`}
              >
                <MaterialIcons
                  name={selectedCardId === card.id ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={22}
                  color={selectedCardId === card.id ? '#22c55e' : theme.textDisabled}
                />
                <Text style={s.cardRowText}>{card.brand ?? 'Card'} •••• {card.last4}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {!loading && (
          <TouchableOpacity
            onPress={() => setShowAddCard(true)}
            style={s.addCardButton}
            accessibilityRole="button"
            accessibilityLabel="Add a debit card"
          >
            <MaterialIcons name="add" size={18} color={theme.primary} />
            <Text style={s.addCardButtonText}>Add a debit card</Text>
          </TouchableOpacity>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>Amount</Text>
          <View style={s.amountInputContainer}>
            <Text style={s.currencySymbol}>$</Text>
            <TextInput
              style={s.amountInput}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor={theme.textDisabled}
              keyboardType="decimal-pad"
              accessibilityLabel="Cash out amount"
              editable={isFullyEligible}
            />
          </View>
          {parsedAmount > 0 && (
            <View style={s.feeRow}>
              <Text style={s.feeLabel}>Estimated fee</Text>
              <Text style={s.feeValue}>{formatCurrency(estimatedFee)}</Text>
            </View>
          )}
          {parsedAmount > 0 && (
            <View style={s.feeRow}>
              <Text style={s.feeLabelStrong}>You&apos;ll receive</Text>
              <Text style={s.feeValueStrong}>{formatCurrency(estimatedNet)}</Text>
            </View>
          )}
        </View>

        <View style={s.infoCard}>
          <MaterialIcons name="bolt" size={20} color={theme.primary} />
          <Text style={s.infoText}>
            Instant Cash Out typically arrives within minutes. A small fee applies —
            shown above before you confirm. Standard withdrawals to your bank account remain free.
          </Text>
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 16) }]}>
        <TouchableOpacity
          onPress={handleCashOut}
          disabled={isCashOutDisabled}
          style={[s.cashOutButton, isCashOutDisabled && s.cashOutButtonDisabled]}
          accessibilityRole="button"
          accessibilityLabel={amount ? `Cash out ${formatCurrency(parsedAmount)} instantly` : 'Cash out instantly'}
          accessibilityState={{ disabled: isCashOutDisabled }}
        >
          <Text style={s.cashOutButtonText}>
            {amount ? `Cash Out ${formatCurrency(parsedAmount)}` : 'Cash Out Instantly'}
          </Text>
        </TouchableOpacity>
      </View>

      <WithdrawalConfirmSheet
        visible={showConfirmSheet}
        method="instant"
        amount={parsedAmount || 0}
        fee={estimatedFee}
        netAmount={estimatedNet}
        destinationLabel={destinationLabel}
        estimatedArrival="Usually within minutes"
        isSubmitting={false}
        onConfirm={() => {
          setShowConfirmSheet(false);
          performCashOut();
        }}
        onCancel={() => setShowConfirmSheet(false)}
      />
    </View>
  );
}

function makeStyles(t: AppTheme) { return StyleSheet.create({
  container: { flex: 1, backgroundColor: t.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '600', color: t.text },
  content: { padding: 16 },
  balanceCard: {
    backgroundColor: t.surface, borderRadius: 16, padding: 14, marginBottom: 12, alignItems: 'center',
  },
  balanceLabel: { fontSize: 13, color: t.textSecondary, marginBottom: 2 },
  balanceAmount: { fontSize: 28, fontWeight: 'bold', color: t.text },
  section: { marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: t.text, marginBottom: 8 },
  checklistRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  checklistLabel: { fontSize: 14, color: t.textSecondary },
  checklistLabelMet: { color: t.text },
  checklistHint: { fontSize: 12, color: t.textDisabled, marginTop: 2 },
  errorText: { fontSize: 13, color: '#ef4444', marginTop: 4 },
  cardRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceSecondary,
    borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 2, borderColor: 'transparent',
  },
  cardRowSelected: { borderColor: '#22c55e', backgroundColor: t.surface },
  cardRowText: { marginLeft: 10, fontSize: 15, fontWeight: '600', color: t.text },
  addCardButton: {
    flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start',
    marginBottom: 16, paddingVertical: 6,
  },
  addCardButtonText: { marginLeft: 6, fontSize: 14, fontWeight: '600', color: t.primary },
  amountInputContainer: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.surfaceSecondary,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginBottom: 8,
  },
  currencySymbol: { fontSize: 22, fontWeight: '600', color: t.text, marginRight: 8 },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '600', color: t.text },
  feeRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  feeLabel: { fontSize: 13, color: t.textSecondary },
  feeValue: { fontSize: 13, color: t.textSecondary },
  feeLabelStrong: { fontSize: 14, fontWeight: '600', color: t.text },
  feeValueStrong: { fontSize: 14, fontWeight: '700', color: '#22c55e' },
  infoCard: {
    flexDirection: 'row', backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 24,
  },
  infoText: { flex: 1, fontSize: 13, color: t.textSecondary, marginLeft: 8, lineHeight: 18 },
  footer: { padding: 16 },
  cashOutButton: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: '#22c55e', borderRadius: 12, paddingVertical: 16,
    shadowColor: '#22c55e', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3,
  },
  cashOutButtonDisabled: { opacity: 0.5 },
  cashOutButtonText: { fontSize: 16, fontWeight: '600', color: '#ffffff' },
}); }
