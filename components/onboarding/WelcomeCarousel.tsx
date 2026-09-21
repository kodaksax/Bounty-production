/**
 * Pre-auth onboarding welcome screen — swipeable carousel + a fixed CTA
 * footer, rendered by app/onboarding/welcome.tsx.
 *
 * The compromise that makes the carousel safe to ship: Sign Up sits on
 * frame one of every slide and never moves as the carousel is swiped, so
 * the carousel is optional reading, never a toll on the way to signing up.
 * Role selection (poster vs. hunter) is deliberately NOT asked here — it
 * moves to its own screen after auth, where it can carry a description line
 * under each option instead of doubling as an earning-vs-posting CTA choice
 * made before the visitor has even created an account.
 *
 * Dark-only. Colors come from theme tokens alone — no new hex here beyond
 * what darkTheme.ts already exposes (see lib/themes/colors.ts).
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useCallback, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import RNCarousel, { type ICarouselInstance } from 'react-native-reanimated-carousel';
import { CarouselGlow } from './CarouselGlow';
import { BrandingLogo } from '../ui/branding-logo';
import { welcomeCarouselStrings, type WelcomeCarouselSlide } from '../../lib/strings/welcomeCarousel';
import type { AppTheme } from '../../lib/themes/types';

const { slides, proofCard, trustRows } = welcomeCarouselStrings;

interface WelcomeCarouselProps {
  theme: AppTheme;
  insets: { top: number; bottom: number };
  onSignUpPress: () => void;
  onLoginPress: () => void;
  onHowItWorksPress: () => void;
  /** Fires once per swipe, after the carousel settles on a new slide. */
  onSlideChange?: (slide: WelcomeCarouselSlide, index: number) => void;
}

