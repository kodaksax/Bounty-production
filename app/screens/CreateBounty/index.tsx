import { StepperHeader } from 'app/components/StepperHeader';
import { useBountyDraft } from 'app/hooks/useBountyDraft';
import { StepCompensation } from 'app/screens/CreateBounty/StepCompensation';
import { StepDetails } from 'app/screens/CreateBounty/StepDetails';
import { StepLocation } from 'app/screens/CreateBounty/StepLocation';
import { StepReview } from 'app/screens/CreateBounty/StepReview';
import { StepTitle } from 'app/screens/CreateBounty/StepTitle';
import { bountyService } from 'app/services/bountyService';
import { ErrorBanner } from 'components/error-banner';
import { EmailVerificationBanner } from 'components/ui/email-verification-banner';
import { useAuthContext } from 'hooks/use-auth-context';
import { useEmailVerification } from 'hooks/use-email-verification';
import { useBackHandler } from 'hooks/useBackHandler';
import { useFormSubmission } from 'hooks/useFormSubmission';
import { getInsufficientBalanceMessage, validateBalance } from 'lib/utils/bounty-validation';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { useWallet } from 'lib/wallet-context';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CreateBountyFlowProps {
  onComplete?: (bountyId: string) => void;
  onCancel?: () => void;
  onStepChange?: (step: number) => void;
}

const TOTAL_STEPS = 5;
const STEP_TITLES = [
  'Title & Category',
  'Details & Requirements',
  'Compensation',
  'Location & Visibility',
  'Review & Confirm',
];

export function CreateBountyFlow({ onComplete, onCancel, onStepChange }: CreateBountyFlowProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const { session } = useAuthContext();
  const { draft, saveDraft, clearDraft, isLoading } = useBountyDraft(session?.user?.id);
  const insets = useSafeAreaInsets();
  const { withdraw, balance } = useWallet();
  const { isEmailVerified, canPostBounties, userEmail } = useEmailVerification();

  // Use form submission hook with debouncing
  const { submit, isSubmitting, error: submitError, reset } = useFormSubmission(
    async () => {
      // Email verification gate: Block posting if email not verified
      if (!canPostBounties) {
        throw new Error('Please verify your email address before posting bounties. Check your inbox for the verification link.');
      }

      // Check balance before posting using shared validation (for non-honor bounties)
      if (!validateBalance(draft.amount, balance, draft.isForHonor)) {
        throw new Error(getInsufficientBalanceMessage(draft.amount, balance));
      }

      // Create the bounty first (before deducting funds to prevent loss on failure)
      const result = await bountyService.createBounty(draft);

      if (!result) {
        throw new Error('Failed to create bounty');
      }

      // Only deduct funds after successful bounty creation (for non-honor bounties)
      if (!draft.isForHonor && draft.amount > 0) {
        const withdrawSuccess = await withdraw(draft.amount, {
          method: 'bounty_posted',
          title: draft.title,
          bounty_id: result.id.toString(),
          status: 'completed'
        });

        if (!withdrawSuccess) {
          try {
            await bountyService.deleteBounty(result.id);
            console.error('Bounty creation rolled back due to failed fund deduction.');
          } catch (deleteErr) {
            console.error('Failed to delete bounty after withdrawal failure:', deleteErr);
            throw new Error('Failed to deduct funds and could not roll back bounty. Please contact support.');
          }
          throw new Error('Failed to deduct funds from wallet. Your bounty was not posted.');
        }
      }

      // Clear draft on success
      await clearDraft();

      const { offlineQueueService } = await import('lib/services/offline-queue-service');
      const isOnline = offlineQueueService.getOnlineStatus();

      if (Platform.OS === 'web') {
        // Alert.alert is a no-op on web — navigate immediately after success
        if (onComplete) {
          onComplete(result.id.toString());
        }
      } else {
        Alert.alert(
          isOnline ? 'Bounty Posted! 🎉' : 'Bounty Queued! 📋',
          isOnline
            ? 'Your bounty has been posted successfully. Hunters will be able to see it and apply.'
            : "You're offline. Your bounty will be posted automatically when you reconnect.",
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
      }
    },
    {
      debounceMs: 1000,
      onError: (error) => {
        const userError = getUserFriendlyError(error);
        // Always log the raw error so it appears in Metro/device logs regardless of platform
        console.error('[CreateBounty] bounty_create failed:', error?.message ?? error);
        if (Platform.OS === 'web') {
          // Error is already surfaced via the ErrorBanner component below
        } else {
          Alert.alert(
            userError.title,
            userError.message + '\n\nYour draft has been saved. Please try again.',
            [{ text: 'OK' }]
          );
        }
      },
    }
  );

  useEffect(() => {
    if (!isLoading) {
      // Draft is already saved via saveDraft calls in step components
    }
  }, [draft, isLoading]);

  const handleNext = () => {
    if (currentStep < TOTAL_STEPS) {
      const next = currentStep + 1;
      setCurrentStep(next);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      const prev = currentStep - 1;
      setCurrentStep(prev);
    }
  };

  const handleCancel = () => {
    if (Platform.OS === 'web') {
      // Alert.alert is a no-op on web — call onCancel directly
      if (onCancel) onCancel();
    } else {
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
    }
  };

  useBackHandler(() => {
    if (currentStep > 1) {
      handleBack();
      return true;
    }
    handleCancel();
    return true;
  }, true);

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
        {!isEmailVerified && (
          <EmailVerificationBanner email={userEmail} />
        )}

        <View className="px-0" style={{ paddingTop: 8, paddingBottom: 8 }}>
          <StepperHeader
            currentStep={currentStep}
            totalSteps={TOTAL_STEPS}
            stepTitle={STEP_TITLES[currentStep - 1]}
          />
        </View>

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
              onSubmit={submit}
              onBack={handleBack}
              isSubmitting={isSubmitting}
            />
          )}
        </View>

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
