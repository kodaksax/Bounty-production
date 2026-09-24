/**
 * Onboarding Founder Note
 * The last screen of onboarding, shown right after payout setup
 * (app/onboarding/payouts.tsx). Reached from both the "Skip for now" path and
 * the Connect return path — payouts.tsx passes this route as `returnTo`, so
 * finishing or backing out of Stripe both land here.
 *
 * Continue is therefore the terminal action of the whole funnel: it runs
 * useCompleteOnboarding, which writes the profile and the
 * onboarding_completed flag, registers for push, clears the draft, fires
 * `onboarding_completed` and only then navigates into the app. Everything the
 * flow used to ask for after this screen (profile details, a first bounty or
 * application, phone) was removed, so this is the single completion point —
 * if it stops calling complete(), a user never finishes onboarding and
 * bounty-app.tsx bounces them straight back into the funnel.
 *
 * Deliberately not a numbered step: it carries no input and no branch, so it
 * shows no progress dots and the totalStepsFor() counts in username.tsx /
 * style.tsx stay as they are.
 *
 * Typography is the one place this screen departs from the rest of the funnel:
 * quote and signature alike are set in SpaceMono (loaded in app/_layout.tsx),
 * on the user's own theme — the same background every other onboarding step
 * uses — so the note reads as a quiet aside inside the app rather than a
 * branded splash.
 *
 * The staging is sequential and all of one piece: the quote types itself out,
 * then the signature types straight on in the same face at the same pace, with
 * the one caret moving from the end of the quote to the signature line as it
 * goes; the CTA follows. The signature was previously set in a handwriting
 * face and revealed by a sliding cover — it's deliberately the same typewriter
 * as the quote now, so the whole note reads as one hand at one keyboard.
 *
 * Under Reduce Motion the whole thing renders complete on mount — the point
 * is the words, and the CTA must never be gated behind an animation a user
 * has asked not to see.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { useCompleteOnboarding } from '../../hooks/useCompleteOnboarding';
import { useOnboarding } from '../../lib/context/onboarding-context';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { analyticsService } from '../../lib/services/analytics-service';
import { founderNoteStrings } from '../../lib/strings/founderNote';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { palette } from '../../lib/themes/colors';
import { radius, spacing } from '../../lib/themes/tokens';
import type { AppTheme } from '../../lib/themes/types';

// Typewriter pacing. Slow enough to be read along with rather than watched —
// this is the one screen in the funnel with nothing to do but read, so the
// words arrive at reading speed. Newlines get an extra beat, the way a real
// line break lands.
const TYPE_MS_PER_CHAR = 80;
const NEWLINE_EXTRA_MS = 320;
const TYPE_START_DELAY_MS = 450;
const REVEAL_MS = 700;
// Beat in the post-typing reveal: a hold once the signature is fully in
// before the CTA follows. Without it the two movements run back-to-back and
// read as one rather than signature-then-way-out. The signature itself gets
// no lead-in — it picks up on the quote's own per-character beat, so the two
// lines are one unbroken run of typing.
const CTA_DELAY_MS = 500;
// Held after the signature's last character before the CTA fade starts, so the
// name gets a beat on its own rather than being stepped on by the way out.
const SIGNATURE_SETTLE_MS = 260;

export default function FounderNoteScreen() {
  const insets = useSafeAreaInsets();
  const { data: onboardingData } = useOnboarding();
  const { complete, isLoading: isCompleting } = useCompleteOnboarding('/tabs/bounty-app');
  const { prefersReducedMotion } = useAccessibleAnimation();
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const quote = useMemo(() => founderNoteStrings.quoteLines.join('\n'), []);
  const spokenQuote = useMemo(() => founderNoteStrings.quoteLines.join(' '), []);
  const signatureLine = useMemo(
    () => `${founderNoteStrings.signatureDash} ${founderNoteStrings.signature}`,
    []
  );

  // How many characters of `quote` are currently visible. Starts at 0 and is
  // driven to quote.length by the timer chain below.
  const [typedCount, setTypedCount] = useState(0);
  const typingDone = typedCount >= quote.length;

  // The same, for the signature line, which picks up the moment the quote
  // finishes.
  const [signatureTypedCount, setSignatureTypedCount] = useState(0);
  const signatureTypingDone = signatureTypedCount >= signatureLine.length;

  // Tracks whether the CTA has finished fading in, not just whether typing is
  // over: it's invisible for the length of the reveal after the last character
  // lands, and an invisible button must not be tappable.
  const [ctaReady, setCtaReady] = useState(false);

  const ctaOpacity = useRef(new Animated.Value(0)).current;
  const caretOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    analyticsService.trackEvent('founder_note_viewed', {
      surface: 'onboarding',
      role: onboardingData.intent ?? 'unknown',
    });
  }, [onboardingData.intent]);

  // Typewriter. A self-rescheduling timeout rather than a single interval, so
  // the per-character delay can vary (see NEWLINE_EXTRA_MS) and so the timer
  // is always cleanly cancellable on unmount.
  useEffect(() => {
    if (prefersReducedMotion) {
      setTypedCount(quote.length);
      return;
    }

    setTypedCount(0);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const typeNext = (index: number) => {
      if (cancelled || index > quote.length) return;
      setTypedCount(index);
      if (index === quote.length) return;
      const delay =
        index === 0
          ? TYPE_START_DELAY_MS
          : TYPE_MS_PER_CHAR + (quote[index - 1] === '\n' ? NEWLINE_EXTRA_MS : 0);
      timer = setTimeout(() => typeNext(index + 1), delay);
    };

    typeNext(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [quote, prefersReducedMotion]);

  // Blinking caret, alive while either line is still typing — it's one caret
  // that hands off from the quote to the signature, not two.
  useEffect(() => {
    if (prefersReducedMotion || signatureTypingDone) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(caretOpacity, {
          toValue: 0,
          duration: 450,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(caretOpacity, {
          toValue: 1,
          duration: 450,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [caretOpacity, signatureTypingDone, prefersReducedMotion]);

  // Signature typewriter — the quote's, with the same per-character pacing, so
  // the two lines read as one continuous piece of typing rather than two
  // effects that happen to follow each other. No newline beat: it's one line.
  useEffect(() => {
    if (prefersReducedMotion) {
      setSignatureTypedCount(signatureLine.length);
      return;
    }
    if (!typingDone) return;

    setSignatureTypedCount(0);
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const typeNext = (index: number) => {
      if (cancelled || index > signatureLine.length) return;
      setSignatureTypedCount(index);
      if (index === signatureLine.length) return;
      timer = setTimeout(() => typeNext(index + 1), TYPE_MS_PER_CHAR);
    };

    typeNext(0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [typingDone, signatureLine, prefersReducedMotion]);

  // CTA last, once the signature has landed and had its beat.
  useEffect(() => {
    if (prefersReducedMotion) {
      ctaOpacity.setValue(1);
      setCtaReady(true);
      return;
    }
    if (!signatureTypingDone) return;
    const reveal = Animated.sequence([
      Animated.delay(SIGNATURE_SETTLE_MS + CTA_DELAY_MS),
      Animated.timing(ctaOpacity, {
        toValue: 1,
        duration: REVEAL_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    reveal.start(({ finished }) => {
      if (finished) setCtaReady(true);
    });
    return () => reveal.stop();
  }, [signatureTypingDone, ctaOpacity, prefersReducedMotion]);

  const handleContinue = useCallback(() => {
    hapticFeedback.light();
    analyticsService.trackEvent('founder_note_continued', {
      surface: 'onboarding',
      role: onboardingData.intent ?? 'unknown',
    });
    // Fire-and-forget on purpose: complete() owns its own in-flight guard and
    // its own navigation, and it must not be awaited behind a disabled button
    // that a failed write would leave disabled forever.
    void complete();
  }, [complete, onboardingData.intent]);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.content,
          {
            paddingTop: insets.top + spacing['3xl'],
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
      >
        <View style={styles.quoteBlock}>
          {/* The full quote, rendered invisible, reserves the block's final
              size so the typed copy below doesn't reflow the layout — and so
              the centred text doesn't crawl as lines fill in. */}
          <View>
            <Text style={[styles.quote, styles.quoteGhost]} accessible={false}>
              {quote}
            </Text>
            <View style={StyleSheet.absoluteFill}>
              <Text
                style={styles.quote}
                accessibilityRole="text"
                // Announced whole and at once: the typing is decoration, and a
                // screen reader should never be fed it a character at a time.
                accessibilityLabel={spokenQuote}
              >
                {quote.slice(0, typedCount)}
                {!typingDone && !prefersReducedMotion ? (
                  <Animated.Text style={[styles.caret, { opacity: caretOpacity }]}>|</Animated.Text>
                ) : null}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.signatureBlock}>
          {/* Ghosted full line reserves the box, exactly as the quote above
              does, so the centred signature doesn't crawl sideways as its
              characters arrive. */}
          <View>
            <Text style={[styles.signature, styles.quoteGhost]} accessible={false}>
              {signatureLine}
            </Text>
            <View style={StyleSheet.absoluteFill}>
              <Text
                testID="founder-signature"
                style={styles.signature}
                accessibilityRole="text"
                // Announced whole, for the same reason the quote is: the
                // typing is decoration.
                accessibilityLabel={signatureLine}
              >
                {signatureLine.slice(0, signatureTypedCount)}
                {typingDone && !signatureTypingDone && !prefersReducedMotion ? (
                  <Animated.Text style={[styles.signatureCaret, { opacity: caretOpacity }]}>
                    |
                  </Animated.Text>
                ) : null}
              </Text>
            </View>
          </View>
        </View>

        <Animated.View style={[styles.ctaBlock, { opacity: ctaOpacity }]}>
          <TouchableOpacity
            style={[styles.primaryButton, isCompleting ? styles.primaryButtonBusy : null]}
            onPress={handleContinue}
            // Untappable until it has actually faded in, so a stray tap during
            // the reveal can't fire an invisible button — and untappable again
            // while completion is in flight, since it ends onboarding and
            // writes the profile.
            disabled={!ctaReady || isCompleting}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={founderNoteStrings.primaryCta}
            accessibilityElementsHidden={!ctaReady}
            accessibilityState={{ disabled: !ctaReady || isCompleting, busy: isCompleting }}
          >
            {isCompleting ? (
              <ActivityIndicator color={palette.white} />
            ) : (
              <Text style={styles.primaryButtonText}>{founderNoteStrings.primaryCta}</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
      </View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  // The signature is the only element that doesn't take a plain text token:
  // it stays green so it reads as a mark rather than another line of copy,
  // but the step has to flip per theme — green[700] is too dark to see on
  // the dark background, green[300] too pale on the light one.
  const signatureColor = theme.isDark ? palette.green[300] : palette.green[700];

  return StyleSheet.create({
    container: { flex: 1, backgroundColor: theme.background },
    content: {
      flex: 1,
      paddingHorizontal: spacing.xl,
      alignItems: 'center',
    },
    quoteBlock: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    quote: {
      fontFamily: 'SpaceMono',
      fontSize: 19,
      lineHeight: 32,
      letterSpacing: 0.2,
      color: theme.text,
      textAlign: 'center',
    },
    quoteGhost: { opacity: 0 },
    caret: {
      fontFamily: 'SpaceMono',
      fontSize: 19,
      lineHeight: 32,
      color: theme.text,
    },
    signatureBlock: {
      alignItems: 'center',
      // Sits clear of the CTA rather than just above it — the name reads as
      // the close of the note, not as a label on the button.
      marginBottom: spacing['4xl'],
    },
    signature: {
      // The quote's face, deliberately: same typewriter, same type.
      fontFamily: 'SpaceMono',
      // 17 against the quote's 19 — a monospace signature line of 24
      // characters has to hold one line on a 320pt screen, and the small step
      // down also keeps the attribution subordinate to the words themselves.
      fontSize: 17,
      lineHeight: 28,
      letterSpacing: 0.2,
      color: signatureColor,
      textAlign: 'center',
    },
    signatureCaret: {
      fontFamily: 'SpaceMono',
      fontSize: 17,
      lineHeight: 28,
      color: signatureColor,
    },
    ctaBlock: { alignSelf: 'stretch' },
    primaryButtonBusy: { opacity: 0.8 },
    primaryButton: {
      height: 56,
      borderRadius: radius.full,
      backgroundColor: theme.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      fontSize: 17,
      fontWeight: '700',
      color: palette.white,
    },
  });
}