export function WelcomeCarousel({
  theme,
  insets,
  onSignUpPress,
  onLoginPress,
  onHowItWorksPress,
  onSlideChange,
}: WelcomeCarouselProps) {
  const styles = makeStyles(theme);
  const carouselRef = useRef<ICarouselInstance>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [stageHeight, setStageHeight] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);

  const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStageWidth(width);
    setStageHeight(height);
  }, []);

  const handleSnap = useCallback(
    (index: number) => {
      setActiveIndex(index);
      onSlideChange?.(slides[index], index);
    },
    [onSlideChange]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <CarouselGlow theme={theme} />

      <BrandingLogo size="medium" accessibilityRole="image" containerStyle={styles.logo} />

      <View style={styles.stage} onLayout={handleStageLayout}>
        {stageWidth > 0 && stageHeight > 0 && (
          <RNCarousel
            ref={carouselRef}
            width={stageWidth}
            height={stageHeight}
            data={slides}
            loop={false}
            onSnapToItem={handleSnap}
            renderItem={({ item, index }) => (
              <SlideContent slide={item} theme={theme} styles={styles} isActive={index === activeIndex} />
            )}
          />
        )}
      </View>

      <Dots theme={theme} total={slides.length} activeIndex={activeIndex} />

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.primaryButton, { backgroundColor: theme.primary }]}
          onPress={onSignUpPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Sign up for a new account"
        >
          <Text style={styles.primaryButtonText}>{welcomeCarouselStrings.signUpCta}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.loginButton}
          onPress={onLoginPress}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Log in to an existing account"
        >
          <Text style={styles.loginButtonText}>{welcomeCarouselStrings.logInCta}</Text>
        </TouchableOpacity>

        {/* Only on the trust slide — this is where a skeptical reader who's
            made it to the end of the carousel wants the deeper fees/escrow/
            disputes page, not a permanent fixture of every slide's footer. */}
        {slides[activeIndex]?.key === 'trust' && (
          <TouchableOpacity
            onPress={onHowItWorksPress}
            activeOpacity={0.7}
            accessibilityRole="link"
            accessibilityLabel="How Bounty works — fees, escrow and disputes"
            style={styles.howItWorksButton}
          >
            <Text style={styles.howItWorksText}>{welcomeCarouselStrings.howItWorksCta}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function SlideContent({
  slide,
  theme,
  styles,
  isActive,
}: {
  slide: WelcomeCarouselSlide;
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  isActive: boolean;
}) {
  return (
    <View style={styles.slide} accessibilityElementsHidden={!isActive} importantForAccessibility={isActive ? 'yes' : 'no-hide-descendants'}>
      <Text style={styles.headline} accessibilityRole="header">
        {slide.headline}
      </Text>

      {slide.key === 'escrow' && <EscrowIllustration theme={theme} />}
      {slide.key === 'proof' && <ProofMockCard theme={theme} styles={styles} />}
      {slide.key === 'trust' && <TrustRows theme={theme} styles={styles} />}

      {slide.body && slide.key !== 'proof' && <Text style={styles.body}>{slide.body}</Text>}
      {slide.key === 'proof' && <Text style={styles.caption}>{slide.body}</Text>}
    </View>
  );
}

function TrustRows({ theme, styles }: { theme: AppTheme; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.trustRows}>
      {trustRows.map(row => (
        <View key={row.title} style={styles.trustRow}>
          <MaterialIcons name={row.icon} size={20} color={theme.primary} style={styles.trustRowIcon} />
          <View style={styles.trustRowText}>
            <Text style={styles.trustRowTitle}>{row.title}</Text>
            <Text style={styles.trustRowBody}>{row.body}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function EscrowIllustration({ theme }: { theme: AppTheme }) {
  return (
    <View style={illustration.wrap}>
      <View
        style={[
          illustration.bill,
          illustration.billBack,
          { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
        ]}
      >
        <Text style={[illustration.billText, { color: theme.primaryLight }]}>$100</Text>
      </View>
      <View
        style={[
          illustration.bill,
          illustration.billFront,
          { backgroundColor: theme.surface, borderColor: theme.border },
        ]}
      >
        <Text style={[illustration.billText, { color: theme.primaryLight }]}>$100</Text>
      </View>
      <View style={[illustration.lockWrap, { backgroundColor: theme.background, borderColor: theme.primaryLight }]}>
        <MaterialIcons name="lock" size={28} color={theme.primaryLight} />
      </View>
    </View>
  );
}

function ProofMockCard({ theme, styles }: { theme: AppTheme; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.proofCard} accessibilityRole="none">
      <View style={styles.proofCardTopRow}>
        <View style={[styles.proofBadge, { backgroundColor: theme.completed }]}>
          <Text style={styles.proofBadgeText}>{proofCard.statusBadge}</Text>
        </View>
        <Text style={styles.proofPaidOut}>{proofCard.paidOut}</Text>
      </View>

      <View style={styles.proofCardMainRow}>
        <Text style={styles.proofTitle} numberOfLines={2}>
          {proofCard.taskTitle}
        </Text>
        <Text style={styles.proofAmount}>{proofCard.amount}</Text>
      </View>

      <View style={styles.proofPosterRow}>
        <View style={[styles.proofAvatar, { borderColor: theme.primary }]}>
          <Text style={styles.proofAvatarText}>{proofCard.posterInitial}</Text>
        </View>
        <Text style={styles.proofPosterName}>{proofCard.posterName}</Text>
        <Text style={styles.proofMetaDot}>·</Text>
        <Text style={styles.proofRating}>{proofCard.rating}</Text>
        <MaterialIcons name="verified" size={13} color={theme.primary} style={styles.proofVerifiedIcon} />
        <Text style={styles.proofMetaDot}>·</Text>
        <Text style={styles.proofDistance}>{proofCard.distance}</Text>
      </View>
    </View>
  );
}

function Dots({ theme, total, activeIndex }: { theme: AppTheme; total: number; activeIndex: number }) {
  return (
    <View
      style={dots.row}
      accessibilityRole="progressbar"
      accessibilityLabel={`Slide ${activeIndex + 1} of ${total}`}
      accessibilityValue={{ min: 1, max: total, now: activeIndex + 1 }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            dots.dot,
            {
              width: i === activeIndex ? 20 : 8,
              backgroundColor: i === activeIndex ? theme.primary : theme.border,
            },
          ]}
        />
      ))}
    </View>
  );
}

const illustration = StyleSheet.create({
  wrap: {
    width: '100%',
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  bill: {
    position: 'absolute',
    width: 168,
    height: 76,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  billBack: {
    top: 8,
    transform: [{ rotate: '-6deg' }],
  },
  billFront: {
    top: 40,
    transform: [{ rotate: '3deg' }],
  },
  billText: {
    fontSize: 20,
    fontWeight: '700',
  },
  lockWrap: {
    position: 'absolute',
    bottom: 0,
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const dots = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginBottom: 20,
  },
  dot: {
    height: 8,
    borderRadius: 4,
  },
});

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    logo: {
      alignSelf: 'center',
      marginTop: 24,
      marginBottom: 8,
    },
    stage: {
      flex: 1,
    },
    slide: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    headline: {
      fontSize: 30,
      lineHeight: 36,
      fontWeight: '700',
      color: theme.text,
      letterSpacing: -0.5,
      textAlign: 'center',
    },
    body: {
      fontSize: 16,
      lineHeight: 23,
      fontWeight: '500',
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 20,
    },
    caption: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 16,
    },
    proofCard: {
      width: '100%',
      marginTop: 28,
      backgroundColor: theme.surface,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.border,
      padding: 18,
    },
    proofCardTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    proofBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: theme.radius.full,
    },
    proofBadgeText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.4,
      color: theme.foreground,
    },
    proofPaidOut: {
      fontSize: 12,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    proofCardMainRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginTop: 12,
      gap: 12,
    },
    proofTitle: {
      flex: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: '700',
      color: theme.text,
    },
    proofAmount: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.primaryLight,
    },
    proofPosterRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 14,
      gap: 6,
    },
    proofAvatar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 2,
    },
    proofAvatarText: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.text,
    },
    proofPosterName: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.text,
    },
    proofRating: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    proofVerifiedIcon: {
      marginLeft: -2,
    },
    proofDistance: {
      fontSize: 13,
      fontWeight: '500',
      color: theme.textSecondary,
    },
    proofMetaDot: {
      fontSize: 13,
      color: theme.textSecondary,
    },
    trustRows: {
      width: '100%',
      marginTop: 28,
      gap: 20,
    },
    trustRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    trustRowIcon: {
      marginTop: 2,
    },
    trustRowText: {
      flex: 1,
    },
    trustRowTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: theme.text,
    },
    trustRowBody: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: '500',
      color: theme.textSecondary,
      marginTop: 2,
    },
    howItWorksButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 4,
    },
    howItWorksText: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      textDecorationLine: 'underline',
    },
    footer: {
      gap: 12,
      paddingHorizontal: 24,
    },
    primaryButton: {
      height: 56,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontSize: 18,
      fontWeight: '700',
      // theme.background, not a new near-black hex — every color here comes
      // from a shipped token (see this file's top comment).
      color: theme.background,
    },
    loginButton: {
      height: 56,
      borderRadius: theme.radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: theme.border,
    },
    loginButtonText: {
      color: theme.text,
      fontSize: 16,
      fontWeight: '600',
    },
  });
}
