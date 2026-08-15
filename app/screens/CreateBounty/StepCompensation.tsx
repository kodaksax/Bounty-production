import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { analyticsService } from '../../../lib/services/analytics-service';
import { getBottomNavBaseClearance, getBottomNavContentPadding } from '../../../lib/constants/navigation';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { EscrowExplainer } from '../../../components/ui/escrow-explainer';
import { ErrorBanner } from '../../../components/error-banner';
import { FeedbackModal } from '../../../components/ui/feedback-modal';
import { PaymentMethodsModal } from '../../../components/payment-methods-modal';
import { buildDepositSuccessMessage, useWalletDeposit } from '../../../hooks/use-wallet-deposit';
import { getUserFriendlyError } from '../../../lib/utils/error-messages';
import { validateAmount, validateBalance } from '../../../lib/utils/bounty-validation';
import { useWallet } from '../../../lib/wallet-context';

interface StepCompensationProps {
  draft: BountyDraft;
  onUpdate: (data: Partial<BountyDraft>) => void;
  onNext: () => void;
  onBack: () => void;
}

const AMOUNT_PRESETS = [5, 10, 25, 50, 100];

export function StepCompensation({ draft, onUpdate, onNext, onBack }: StepCompensationProps) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [customAmount, setCustomAmount] = useState('');
  const insets = useSafeAreaInsets();
  const { balance } = useWallet();
  const { theme } = useAppThemeContext();

  // P0 fix (2026-08-01): previously a poster who picked an amount above their
  // wallet balance hit a dead end here — a blocking alert with no way to add
  // funds, on a screen that has no other funding affordance. That dead end,
  // not the $0/Honor toggle, was the real reason paid bounties never got
  // created for almost anyone (1 of 116 profiles had any balance at all).
  // This reuses the same deposit hook the onboarding funding screen already
  // uses so top-up behavior can't drift between the two surfaces.
  const {
    isProcessing: isTopUpProcessing,
    error: topUpError, setError: setTopUpError,
    successInfo: topUpSuccess, setSuccessInfo: setTopUpSuccess,
    showPaymentMethodsModal, setShowPaymentMethodsModal,
    paymentMethods, stripeLoading, loadPaymentMethods,
    payWithCard, payWithApplePay,
  } = useWalletDeposit();
  const hasPaymentMethod = paymentMethods.length > 0;

  // Initialize customAmount from draft if it's a custom value
  useEffect(() => {
    if (draft.amount > 0 && !AMOUNT_PRESETS.includes(draft.amount)) {
      const newValue = draft.amount.toString();
      if (newValue !== customAmount) {
        setCustomAmount(newValue);
      }
    }
  }, [draft.amount, customAmount]);

  const handleAddFunds = async (shortfall: number) => {
    if (!hasPaymentMethod) {
      setShowPaymentMethodsModal(true);
      return;
    }
    await payWithCard(shortfall);
  };

  const handleAddFundsApplePay = async (shortfall: number) => {
    await payWithApplePay(shortfall);
  };

  const handleHonorToggle = (value: boolean) => {
    // Sizes the single biggest known leak in the posting funnel: posters who
    // pick a real amount and then switch to a $0 post. `previousAmount` and
    // `balanceCovered` separate "never intended to pay" from "wanted to pay
    // but couldn't fund it from here". `reason` makes that split queryable
    // directly instead of re-deriving it from the other fields every time:
    // a failed in-flow top-up wins (payment_setup_failed), then an
    // uncovered amount (balance_insufficient), else a real preference
    // (user_choice — includes toggling Honor before ever picking an amount).
    if (value) {
      const hadAmount = draft.amount > 0;
      const balanceCovered = hadAmount && balance >= draft.amount;
      const reason = !hadAmount
        ? 'user_choice'
        : topUpError
          ? 'payment_setup_failed'
          : !balanceCovered
            ? 'balance_insufficient'
            : 'user_choice';
      analyticsService.trackEvent('post_switched_to_honor', {
        surface: 'create_flow',
        previousAmount: draft.amount,
        hadAmount,
        balance,
        balanceCovered,
        reason,
      });
    }
    onUpdate({ isForHonor: value, amount: value ? 0 : draft.amount });
    if (value) {
      setErrors({});
      setTouched({});
    }
  };

  const handlePresetSelect = (preset: number) => {
    // Selection is no longer blocked by balance (see the P0 comment above) —
    // picking an amount above balance now surfaces the funding CTA below
    // instead of a dead-end alert. Still counted so the funnel shows how often
    // posters reach for an amount they haven't funded yet.
    if (!validateBalance(preset, balance, draft.isForHonor)) {
      analyticsService.trackEvent('post_amount_blocked_by_balance', {
        surface: 'create_flow',
        attemptedAmount: preset,
        balance,
        shortfall: Number((preset - balance).toFixed(2)),
        method: 'preset',
      });
    }
    onUpdate({ amount: preset, isForHonor: false });
    setCustomAmount('');
    setErrors({});
  };

  const handleCustomAmountChange = (value: string) => {
    const numValue = value.replace(/[^0-9]/g, '');
    setCustomAmount(numValue);

    if (numValue) {
      const amount = parseInt(numValue, 10);
      onUpdate({ amount, isForHonor: false });

      if (touched.amount) {
        const error = validateAmount(amount, false);
        setErrors({ ...errors, amount: error || '' });
      }
    } else {
      onUpdate({ amount: 0, isForHonor: false });
    }
  };

  const handleNext = () => {
    const amountError = validateAmount(draft.amount, draft.isForHonor);

    if (amountError) {
      setErrors({ amount: amountError });
      setTouched({ amount: true });
      return;
    }

    // We no longer block navigation here for insufficient balance.
    // Instead, we show a warning and the final submission will block it.
    // This allows users to complete the draft even if they need to top up.

    // amount_set — fired on leaving the step (not per keystroke) so the value
    // recorded is the one the poster actually committed to. Emitted for honor
    // posts too, with amount 0, so the step reads as a single decision point.
    const amountCovered = !draft.isForHonor && draft.amount > 0 && balance >= draft.amount;
    analyticsService.trackEvent('amount_set', {
      surface: 'create_flow',
      amount: draft.isForHonor ? 0 : draft.amount,
      isForHonor: draft.isForHonor,
      method: isCustomSelected ? 'custom' : 'preset',
      category: draft.category || 'none',
      balance,
      balanceCovered: amountCovered,
    });

    // payment_attached — under architecture v1 the money is reserved from the
    // poster's existing wallet balance by a DB trigger at insert time, so the
    // real gate is "does the balance already cover this". The in-flow top-up
    // above (see handleAddFunds) is what lets a poster reach that covered
    // state without leaving this screen; this event's volume over time is how
    // we tell whether that top-up is actually closing the gap.
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

  // Update isValid to only check basic amount validity. 
  // Balance is handled as a warning and during final submission.
  const isValid = draft.isForHonor || (!validateAmount(draft.amount, false) && draft.amount >= 1);
  const isCustomSelected = !draft.isForHonor && draft.amount > 0 && !AMOUNT_PRESETS.includes(draft.amount);
  const showBalanceWarning = !draft.isForHonor && draft.amount > 0 && !validateBalance(draft.amount, balance, draft.isForHonor);

  const scrollRef = useRef<any>(null)
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollTo?.({ y: 0, animated: false }), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <View className="flex-1" style={{ backgroundColor: theme.background }}>
      <ScrollView
        ref={scrollRef}
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled={true}
        removeClippedSubviews={false}
        scrollEnabled={true}
        bounces={true}
        showsVerticalScrollIndicator={true}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: getBottomNavContentPadding(insets.bottom) }}
      >
        {/* Wallet Balance Display */}
        <View className="mb-4 rounded-lg p-3 flex-row items-center justify-between" style={{ backgroundColor: theme.surface }}>
          <View className="flex-row items-center">
            <MaterialIcons name="account-balance-wallet" size={20} color={theme.primaryLight} />
            <Text className="text-sm font-medium ml-2" style={{ color: theme.text }}>
              Available Balance:
            </Text>
          </View>
          <Text className="text-lg font-bold" style={{ color: theme.primaryLight }}>
            ${balance.toFixed(2)}
          </Text>
        </View>

        {/* Honor Toggle */}
        <View className="mb-6 rounded-lg p-4" style={{ backgroundColor: theme.surface }}>
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>
                Post for Honor
              </Text>
              <Text className="text-sm mt-1" style={{ color: theme.textSecondary }}>
                No payment required - reputation only
              </Text>
            </View>
            <Switch
              value={draft.isForHonor}
              onValueChange={handleHonorToggle}
              trackColor={{ false: theme.border, true: theme.primary }}
              thumbColor={draft.isForHonor ? '#fff' : '#d1d5db'}
              accessibilityLabel="Post for honor toggle"
            />
          </View>
        </View>

        {!draft.isForHonor && (
          <>
            {/* Amount Presets */}
            <View className="mb-6">
              <Text className="text-base font-semibold mb-3" style={{ color: theme.text }}>
                How much will you pay? *
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {AMOUNT_PRESETS.map((preset) => {
                  const isSelected = draft.amount === preset;
                  const isOverBalance = preset > balance;
                  return (
                    <TouchableOpacity
                      key={preset}
                      onPress={() => handlePresetSelect(preset)}
                      className={`px-6 py-3 rounded-lg${isOverBalance ? ' border border-red-500/50' : ''}`}
                      style={{ backgroundColor: isOverBalance ? theme.surfaceSecondary : isSelected ? theme.primary : theme.surface }}
                      accessibilityLabel={`Select $${preset}${isOverBalance ? ' (exceeds balance)' : ''}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text
                        className={`font-semibold text-lg${isOverBalance ? ' text-red-300/70' : ''}`}
                        style={!isOverBalance ? { color: isSelected ? '#fff' : theme.textSecondary } : undefined}
                      >
                        ${preset}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom Amount */}
              <TouchableOpacity
                onPress={() => {
                  // Focus on custom input
                }}
                className={`px-6 py-3 rounded-lg border-2${!isCustomSelected ? ' border-dashed' : ''}`}
                style={{ backgroundColor: isCustomSelected ? theme.primary : theme.surfaceSecondary, borderColor: isCustomSelected ? theme.primary : theme.border }}
                accessibilityLabel="Enter custom amount"
                accessibilityRole="button"
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    className="font-semibold"
                    style={{ color: isCustomSelected ? '#fff' : theme.textSecondary }}
                  >
                    Custom Amount
                  </Text>
                  <MaterialIcons
                    name="edit"
                    size={20}
                    color={isCustomSelected ? '#fff' : theme.primaryLight}
                  />
                </View>
              </TouchableOpacity>

              {/* Custom Amount Input */}
              <View className="mt-3">
                <View className={`flex-row items-center rounded-lg px-4 py-3${showBalanceWarning ? ' bg-red-500/20 border border-red-500/50' : ''}`}
                  style={!showBalanceWarning ? { backgroundColor: theme.surfaceSecondary } : undefined}>
                  <Text className="text-lg font-semibold mr-2" style={{ color: theme.text }}>$</Text>
                  <TextInput
                    value={customAmount}
                    onChangeText={handleCustomAmountChange}
                    placeholder="0"
                    placeholderTextColor={theme.textDisabled}
                    keyboardType="numeric"
                    className="flex-1 text-lg"
                    style={{ color: theme.text }}
                    accessibilityLabel="Custom amount input"
                  />
                </View>
                {touched.amount && errors.amount && (
                  <ValidationMessage message={errors.amount} />
                )}
                {/* Balance shortfall — actionable, not a dead end. Shortfall is
                    charged directly (not the full amount), since the existing
                    balance already covers part of it. */}
                {showBalanceWarning && (
                  <View className="mt-2 bg-red-500/20 border border-red-500/50 rounded-lg p-3">
                    <View className="flex-row items-start mb-3">
                      <MaterialIcons name="warning" size={18} color="#fca5a5" style={{ marginRight: 8, marginTop: 2 }} />
                      <View className="flex-1">
                        <Text className="text-red-200 text-sm font-semibold">
                          Add ${(draft.amount - balance).toFixed(2)} to post this
                        </Text>
                        <Text className="text-red-200/80 text-xs mt-1">
                          Your balance (${balance.toFixed(2)}) doesn't cover this amount yet.
                        </Text>
                      </View>
                    </View>

                    {(topUpError) && (
                      <View className="mb-3">
                        <ErrorBanner
                          error={getUserFriendlyError(topUpError)}
                          onDismiss={() => setTopUpError(null)}
                        />
                      </View>
                    )}

                    <View className="flex-row gap-2">
                      {Platform.OS === 'ios' && (
                        <TouchableOpacity
                          onPress={() => handleAddFundsApplePay(draft.amount - balance)}
                          disabled={isTopUpProcessing || stripeLoading}
                          className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
                          style={{ backgroundColor: theme.isDark ? '#ffffff' : '#000000' }}
                          accessibilityRole="button"
                          accessibilityLabel="Pay shortfall with Apple Pay"
                        >
                          {isTopUpProcessing ? (
                            <ActivityIndicator size="small" color={theme.isDark ? '#000000' : '#ffffff'} />
                          ) : (
                            <MaterialIcons name="apple" size={20} color={theme.isDark ? '#000000' : '#ffffff'} />
                          )}
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => handleAddFunds(draft.amount - balance)}
                        disabled={isTopUpProcessing || stripeLoading}
                        className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
                        style={{ backgroundColor: theme.primary }}
                        accessibilityRole="button"
                        accessibilityLabel={hasPaymentMethod ? `Add $${(draft.amount - balance).toFixed(2)} to your balance` : 'Link a payment method'}
                      >
                        {(isTopUpProcessing || stripeLoading) ? (
                          <ActivityIndicator size="small" color="#fff" style={{ marginRight: 8 }} />
                        ) : null}
                        <Text className="font-semibold" style={{ color: '#fff' }}>
                          {stripeLoading
                            ? 'Checking…'
                            : !hasPaymentMethod
                              ? 'Link a Card'
                              : `Add $${(draft.amount - balance).toFixed(2)}`}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            </View>

            {/* Escrow Info - Enhanced with interactive explanation */}
            <View className="mb-6">
              <EscrowExplainer
                amount={draft.amount > 0 ? draft.amount : undefined}
                variant="card"
                showLearnMore={true}
              />
            </View>
          </>
        )}

        {draft.isForHonor && (
          <View className="mb-6 rounded-lg p-4 border" style={{ backgroundColor: theme.surface, borderColor: theme.border }}>
            <View className="flex-row items-start">
              <MaterialIcons
                name="favorite"
                size={20}
                color={theme.primaryLight}
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="font-semibold mb-1" style={{ color: theme.text }}>
                  Honor Bounty
                </Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>
                  This bounty is for reputation and experience only. No payment will be processed.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 border-t"
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: getBottomNavBaseClearance(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: theme.surfaceSecondary }}
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color={theme.text} />
            <Text className="font-semibold ml-2" style={{ color: theme.text }}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className="flex-1 py-3 rounded-lg flex-row items-center justify-center"
            style={{ backgroundColor: isValid ? theme.primary : theme.surface }}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className="font-semibold mr-2"
              style={{ color: isValid ? '#fff' : theme.textDisabled }}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : theme.textDisabled}
            />
          </TouchableOpacity>
        </View>
      </View>

      {showPaymentMethodsModal && (
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => {
            setShowPaymentMethodsModal(false);
            loadPaymentMethods();
          }}
          onBackdropPress={() => {
            setShowPaymentMethodsModal(false);
            loadPaymentMethods();
          }}
        />
      )}

      <FeedbackModal
        visible={!!topUpSuccess}
        variant="success"
        title="Added!"
        message={topUpSuccess ? buildDepositSuccessMessage(topUpSuccess) : ''}
        actionLabel="Continue"
        onDismiss={() => setTopUpSuccess(null)}
      />
    </View>
  );
}

export default StepCompensation;
