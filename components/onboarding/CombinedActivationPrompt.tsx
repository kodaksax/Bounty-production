import { MaterialIcons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { OnboardingProgressDots } from './OnboardingProgressDots';
import { PreviewCardRow } from './HunterLocationPrompt';
import { getPreviewCards } from './previewBounties';
import { Skeleton } from '../ui/skeleton';
import { hapticFeedback } from '../../lib/haptic-feedback';
import type { Bounty } from '../../lib/services/database.types';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';

type CombinedActivationPromptProps = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  /** Same pre-location preview fetch HunterLocationPrompt uses; null = still loading. */
  recentBounties: Bounty[] | null;
  onChoosePoster: () => void;
  onChooseHunter: () => void;
  onSkip: () => void;
  onBack: () => void;
};

/**
 * 'onboarding-skip-role-selection' PostHog experiment, test arm only.
 * Replaces welcome.tsx's upfront poster/hunter buttons: shown after sign-in
 * instead of the generic ProfileDetailsForm so a fast role signal (which
 * card gets tapped) is still available for the primary/secondary metrics.
 * Picking a card just sets onboardingData.intent — details.tsx then falls
 * through to the existing, unmodified poster/hunter branches.
 */
export function CombinedActivationPrompt({
  theme,
  styles,
  insets,
  recentBounties,
  onChoosePoster,
  onChooseHunter,
  onSkip,
  onBack,
}: CombinedActivationPromptProps) {
  const isLoadingPreview = recentBounties === null;
  const previewCards = getPreviewCards(recentBounties);
  const local = makeLocalStyles(theme);

  const handleChoosePoster = () => {
    hapticFeedback.light();
    onChoosePoster();
  };

  const handleChooseHunter = () => {
    hapticFeedback.light();
    onChooseHunter();
  };

  const handleBack = () => {
    hapticFeedback.light();
    onBack();
  };

  const handleSkip = () => {
    onSkip();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.stepBackRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={local.content}>
        <OnboardingProgressDots total={4} activeIndex={2} />

        <Text style={styles.hunterHeading}>What brings you{'\n'}to Bounty?</Text>

        <TouchableOpacity
          style={[local.choiceCard, { borderColor: theme.border }]}
          onPress={handleChoosePoster}
          accessibilityRole="button"
          accessibilityLabel="Post a task — hire someone nearby"
        >
          <MaterialIcons name="check-circle-outline" size={28} color={theme.primaryLight ?? theme.primary} />
          <View style={local.choiceCardText}>
            <Text style={[local.choiceCardTitle, { color: theme.text }]}>Post a task</Text>
            <Text style={[local.choiceCardSubtitle, { color: theme.textSecondary }]}>
              Get something done — you set the price
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[local.choiceCard, { borderColor: theme.border }]}
          onPress={handleChooseHunter}
          accessibilityRole="button"
          accessibilityLabel="Browse bounties nearby — earn money"
        >
          <MaterialIcons name="explore" size={28} color={theme.primaryLight ?? theme.primary} />
          <View style={local.choiceCardText}>
            <Text style={[local.choiceCardTitle, { color: theme.text }]}>Browse bounties nearby</Text>
            <Text style={[local.choiceCardSubtitle, { color: theme.textSecondary }]}>
              Start earning — claim paid tasks near you
            </Text>
          </View>
        </TouchableOpacity>

        {isLoadingPreview ? (
          <Skeleton style={{ height: 60, borderRadius: 16, marginTop: 8 }} />
        ) : (
          previewCards
            .slice(0, 1)
            .map((card, index) => <PreviewCardRow key={index} card={card} styles={styles} />)
        )}

        <View style={styles.hunterSpacer} />

        <TouchableOpacity
          style={styles.skipLink}
          onPress={handleSkip}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeLocalStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      flex: 1,
      paddingHorizontal: 24,
    },
    choiceCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderRadius: 16,
      padding: 20,
      marginBottom: 16,
      gap: 16,
    },
    choiceCardText: {
      flex: 1,
    },
    choiceCardTitle: {
      fontSize: 18,
      fontWeight: '700',
    },
    choiceCardSubtitle: {
      fontSize: 14,
      marginTop: 2,
    },
  });
}

export default CombinedActivationPrompt;
