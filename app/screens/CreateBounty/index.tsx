import { MaterialIcons } from '@expo/vector-icons';
import { StepperHeader } from 'app/components/StepperHeader';
import { useBountyDraft } from 'app/hooks/useBountyDraft';
import { bountyService } from 'app/services/bountyService';
import { StepCompensation } from 'app/screens/CreateBounty/StepCompensation';
import { StepDetails } from 'app/screens/CreateBounty/StepDetails';
import { StepLocation } from 'app/screens/CreateBounty/StepLocation';
import { StepReview } from 'app/screens/CreateBounty/StepReview';
import { StepTitle } from 'app/screens/CreateBounty/StepTitle';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
}

const TOTAL_STEPS = 5;
const STEP_TITLES = [
  'Title & Category',
  'Details & Requirements',
  'Compensation',
  'Location & Visibility',
  'Review & Confirm',
];

export function CreateBountyFlow({ onComplete, onCancel }: CreateBountyFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { draft, saveDraft, clearDraft, isLoading } = useBountyDraft();
  const insets = useSafeAreaInsets();

  // Auto-save draft whenever it changes
  useEffect(() => {
    if (!isLoading) {
      // Draft is already saved via saveDraft calls in step components
    }
  }, [draft, isLoading]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
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

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // Check network connectivity
      const isOnline = await bountyService.checkConnectivity();
      if (!isOnline) {
        Alert.alert(
          'No Internet Connection',
          'Please check your connection and try again.',
          [{ text: 'OK' }]
        );
        setIsSubmitting(false);
        return;
      }

      // Create the bounty
      const result = await bountyService.createBounty(draft);

      if (!result) {
        throw new Error('Failed to create bounty');
      }

      // Clear draft on success
      await clearDraft();

      // Show success message
      Alert.alert(
        'Bounty Posted! 🎉',
        'Your bounty has been posted successfully. Hunters will be able to see it and apply.',
        [
          {
            text: 'View Bounty',
            onPress: () => {
              if (onComplete) {
                onComplete(result.id.toString());
              }
            },
          },
        ]
      );
    } catch (error) {
      console.error('Error submitting bounty:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      setSubmitError(errorMessage);

      Alert.alert(
        'Failed to Post Bounty',
        errorMessage + '\n\nYour draft has been saved. Please try again.',
        [{ text: 'OK' }]
      );
    } finally {
      setIsSubmitting(false);
    }
  };

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
        {/* Header */}
        <View
          className="bg-emerald-700 px-4 border-b border-emerald-600"
          style={{ paddingTop: insets.top + 12, paddingBottom: 12 }}
        >
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center">
              <MaterialIcons name="gps-fixed" size={24} color="#000" />
              <Text className="text-lg font-bold tracking-wider ml-2">BOUNTY</Text>
            </View>
            <TouchableOpacity
              onPress={handleCancel}
              accessibilityLabel="Cancel and exit"
              accessibilityRole="button"
            >
              <MaterialIcons name="close" size={24} color="#000" />
            </TouchableOpacity>
          </View>
          <StepperHeader
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            stepTitle={STEP_TITLES[currentStep - 1]}
          />
        </View>

        {/* Step Content */}
        <View className="flex-1">
          {currentStep === 1 && (
            <StepTitle
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={undefined}
            />
          )}
          {currentStep === 2 && (
            <StepDetails
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 3 && (
            <StepCompensation
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 4 && (
            <StepLocation
              draft={draft}
              onUpdate={saveDraft}
              onNext={handleNext}
              onBack={handleBack}
            />
          )}
          {currentStep === 5 && (
            <StepReview
              draft={draft}
              onSubmit={handleSubmit}
              onBack={handleBack}
              isSubmitting={isSubmitting}
            />
          )}
        </View>

        {/* Error Display */}
        {submitError && (
          <View className="bg-red-500/90 px-4 py-3">
            <Text className="text-white text-center">{submitError}</Text>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

export default CreateBountyFlow;
