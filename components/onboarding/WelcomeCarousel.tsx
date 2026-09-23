/**
 * Pre-auth onboarding welcome screen — a self-rotating stage + a fixed CTA
 * footer, rendered by app/onboarding/welcome.tsx.
 *
 * The stage is not swipeable and has no pager dots: it cycles through the
 * slides on its own, sliding each one in from the right as the last one
 * leaves to the left — the look of a swipe without the gesture. Every slide
 * stays mounted so
 * the proof slide's card roll keeps its place rather than restarting from
 * the first card each time the stage comes back around to it.
 *
 * The compromise that makes the stage safe to ship: Sign Up sits on frame one
 * of every slide and never moves as the stage rotates, so the copy is
 * optional reading, never a toll on the way to signing up.
 * Role selection (poster vs. hunter) is deliberately NOT asked here — it
 * moves to its own screen after auth, where it can carry a description line
 * under each option instead of doubling as an earning-vs-posting CTA choice
 * made before the visitor has even created an account.
 *
 * Dark-only. Colors come from theme tokens alone — no new hex here beyond
 * what darkTheme.ts already exposes (see lib/themes/colors.ts).
 */

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { CarouselGlow } from './CarouselGlow';
import { BrandingLogo } from '../ui/branding-logo';
import {
  welcomeCarouselStrings,
  welcomeProofExampleCards,
  type WelcomeCarouselSlide,
} from '../../lib/strings/welcomeCarousel';
import type { AppTheme } from '../../lib/themes/types';

const { slides, proofCard, trustRows } = welcomeCarouselStrings;

// How long each slide holds before the stage rotates to the next, and how
// long the slide-across takes.
const SLIDE_HOLD_MS = 3600;
const SLIDE_TRANSITION_MS = 420;

// Fixed row height for the rotating proof cards — see RotatingProofCards.
// The card roll is quicker than the slide hold so the proof slide turns over
// a card or two each time the stage rests on it; because slides stay mounted,
// the roll picks up where it left off rather than restarting at card one.
const CARD_HEIGHT = 224;
const CARD_HOLD_MS = 1700;
const CARD_ROLL_MS = 460;

interface WelcomeCarouselProps {
  theme: AppTheme;
  insets: { top: number; bottom: number };
  onSignUpPress: () => void;
  onLoginPress: () => void;
  onHowItWorksPress: () => void;
  /** Fires once each time the stage rotates to a new slide. */
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [stageWidth, setStageWidth] = useState(0);
  const reduceMotion = useReducedMotion();

  // The travel distance for the slide-across is one stage width, so nothing
  // can be positioned until the stage has been measured.
  const handleStageLayout = useCallback((event: LayoutChangeEvent) => {
    setStageWidth(event.nativeEvent.layout.width);
  }, []);

