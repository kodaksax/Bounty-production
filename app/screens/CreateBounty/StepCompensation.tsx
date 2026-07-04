import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../../lib/themes/AppThemeContext';
import { EscrowExplainer } from '../../../components/ui/escrow-explainer';
import { getInsufficientBalanceMessage, validateAmount, validateBalance } from '../../../lib/utils/bounty-validation';
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
  const BOTTOM_NAV_OFFSET = 60;
  const { balance } = useWallet();
  const { theme } = useAppThemeContext();

  // Initialize customAmount from draft if it's a custom value
  useEffect(() => {
    if (draft.amount > 0 && !AMOUNT_PRESETS.includes(draft.amount)) {
      const newValue = draft.amount.toString();
      if (newValue !== customAmount) {
        setCustomAmount(newValue);
      }
    }
  }, [draft.amount, customAmount]);

  const showInsufficientBalanceAlert = (amount: number) => {
    Alert.alert(
      'Insufficient Balance',
      getInsufficientBalanceMessage(amount, balance),
      [
        { text: 'OK', style: 'default' }
      ]
    );
  };

  const handleHonorToggle = (value: boolean) => {
    onUpdate({ isForHonor: value, amount: value ? 0 : draft.amount });
    if (value) {
      setErrors({});
      setTouched({});
    }
  };

  const handlePresetSelect = (preset: number) => {
    // Check if preset amount exceeds balance using shared validation
    if (!validateBalance(preset, balance, draft.isForHonor)) {
      showInsufficientBalanceAlert(preset);
      return;
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
        contentContainerStyle={{ flexGrow: 1, paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
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
                {/* Balance Warning */}
                {showBalanceWarning && (
                  <View className="mt-2 bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex-row items-start">
                    <MaterialIcons name="warning" size={18} color="#fca5a5" style={{ marginRight: 8, marginTop: 2 }} />
                    <View className="flex-1">
                      <Text className="text-red-200 text-sm font-semibold">
                        Insufficient Balance
                      </Text>
                      <Text className="text-red-200/80 text-xs mt-1">
                        Amount (${draft.amount}) exceeds your balance (${balance.toFixed(2)}). Please add funds or choose a lower amount.
                      </Text>
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
        style={{ backgroundColor: theme.background, borderColor: theme.border, marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
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
    </View>
  );
}

export default StepCompensation;
