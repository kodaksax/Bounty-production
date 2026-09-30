/**
 * Onboarding Role Select
 * Second step, right after account creation (app/auth/sign-up-form.tsx) and
 * before style (app/onboarding/style.tsx): "What brings you to Bounty?"
 *
 * Role selection used to happen on the pre-auth welcome screen as two bare
 * CTA buttons ("Make today pay." / "I'd rather earn"), which the redesign
 * doc flagged as a problem — a CTA button doubling as a role picker reads as
 * an earning pitch, not a neutral choice, and there's no room under a button
 * for the one line that actually explains what each path means. Moving the
 * choice to its own screen after auth fixes both: it's not competing with
 * "sign up now," and each option gets a description line under it.
 *
 * Theme-aware like every other step: colors come from useAppThemeContext(),
 * never a pinned theme. This screen used to force darkTheme to match the
 * pre-auth funnel, which meant a light-mode user watched the app flip to dark
 * for three screens and back. The tokens carry the contrast instead — note
 * `continueButtonText` takes theme.background, which is dark-on-primary in
 * dark mode and light-on-primary in light mode without a second rule.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ONBOARDING_TOTAL_STEPS,
  OnboardingProgressDots,
} from '../../components/onboarding/OnboardingProgressDots';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

type Intent = 'poster' | 'hunter';

const ROLE_OPTIONS: {
  intent: Intent;
  icon: 'post-add' | 'explore';
  title: string;
  body: string;
}[] = [
  {
    intent: 'poster',
    icon: 'post-add',
    title: 'Make today pay.',
    body: 'Post what you need done and set your price.',
  },
  {
    intent: 'hunter',
    icon: 'explore',
    title: "I'd rather earn",
    body: 'Browse paid tasks near you and get picked.',
  },
];

export default function RoleSelectScreen() {
  const router = useRouter();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { data: onboardingData, updateData } = useOnboarding();
  const [selected, setSelected] = useState<Intent | null>(onboardingData.intent);


  const handleSelect = (intent: Intent) => {
    hapticFeedback.light();
    setSelected(intent);
  };

  const handleContinue = () => {
    if (!selected) return;
    hapticFeedback.light();
    analyticsService.trackEvent('role_selected', { role: selected, surface: 'onboarding' });
    updateData({ intent: selected });
    // Both roles go to payout setup next, not straight into their branch
    // (the poster task composer / hunter location prompt). Posters need a
    // payout account for refunds, hunters for earnings, so the step is shared
    // — see app/onboarding/payouts.tsx, which continues on to style.
    router.push('/onboarding/payouts');
  };

  // Reached from the style step (app/onboarding/style.tsx), which itself is
  // reached via router.replace() right after account creation (see
  // sign-up-form.tsx / username.tsx), so back history can be empty —
  // "back" would only be a same-screen no-op via the /onboarding gate. Only
  // show the button when it would actually go somewhere.
  const canGoBack = router.canGoBack();

  const handleBack = () => {
    hapticFeedback.light();
    router.back();
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {canGoBack && (
        <TouchableOpacity
          onPress={handleBack}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <MaterialIcons name="arrow-back" size={24} color={theme.text} />
        </TouchableOpacity>
      )}

      <OnboardingProgressDots
        total={ONBOARDING_TOTAL_STEPS}
        activeIndex={3}
        style={styles.dotsContainer}
      />

      <View style={styles.content}>
        <Text style={styles.heading} accessibilityRole="header">
          What brings you to Bounty?
        </Text>
        <Text style={styles.subheading}>Pick the one that fits today.</Text>

        <View style={styles.optionsList}>
          {ROLE_OPTIONS.map(option => {
            const isSelected = selected === option.intent;
            return (
              <TouchableOpacity
                key={option.intent}
                style={[
                  styles.optionCard,
                  { borderColor: isSelected ? theme.primary : theme.border },
                  isSelected && { backgroundColor: `${theme.primary}14` },
                ]}
                onPress={() => handleSelect(option.intent)}
                activeOpacity={0.85}
                accessibilityRole="radio"
                accessibilityState={{ checked: isSelected }}
                accessibilityLabel={`${option.title} — ${option.body}`}
              >
                <View style={[styles.optionIconWrap, { backgroundColor: theme.surfaceSecondary }]}>
                  <MaterialIcons name={option.icon} size={20} color={theme.primary} />
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.optionBody}>{option.body}</Text>
                </View>
                <MaterialIcons
                  name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                  size={22}
                  color={isSelected ? theme.primary : theme.textSecondary}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerHint}>You can switch or do both any time.</Text>
        <TouchableOpacity
          style={[
            styles.continueButton,
            { backgroundColor: theme.primary },
            !selected && styles.continueButtonDisabled,
          ]}
          onPress={handleContinue}
          disabled={!selected}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Continue"
          accessibilityState={{ disabled: !selected }}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  backButton: {
    alignSelf: 'flex-start',
    padding: 8,
    marginTop: 8,
    marginLeft: 16,
  },
  dotsContainer: {
    paddingTop: 16,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  heading: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
    color: theme.text,
    letterSpacing: -0.5,
  },
  subheading: {
    fontSize: 15,
    color: theme.textSecondary,
    marginTop: 8,
  },
  optionsList: {
    marginTop: 28,
    gap: 12,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1.5,
    borderRadius: theme.radius.xl,
    padding: 16,
  },
  optionIconWrap: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionTextWrap: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.text,
  },
  optionBody: {
    fontSize: 13,
    lineHeight: 18,
    color: theme.textSecondary,
    marginTop: 2,
  },
  footer: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 8,
    gap: 12,
  },
  footerHint: {
    fontSize: 13,
    color: theme.textSecondary,
    textAlign: 'center',
  },
  continueButton: {
    height: 56,
    borderRadius: theme.radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  continueButtonText: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.background,
  },
  });
}
