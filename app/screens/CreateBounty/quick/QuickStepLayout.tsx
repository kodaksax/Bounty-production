import { MaterialIcons } from '@expo/vector-icons';
import React, { useContext, useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAppThemeContext } from '../../../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../../../lib/themes/types';

/**
 * Direction of the step change: 1 when moving forward, -1 when moving back.
 * CreateBountyFlow provides it; each step's layout reads it on mount to decide
 * which side to slide in from. A context keeps this out of every step's props.
 */
export const StepDirectionContext = React.createContext<number>(1);

// How far a step travels while fading in. A partial slide (rather than a full
// screen width) keeps the transition quick and stops the text from streaking.
const SLIDE_DISTANCE = Math.round(Dimensions.get('window').width * 0.28);
const SLIDE_DURATION = 280;

interface QuickStepLayoutProps {
  step: number;
  totalSteps: number;
  /** Omit to hide the back control (step 1). */
  onBack?: () => void;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  ctaLabel: string;
  onCta: () => void;
  ctaDisabled?: boolean;
  ctaBusy?: boolean;
  /** Small muted line rendered just above the CTA. */
  footerNote?: string;
}

/**
 * Shared chrome for the quick post-a-bounty flow: progress bar + step counter,
 * large question heading, scrollable body, and a single full-width pill CTA
 * pinned to the bottom.
 *
 * The CTA is green when actionable and muted grey when disabled — the two
 * button states used throughout the flow.
 */
export function QuickStepLayout({
  step,
  totalSteps,
  onBack,
  title,
  subtitle,
  children,
  ctaLabel,
  onCta,
  ctaDisabled = false,
  ctaBusy = false,
  footerNote,
}: QuickStepLayoutProps) {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const progress = Math.max(0, Math.min(1, step / totalSteps));
  const ctaEnabled = !ctaDisabled && !ctaBusy;

  // Each step mounts fresh, so the entrance animation runs once here: start
  // offset to the side we came from, then settle to 0 while fading in.
  const direction = useContext(StepDirectionContext);
  const enter = useRef(new Animated.Value(direction)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 0,
      duration: SLIDE_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const translateX = enter.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-SLIDE_DISTANCE, 0, SLIDE_DISTANCE],
  });
  const opacity = enter.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [0, 1, 0],
  });

  return (
    <View style={styles.root}>
      {/* Progress row */}
      <View style={styles.progressRow}>
        {/* The slot is always reserved, so the progress bar keeps the same
            position and width on every step — only the arrow appears/disappears. */}
        <View style={styles.backSlot}>
          {onBack ? (
            <TouchableOpacity
              onPress={onBack}
              style={styles.backButton}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <MaterialIcons name="arrow-back" size={22} color={theme.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>

        <Text
          style={styles.stepCounter}
          accessibilityLabel={`Step ${step} of ${totalSteps}`}
        >
          {step}/{totalSteps}
        </Text>
      </View>

      {/* Everything below the progress row slides + fades; the bar itself
          stays put so it reads as a single continuous indicator. */}
      <Animated.View style={[styles.animated, { opacity, transform: [{ translateX }] }]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <View style={styles.body}>{children}</View>
        </ScrollView>

        {/* Bottom CTA */}
        <View style={styles.footer}>
        {footerNote ? <Text style={styles.footerNote}>{footerNote}</Text> : null}
        <TouchableOpacity
          onPress={onCta}
          disabled={!ctaEnabled}
          activeOpacity={0.85}
          style={[
            styles.cta,
            { backgroundColor: ctaEnabled ? theme.primary : theme.surfaceSecondary },
          ]}
          accessibilityRole="button"
          accessibilityLabel={ctaLabel}
          accessibilityState={{ disabled: !ctaEnabled, busy: ctaBusy }}
        >
          {ctaBusy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : null}
            <Text
              style={[
                styles.ctaLabel,
                { color: ctaEnabled ? '#ffffff' : theme.textSecondary, marginLeft: ctaBusy ? 8 : 0 },
              ]}
            >
              {ctaLabel}
            </Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

export default QuickStepLayout;

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    progressRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 4,
      gap: 12,
    },
    backSlot: {
      width: 40,
      height: 40,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    progressTrack: {
      flex: 1,
      height: 6,
      borderRadius: 3,
      backgroundColor: theme.surfaceSecondary,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: 3,
      backgroundColor: theme.primary,
    },
    stepCounter: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.textSecondary,
      minWidth: 34,
      textAlign: 'right',
    },
    animated: { flex: 1 },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    title: {
      fontSize: 26,
      lineHeight: 31,
      fontWeight: '800',
      letterSpacing: -0.4,
      color: theme.text,
    },
    subtitle: {
      marginTop: 6,
      fontSize: 15,
      lineHeight: 20,
      color: theme.textSecondary,
    },
    body: { marginTop: 18 },
    footer: { paddingHorizontal: 20, paddingTop: 6, paddingBottom: 10 },
    footerNote: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: 8,
    },
    cta: {
      flexDirection: 'row',
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ctaLabel: { fontSize: 17, fontWeight: '700' },
  });
}
