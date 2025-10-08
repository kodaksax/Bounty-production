import { MaterialIcons } from '@expo/vector-icons';
import { ValidationMessage } from 'app/components/ValidationMessage';
import type { BountyDraft } from 'app/hooks/useBountyDraft';
import React, { useState } from 'react';
import { ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

  const validateAmount = (amount: number, isForHonor: boolean): string | null => {
    if (isForHonor) {
      return null; // Honor bounties don't need amount validation
    }
    if (!amount || amount < 1) {
      return 'Amount must be at least $1';
    }
    return null;
  };

  const handleHonorToggle = (value: boolean) => {
    onUpdate({ isForHonor: value, amount: value ? 0 : draft.amount });
    if (value) {
      setErrors({});
      setTouched({});
    }
  };

  const handlePresetSelect = (preset: number) => {
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
    }
  };

  const handleNext = () => {
    const amountError = validateAmount(draft.amount, draft.isForHonor);
    
    if (amountError) {
      setErrors({ amount: amountError });
      setTouched({ amount: true });
      return;
    }

    onNext();
  };

  const isValid = draft.isForHonor || (!validateAmount(draft.amount, false) && draft.amount >= 1);
  const isCustomSelected = !draft.isForHonor && draft.amount > 0 && !AMOUNT_PRESETS.includes(draft.amount);

  return (
    <View className="flex-1 bg-emerald-600">
      <ScrollView
        className="flex-1 px-4 pt-2"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 12) + 16 }}
      >
        {/* Honor Toggle */}
        <View className="mb-6 bg-emerald-700/30 rounded-lg p-4">
          <View className="flex-row items-center justify-between mb-2">
            <View className="flex-1">
              <Text className="text-emerald-100 text-base font-semibold">
                Post for Honor
              </Text>
              <Text className="text-emerald-200/70 text-sm mt-1">
                No payment required - reputation only
              </Text>
            </View>
            <Switch
              value={draft.isForHonor}
              onValueChange={handleHonorToggle}
              trackColor={{ false: '#065f46', true: '#34d399' }}
              thumbColor={draft.isForHonor ? '#fff' : '#d1d5db'}
              accessibilityLabel="Post for honor toggle"
            />
          </View>
        </View>

        {!draft.isForHonor && (
          <>
            {/* Amount Presets */}
            <View className="mb-6">
              <Text className="text-emerald-100 text-base font-semibold mb-3">
                How much will you pay? *
              </Text>
              <View className="flex-row flex-wrap gap-2 mb-3">
                {AMOUNT_PRESETS.map((preset) => {
                  const isSelected = draft.amount === preset;
                  return (
                    <TouchableOpacity
                      key={preset}
                      onPress={() => handlePresetSelect(preset)}
                      className={`px-6 py-3 rounded-lg ${
                        isSelected ? 'bg-emerald-400' : 'bg-emerald-700/50'
                      }`}
                      accessibilityLabel={`Select $${preset}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text
                        className={`font-semibold text-lg ${
                          isSelected ? 'text-emerald-900' : 'text-white'
                        }`}
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
                className={`px-6 py-3 rounded-lg border-2 ${
                  isCustomSelected
                    ? 'bg-emerald-400 border-emerald-400'
                    : 'bg-emerald-700/50 border-emerald-500/50 border-dashed'
                }`}
                accessibilityLabel="Enter custom amount"
                accessibilityRole="button"
              >
                <View className="flex-row items-center justify-between">
                  <Text
                    className={`font-semibold ${
                      isCustomSelected ? 'text-emerald-900' : 'text-emerald-200'
                    }`}
                  >
                    Custom Amount
                  </Text>
                  <MaterialIcons
                    name="edit"
                    size={20}
                    color={isCustomSelected ? '#065f46' : 'rgba(110, 231, 183, 0.6)'}
                  />
                </View>
              </TouchableOpacity>

              {/* Custom Amount Input */}
              <View className="mt-3">
                <View className="flex-row items-center bg-emerald-700/50 rounded-lg px-4 py-3">
                  <Text className="text-white text-lg font-semibold mr-2">$</Text>
                  <TextInput
                    value={customAmount}
                    onChangeText={handleCustomAmountChange}
                    placeholder="0"
                    placeholderTextColor="rgba(110, 231, 183, 0.4)"
                    keyboardType="numeric"
                    className="flex-1 text-white text-lg"
                    accessibilityLabel="Custom amount input"
                  />
                </View>
                {touched.amount && errors.amount && (
                  <ValidationMessage message={errors.amount} />
                )}
              </View>
            </View>

            {/* Escrow Info */}
            <View className="mb-6 bg-emerald-700/20 rounded-lg p-4 border border-emerald-500/30">
              <View className="flex-row items-start">
                <MaterialIcons
                  name="info-outline"
                  size={20}
                  color="rgba(110, 231, 183, 0.8)"
                  style={{ marginRight: 8, marginTop: 2 }}
                />
                <View className="flex-1">
                  <Text className="text-emerald-100 font-semibold mb-1">
                    Escrow Protection
                  </Text>
                  <Text className="text-emerald-200/70 text-sm">
                    Funds are held securely until the task is completed. You'll review and approve before payment is released.
                  </Text>
                </View>
              </View>
            </View>
          </>
        )}

        {draft.isForHonor && (
          <View className="mb-6 bg-emerald-700/20 rounded-lg p-4 border border-emerald-500/30">
            <View className="flex-row items-start">
              <MaterialIcons
                name="favorite"
                size={20}
                color="rgba(110, 231, 183, 0.8)"
                style={{ marginRight: 8, marginTop: 2 }}
              />
              <View className="flex-1">
                <Text className="text-emerald-100 font-semibold mb-1">
                  Honor Bounty
                </Text>
                <Text className="text-emerald-200/70 text-sm">
                  This bounty is for reputation and experience only. No payment will be processed.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Navigation Buttons */}
      <View
        className="px-4 pb-4 pt-3 bg-emerald-600 border-t border-emerald-700/50"
        style={{ marginBottom: BOTTOM_NAV_OFFSET + Math.max(insets.bottom, 8) }}
      >
        <View className="flex-row gap-3">
          <TouchableOpacity
            onPress={onBack}
            className="flex-1 bg-emerald-700/50 py-3 rounded-lg flex-row items-center justify-center"
            accessibilityLabel="Go back"
            accessibilityRole="button"
          >
            <MaterialIcons name="arrow-back" size={20} color="#fff" />
            <Text className="text-white font-semibold ml-2">Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleNext}
            disabled={!isValid}
            className={`flex-1 py-3 rounded-lg flex-row items-center justify-center ${
              isValid ? 'bg-emerald-500' : 'bg-emerald-700/30'
            }`}
            accessibilityLabel="Continue to next step"
            accessibilityRole="button"
            accessibilityState={{ disabled: !isValid }}
          >
            <Text
              className={`font-semibold mr-2 ${
                isValid ? 'text-white' : 'text-emerald-400/40'
              }`}
            >
              Next
            </Text>
            <MaterialIcons
              name="arrow-forward"
              size={20}
              color={isValid ? '#fff' : 'rgba(110, 231, 183, 0.4)'}
            />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}
