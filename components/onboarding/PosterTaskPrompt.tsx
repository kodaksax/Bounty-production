import { MaterialIcons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { OnboardingProgressDots } from './OnboardingProgressDots';
import { hapticFeedback } from '../../lib/haptic-feedback';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import type { AppTheme } from '../../lib/themes/types';

type PosterTaskPromptProps = {
  theme: AppTheme;
  styles: OnboardingDetailsStyles;
  insets: { top: number; bottom: number };
  taskDescription: string;
  onChangeTaskDescription: (taskDescription: string) => void;
  price: string;
  onChangePrice: (price: string) => void;
  schedule: 'saturday' | 'flexible' | null;
  onChangeSchedule: (schedule: 'saturday' | 'flexible' | null) => void;
  onNext: () => void;
  posting: boolean;
  onSkip: () => void;
  /** Subtle secondary escape hatch for someone who meant to pick Hunter on welcome.tsx. */
  onSwitchToHunter: () => void;
  /** Returns to the style step. Matches the back button ProfileDetailsForm/PosterFundingScreen already have. */
  onBack: () => void;
};

// Poster branch, step 2 of 4: sign in -> [this] -> fund/confirm -> done.
export function PosterTaskPrompt({
  theme,
  styles,
  insets,
  taskDescription,
  onChangeTaskDescription,
  price,
  onChangePrice,
  schedule,
  onChangeSchedule,
  onNext,
  posting,
  onSkip,
  onSwitchToHunter,
  onBack,
}: PosterTaskPromptProps) {
  const handleNext = () => {
    hapticFeedback.light();
    onNext();
  };

  const handleBack = () => {
    hapticFeedback.light();
    onBack();
  };

  const handleSwitchToHunter = () => {
    hapticFeedback.light();
    onSwitchToHunter();
  };

  const handleSchedulePress = (value: 'saturday' | 'flexible') => {
    hapticFeedback.light();
    onChangeSchedule(schedule === value ? null : value);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.stepBackRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
      </View>

      <OnboardingProgressDots total={5} activeIndex={2} style={styles.progressContainer} />

      <View style={[styles.posterContent, { paddingBottom: insets.bottom }]}>
        <Text style={styles.posterHeading} accessibilityRole="header">
          What do you need done?
        </Text>

        <View style={styles.dottedBox}>
          <Text style={styles.dottedBoxLabel}>What + when + where</Text>
          <TextInput
            style={styles.dottedBoxInput}
            value={taskDescription}
            onChangeText={onChangeTaskDescription}
            placeholder="Help me move a couch, Saturday morning, Mission District"
            placeholderTextColor={theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary}
            multiline
            editable={!posting}
            accessibilityLabel="Describe what you need done, when, and where"
          />
        </View>

        <View style={styles.priceBox}>
          <Text style={styles.priceBoxHint}>↓ drafted after you type · tap to change</Text>

          <View style={styles.priceInputRow}>
            <View style={styles.priceInputPill}>
              <Text style={styles.priceCurrency}>$</Text>
              <TextInput
                style={styles.priceInput}
                value={price}
                onChangeText={onChangePrice}
                placeholder="50"
                placeholderTextColor={theme.textDisabled}
                keyboardType="numeric"
                accessibilityLabel="Bounty price in dollars"
              />
              <MaterialIcons name="edit" size={16} color={theme.textSecondary} />
            </View>
            <Text style={styles.priceSimilarText}>similar: $40–60</Text>
          </View>

          <View style={styles.priceChipsRow}>
            <TouchableOpacity
              style={[styles.priceChip, schedule === 'saturday' && styles.priceChipSelected]}
              onPress={() => handleSchedulePress('saturday')}
              accessibilityRole="button"
              accessibilityLabel="Saturday"
              accessibilityState={{ selected: schedule === 'saturday' }}
            >
              <Text
                style={[styles.priceChipText, schedule === 'saturday' && styles.priceChipTextSelected]}
              >
                Saturday
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.priceChip, schedule === 'flexible' && styles.priceChipSelected]}
              onPress={() => handleSchedulePress('flexible')}
              accessibilityRole="button"
              accessibilityLabel="Flexible timing"
              accessibilityState={{ selected: schedule === 'flexible' }}
            >
              <Text
                style={[styles.priceChipText, schedule === 'flexible' && styles.priceChipTextSelected]}
              >
                Flexible
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.posterActions}>
        <TouchableOpacity
          style={[styles.nextButton, { backgroundColor: theme.primary }]}
          onPress={handleNext}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Post bounty, free to post"
          accessibilityState={{ disabled: posting, busy: posting }}
        >
          {posting ? (
            <ActivityIndicator color="#052e1b" style={{ marginRight: 8 }} />
          ) : null}
          <Text style={styles.nextButtonText}>
            {posting ? 'Posting…' : 'Post Bounty - free to post'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.skipLink}
          onPress={onSkip}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Skip for now"
        >
          <Text style={styles.skipLinkText}>Skip for now</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.switchPathLink}
          onPress={handleSwitchToHunter}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Switch to browsing and earning instead"
        >
          <Text style={styles.switchPathLinkText}>Looking to earn instead? Switch to Hunter</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
