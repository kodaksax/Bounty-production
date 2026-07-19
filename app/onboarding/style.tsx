/**
 * Onboarding Style Screen
 * Fourth step (poster/hunter) or third step (generic), inserted right after
 * sign-in and before the profile-details form: a fast, zero-cost
 * personalization moment that reuses the exact same BountyFormat picker as
 * Settings (lib/bounty-format-context.tsx) — no separate style system, no
 * duplicated persistence. See app/onboarding/username.tsx's totalStepsFor
 * for the matching step-count logic.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BountyFormatPreview } from '../../components/onboarding/BountyFormatPreview';
import { OnboardingProgressDots } from '../../components/onboarding/OnboardingProgressDots';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { type BountyFormat, useBountyFormat } from '../../lib/bounty-format-context';
import {
  BOUNTY_FORMAT_OPTIONS,
  formatForIndex,
  formatForScrollOffset,
  indexForFormat,
} from '../../lib/bounty-format-options';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';

// Generic (no intent) is a 4-step flow; poster/hunter branches are 5 steps —
// one more than before, now that this style step sits between sign-in and
// details. See done.tsx for the matching logic.
function totalStepsFor(intent: 'poster' | 'hunter' | null) {
  return intent ? 5 : 4;
}

export default function StyleScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme } = useAppThemeContext();
  const { data: onboardingData } = useOnboarding();
  const { bountyFormat, setBountyFormat } = useBountyFormat();
  const { prefersReducedMotion } = useAccessibleAnimation();
  const styles = makeStyles(theme);
  const scrollRef = useRef<ScrollView>(null);
  const [pageWidth, setPageWidth] = useState(0);
  // Set right before a chip-tap-triggered scrollTo, so the resulting
  // onMomentumScrollEnd (fired once that animation settles) doesn't
  // re-derive a selection from scroll position and clobber the tap's
  // explicit selection — the two are otherwise independent writers to the
  // same state and can disagree by a page on sub-pixel settle positions.
  const isProgrammaticScrollRef = useRef(false);
  // Whether the user has made their own selection yet this screen. Until
  // then, the browse strip's scroll position is free to auto-correct to
  // match `bountyFormat` (see the sync effect below) — this covers the
  // hydrated-preference case, since AsyncStorage resolves asynchronously
  // and can update `bountyFormat` after the strip has already mounted.
  // ScrollView's `contentOffset` prop only ever applies once, at initial
  // mount, so without this the strip could open on the wrong page for a
  // returning user. Once the user interacts, we stop auto-correcting so we
  // never fight an in-progress gesture.
  const hasUserInteractedRef = useRef(false);

  const totalSteps = totalStepsFor(onboardingData.intent);
  const initialIndex = indexForFormat(bountyFormat);

  useEffect(() => {
    analyticsService.trackEvent('onboarding_style_step_viewed');
    // Fire once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keeps the browse strip's scroll position aligned with `bountyFormat`
  // whenever that value changes for a reason other than the user directly
  // interacting with this screen (i.e. hydration resolving after mount).
  // Non-animated: this is a silent correction, not a selection change, so
  // it must not visibly slide or flicker.
  useEffect(() => {
    if (pageWidth <= 0 || hasUserInteractedRef.current) return;
    scrollRef.current?.scrollTo({ x: pageWidth * indexForFormat(bountyFormat), animated: false });
  }, [bountyFormat, pageWidth]);

  const handleLayout = (e: LayoutChangeEvent) => {
    setPageWidth(e.nativeEvent.layout.width);
  };

  const selectFormat = (format: BountyFormat, source: 'tap' | 'swipe') => {
    hasUserInteractedRef.current = true;
    if (format === bountyFormat) return;
    hapticFeedback.light();
    setBountyFormat(format);
    analyticsService.trackEvent('onboarding_style_selected', { format, source });
  };

  const handleChipPress = (index: number) => {
    const format = formatForIndex(index);
    if (!format) return;
    selectFormat(format, 'tap');
    // Only expect (and guard against) a settle event when the scroll is
    // actually animated — a non-animated jump fires no momentum event, so
    // there'd be nothing to consume the guard and it would wrongly swallow
    // the next real swipe.
    if (!prefersReducedMotion) {
      isProgrammaticScrollRef.current = true;
    }
    scrollRef.current?.scrollTo({ x: pageWidth * index, animated: !prefersReducedMotion });
  };

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      return;
    }
    const format = formatForScrollOffset(e.nativeEvent.contentOffset.x, pageWidth);
    if (format) selectFormat(format, 'swipe');
  };

  const handleContinue = () => {
    router.push('/onboarding/details');
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <OnboardingProgressDots total={totalSteps} activeIndex={1} style={styles.dotsContainer} />

      <Text style={styles.heading}>Make Bounty feel like yours</Text>
      <Text style={styles.subheading}>
        Pick how bounties show up in your feed. You can change this anytime in Settings.
      </Text>

      {/* The single authoritative preview — bound directly to bountyFormat,
          so it can never disagree with the chip highlight or the persisted
          selection. Updates in the same render pass as any selection,
          whether that came from a chip tap, a swipe below, or hydration. */}
      <View style={styles.previewWrap}>
        <BountyFormatPreview format={bountyFormat} theme={theme} />
      </View>

      <View style={styles.pagerWrap} onLayout={handleLayout}>
        {pageWidth > 0 && (
          <ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            contentOffset={{ x: pageWidth * initialIndex, y: 0 }}
            accessibilityLabel="Swipe to browse each layout's name and description"
          >
            {BOUNTY_FORMAT_OPTIONS.map((option) => (
              <View key={option.value} style={[styles.page, { width: pageWidth }]}>
                <Text style={styles.optionLabel}>
                  {option.icon} {option.label}
                </Text>
                <Text style={styles.optionDescription}>{option.description}</Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      <View style={styles.chipRow} accessibilityRole="radiogroup">
        {BOUNTY_FORMAT_OPTIONS.map((option, index) => {
          const active = bountyFormat === option.value;
          return (
            <TouchableOpacity
              key={option.value}
              onPress={() => handleChipPress(index)}
              style={active ? styles.chipActive : styles.chipInactive}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${option.label} layout`}
              accessibilityHint={option.description}
            >
              <Text style={styles.chipIcon}>{option.icon}</Text>
              <Text style={active ? styles.chipLabelActive : styles.chipLabelInactive}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.actionContainer}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={handleContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue"
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
      paddingHorizontal: 24,
    },
    dotsContainer: {
      paddingTop: 16,
    },
    heading: {
      fontSize: 26,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
      marginTop: 20,
    },
    subheading: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      paddingHorizontal: 8,
    },
    previewWrap: {
      marginTop: 20,
    },
    pagerWrap: {
      flex: 1,
      marginTop: 12,
      justifyContent: 'center',
    },
    page: {
      paddingHorizontal: 4,
    },
    optionLabel: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
    },
    optionDescription: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 4,
      paddingHorizontal: 16,
    },
    chipRow: {
      flexDirection: 'row',
      gap: 8,
      marginTop: 8,
    },
    chipActive: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: theme.primary,
      borderWidth: 1,
      borderColor: theme.primary,
    },
    chipInactive: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
    },
    chipIcon: {
      fontSize: 16,
    },
    chipLabelActive: {
      fontSize: 12,
      fontWeight: '600',
      color: '#ffffff',
      marginTop: 2,
    },
    chipLabelInactive: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.text,
      marginTop: 2,
    },
    actionContainer: {
      paddingTop: 20,
      paddingBottom: 24,
    },
    continueButton: {
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      alignItems: 'center',
    },
    continueButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
  });
}
