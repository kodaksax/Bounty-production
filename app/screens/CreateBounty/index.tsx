import { StepperHeader } from 'app/components/StepperHeader';
import { useBountyDraft } from 'app/hooks/useBountyDraft';
import { StepCoreIdea } from 'app/screens/CreateBounty/StepCoreIdea';
import { StepCompensation } from 'app/screens/CreateBounty/StepCompensation';
import { StepLocation } from 'app/screens/CreateBounty/StepLocation';
import { bountyService } from 'app/services/bountyService';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ErrorBanner } from 'components/error-banner';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { useFormSubmission } from 'hooks/useFormSubmission';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
  onStepChange?: (step: number) => void;
}

const TOTAL_STEPS = 3;
const STEP_TITLES = [
  'The Core Idea',
  'The Reward',
  'Location (Optional)',
];

export function CreateBountyFlow({ onComplete, onCancel, onStepChange }: CreateBountyFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const { draft, saveDraft, clearDraft, isLoading } = useBountyDraft();
  const insets = useSafeAreaInsets();
  
  // Use form submission hook with debouncing
  const { submit, isSubmitting, error: submitError, reset } = useFormSubmission(
    async () => {
      // Create the bounty (offline support built-in)
      const result = await bountyService.createBounty(draft);

      if (!result) {
        throw new Error('Failed to create bounty');
      }

      // Clear draft on success
      await clearDraft();

      // Check if we're online to show appropriate message
      const { offlineQueueService } = await import('lib/services/offline-queue-service');
      const isOnline = offlineQueueService.getOnlineStatus();

      // Show success message
      Alert.alert(
        isOnline ? 'Bounty Posted! 🎉' : 'Bounty Queued! 📤',
        isOnline 
          ? 'Your bounty has been posted successfully. Hunters will be able to see it and apply.'
          : 'You\'re offline. Your bounty will be posted automatically when you reconnect.',
        [
          {
            text: isOnline ? 'View Bounty' : 'OK',
            onPress: () => {
              if (onComplete) {
                onComplete(result.id.toString());
              }
            },
          },
        ]
      );
    },
    {
      debounceMs: 1000,
      onError: (error) => {
        const userError = getUserFriendlyError(error);
        Alert.alert(
          userError.title,
          userError.message + '\n\nYour draft has been saved. Please try again.',
          [{ text: 'OK' }]
        );
      },
    }
  );

  // Auto-save draft whenever it changes
  useEffect(() => {
    if (!isLoading) {
      // Draft is already saved via saveDraft calls in step components
    }
  }, [draft, isLoading]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      const next = currentStep + 1;
      setCurrentStep(next);
    } else if (currentStep === TOTAL_STEPS) {
      // Submit on the last step
      handleSubmit();
    }
  };

  const handleSubmit = async () => {
    await submit();
  };

  const handleBack = () => {
    if (currentStep > 1) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      'Discard Draft?',
      'Your progress will be saved. You can return to this draft anytime.',
      [
        { text: 'Keep Editing', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: () => {
            if (onCancel) onCancel();
          },
        },
      ]
    );
  };

  // Notify consumer on initial mount and whenever currentStep changes.
  useEffect(() => {
    onStepChange?.(currentStep);
  }, [currentStep, onStepChange]);

  if (isLoading) {
    return (
      <View className="flex-1 bg-emerald-600 items-center justify-center">
        <ActivityIndicator size="large" color="#fff" />
        <Text className="text-white mt-4">Loading draft...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-emerald-600"
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={insets.top}
    >
      <View className="flex-1">
        {/* Inline Stepper (no duplicate app header) */}
        <View className="px-0" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <StepperHeader
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            stepTitle={STEP_TITLES[currentStep - 1]}
          />
        </View>

        {/* Step Content */}
        <View className="flex-1">
          {currentStep === 1 && (
            <StepCoreIdea
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={undefined}
            />
          )}
          {currentStep === 2 && (
            <StepCompensation
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 3 && (
            <StepLocation
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
              isSubmitting={isSubmitting}
              onSubmit={submit}
            />
          )}
        </View>

        {/* Error Display */}
        {submitError && (
          <View className="px-4 pb-4">
            <ErrorBanner
              error={getUserFriendlyError(submitError)}
              onDismiss={reset}
              onAction={submitError ? () => submit(draft) : undefined}
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default CreateBountyFlow;