  // onSlideChange is read through a ref so that a caller passing a fresh
  // closure each render doesn't restart the rotation timer mid-slide.
  const onSlideChangeRef = useRef(onSlideChange);
  onSlideChangeRef.current = onSlideChange;

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex(current => {
        const next = (current + 1) % slides.length;
        onSlideChangeRef.current?.(slides[next], next);
        return next;
      });
    }, SLIDE_HOLD_MS);

    return () => clearInterval(timer);
  }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom + 16 }]}>
      <CarouselGlow theme={theme} />

      <BrandingLogo size="medium" accessibilityRole="image" containerStyle={styles.logo} />

      {/* Every slide stays mounted, parked one stage-width apart; the stage
          clips whatever is off to the side. pointerEvents is off throughout —
          the stage is a display, not a control, and nothing on it is tappable. */}
      <View style={styles.stage} pointerEvents="none" onLayout={handleStageLayout}>
        {slides.map((slide, index) => (
          <SlidingSlide
            key={slide.key}
            index={index}
            activeIndex={activeIndex}
            count={slides.length}
            stageWidth={stageWidth}
            reduceMotion={reduceMotion}
          >
            <SlideContent
              slide={slide}
              theme={theme}
              styles={styles}
              isActive={index === activeIndex}
            />
          </SlidingSlide>
        ))}
      </View>

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

        {/* Permanent, where it used to be shown only on the trust slide: now
            that the stage rotates itself and can't be held still, a link that
            appeared and vanished every few seconds could disappear out from
            under a finger already reaching for it — and its coming and going
            resized the footer under the two CTAs above it. */}
        <TouchableOpacity
          onPress={onHowItWorksPress}
          activeOpacity={0.7}
          accessibilityRole="link"
          accessibilityLabel="How Bounty works — fees, escrow and disputes"
          style={styles.howItWorksButton}
        >
          <Text style={styles.howItWorksText}>{welcomeCarouselStrings.howItWorksCta}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/**
 * Parks one slide on the stage and slides it across as the rotation moves on:
 * the outgoing slide travels off to the left while the incoming one arrives
 * from the right, which reads as a swipe nobody had to make.
 *
 * Position is the slide's distance from the active one, wrapped so the last
 * slide's neighbour is the first. That wrap is what makes the loop back to
 * slide one look like every other step instead of rewinding the stack.
 *
 * A slide animates only when it is adjacent to the active one BOTH before and
 * after the step — that is, when it is genuinely sliding on or off the stage.
 * Any other move is a slide being re-parked on the far side, and re-parking
 * must be instant: animated, it would drag its text across the stage for the
 * whole transition, arriving behind the slide that is actually coming in.
 * Slides that aren't adjacent are hidden outright, so nothing can linger
 * where it shouldn't even for a frame.
 */
function SlidingSlide({
  index,
  activeIndex,
  count,
  stageWidth,
  reduceMotion,
  children,
}: {
  index: number;
  activeIndex: number;
  count: number;
  stageWidth: number;
  reduceMotion: boolean;
  children: ReactNode;
}) {
  const offset = useSharedValue(0);
  const visible = useSharedValue(0);
  // null until the slide has been placed once: its first placement is a jump,
  // not a slide, or every slide would animate out from under the first one on
  // mount.
  const lastDistance = useRef<number | null>(null);

  useEffect(() => {
    if (!stageWidth) return;

    const distance = wrappedDistance(index, activeIndex, count);
    const previous = lastDistance.current;
    lastDistance.current = distance;

    const isAdjacent = Math.abs(distance) <= 1;
    const wasAdjacent = previous !== null && Math.abs(previous) <= 1;

    const target = distance * stageWidth;
    if (isAdjacent && wasAdjacent && !reduceMotion) {
      offset.value = withTiming(target, {
        duration: SLIDE_TRANSITION_MS,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      offset.value = target;
    }

    visible.value = isAdjacent ? 1 : 0;
  }, [index, activeIndex, count, stageWidth, reduceMotion, offset, visible]);

  const style = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateX: offset.value }],
  }));
  const isActive = index === activeIndex;

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, style]}
      accessibilityElementsHidden={!isActive}
      importantForAccessibility={isActive ? 'yes' : 'no-hide-descendants'}
    >
      {children}
    </Animated.View>
  );
}

/**
 * How many slides `index` sits ahead of (+) or behind (-) `activeIndex`, taking
 * the shorter way around the loop, so the step from the last slide to the
 * first is +1 like every other step rather than -(count - 1).
 *
 * With an even `count` the two directions tie at exactly count / 2; the tie
 * resolves to the positive (ahead) side, which is arbitrary but consistent —
 * a slide that far out is off-stage and hidden either way.
 */
function wrappedDistance(index: number, activeIndex: number, count: number): number {
  const forward = (index - activeIndex + count) % count;
  return forward > count / 2 ? forward - count : forward;
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
      {slide.key === 'proof' && <RotatingProofCards theme={theme} styles={styles} isActive={isActive} />}
      {slide.key === 'trust' && <TrustRows theme={theme} styles={styles} />}

      {slide.body && slide.key !== 'proof' && <Text style={styles.body}>{slide.body}</Text>}
      {slide.key === 'proof' && <Text style={styles.caption}>{slide.body}</Text>}
    </View>
  );
}

/**
 * Slot-machine roll through `welcomeProofExampleCards` on the `proof` slide,
 * in place of a single static card.
 *
 * The strip renders the cards plus a repeat of the first one, so the roll
 * past the last card lands on a visually identical frame and can be reset to
 * offset 0 inside the same animation — the loop never visibly snaps back.
 * Every card sits in a fixed CARD_HEIGHT slot; that constant is what makes
 * the offset arithmetic and the clipping window agree, so it has to change
 * alongside the card's padding and text sizes.
 *
 * Only rolls while the proof slide is the active one: a timer running behind
 * an off-screen slide would burn frames and desync the roll from what the
 * visitor actually sees when they swipe over.
 */
function RotatingProofCards({
  theme,
  styles,
  isActive,
}: {
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
  isActive: boolean;
}) {
  const strip = [...welcomeProofExampleCards, welcomeProofExampleCards[0]];
  const offset = useSharedValue(0);
  const indexRef = useRef(0);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!isActive || reduceMotion) return;

    const timer = setInterval(() => {
      const next = indexRef.current + 1;
      const wrapped = next >= welcomeProofExampleCards.length ? 0 : next;
      indexRef.current = wrapped;
      setVisibleIndex(wrapped);

      const roll = withTiming(-next * CARD_HEIGHT, {
        duration: CARD_ROLL_MS,
        easing: Easing.bezier(0.2, 0.9, 0.2, 1),
      });
      offset.value = wrapped === 0 ? withSequence(roll, withTiming(0, { duration: 0 })) : roll;
    }, CARD_HOLD_MS);

    return () => clearInterval(timer);
  }, [isActive, reduceMotion, offset]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateY: offset.value }] }));
  const visible = welcomeProofExampleCards[visibleIndex];

  return (
    <View
      style={styles.cardWindow}
      accessible
      accessibilityRole="text"
      // One card read at a time — the rest of the strip is clipped out of
      // sight and would otherwise all be announced at once.
      accessibilityLabel={`${visible.request} ${visible.amount}, ${visible.distance} away.`}
    >
      <Animated.View style={stripStyle} importantForAccessibility="no-hide-descendants">
        {strip.map((card, i) => (
          <View key={`${card.key}-${i}`} style={styles.cardSlot}>
            <ProofMockCard card={card} theme={theme} styles={styles} />
          </View>
        ))}
      </Animated.View>
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

function ProofMockCard({
  card,
  theme,
  styles,
}: {
  card: (typeof welcomeProofExampleCards)[number];
  theme: AppTheme;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.proofCard} accessibilityRole="none">
      <View style={styles.proofCardTopRow}>
        <View style={[styles.proofBadge, { backgroundColor: theme.completed }]}>
          <Text style={styles.proofBadgeText}>{proofCard.statusBadge}</Text>
        </View>
        <Text style={styles.proofPaidOut}>{proofCard.paidOut}</Text>
      </View>

      <View style={styles.proofCardMainRow}>
        <Text style={styles.proofTitle} numberOfLines={4}>
          {`\u201C${card.request}\u201D`}
        </Text>
        <Text style={styles.proofAmount}>{card.amount}</Text>
      </View>

      <View style={styles.proofPosterRow}>
        <View style={[styles.proofAvatar, { borderColor: theme.primary }]}>
          <Text style={styles.proofAvatarText}>{card.posterInitial}</Text>
        </View>
        <Text style={styles.proofPosterName}>{card.posterName}</Text>
        <Text style={styles.proofMetaDot}>·</Text>
        <Text style={styles.proofRating}>{proofCard.rating}</Text>
        <MaterialIcons name="verified" size={13} color={theme.primary} style={styles.proofVerifiedIcon} />
        <Text style={styles.proofMetaDot}>·</Text>
        <Text style={styles.proofDistance}>{card.distance}</Text>
      </View>
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
      // Slides are parked a full stage-width to either side; without this
      // they'd be visible beside the active one.
      overflow: 'hidden',
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
    cardWindow: {
      width: '100%',
      height: CARD_HEIGHT,
      marginTop: 28,
      overflow: 'hidden',
    },
    cardSlot: {
      height: CARD_HEIGHT,
      justifyContent: 'center',
    },
    proofCard: {
      width: '100%',
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
      fontSize: 15,
      lineHeight: 21,
      fontWeight: '600',
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
