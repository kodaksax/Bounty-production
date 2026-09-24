/**
 * Payout Setup Screen (onboarding)
 *
 * Shown immediately after role selection (app/onboarding/role-select.tsx) for
 * BOTH intents — poster and hunter. It used to be that "Continue" on
 * "Make today pay." dropped the user straight into the task composer
 * (PosterTaskPrompt); money setup came later, or never. Payouts are the one
 * thing both roles need before value can move, so it now comes first.
 *
 * Two things this screen is deliberately NOT:
 *
 *   1. It is not wallet setup. The Bounty wallet is provisioned server-side
 *      with the profile and is already usable at this point — the copy says so
 *      explicitly, because "set up payouts" otherwise reads as "your wallet is
 *      missing" and users bounce thinking the app is half-built.
 *   2. It does not run onboarding itself. Both CTAs hand off to the existing
 *      Stripe Connect onboarding screen (app/wallet/connect/embedded-onboarding.tsx),
 *      which owns account-link creation, the ASWebAuthenticationSession /
 *      Custom Tab presentation, and status reconciliation. This screen is the
 *      entry surface only, so there is exactly one Connect onboarding
 *      implementation in the app.
 *
 * Layout follows the "connect a payments account" pattern: a hero card with
 * the paired app + Stripe marks and a single Get Started affordance, and a
 * bottom sheet holding the actual choice (country, create vs. link). No
 * progress dots — the rest of the funnel's dot counts (6 steps, hard-coded in
 * PosterTaskPrompt, HunterLocationPrompt, PosterFundingScreen, done.tsx…) stay
 * correct only if this interstitial stays outside the counted sequence, and
 * the sheet presentation reads as a detour rather than a step anyway.
 */

import { MaterialIcons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { EdgeInsets } from 'react-native-safe-area-context';
import { palette } from '../../lib/themes/colors';
import type { AppTheme } from '../../lib/themes/types';
import {
  PAYOUT_COUNTRIES,
  PAYOUT_SETUP_COPY,
  type PayoutCountry,
} from '../../lib/strings/payoutSetup';

type PayoutSetupScreenProps = {
  theme: AppTheme;
  insets: EdgeInsets;
  country: PayoutCountry;
  onChangeCountry: (country: PayoutCountry) => void;
  /** Starts Connect onboarding for a brand-new Express account. */
  onCreateAccount: () => void;
  /** Same hosted flow, entered by signing into an existing Stripe account. */
  onLinkExisting: () => void;
  onSkip: () => void;
  onBack?: () => void;
  /** True while a CTA is navigating, so the sheet buttons stop double-firing. */
  busy?: boolean;
};

const SHEET_ANIMATION_MS = 260;

// Paired-mark geometry. MARK_OVERLAP is how much the two circles eat into each
// other; the plus badge is MARK_JOIN_SIZE and is centered on the overlap.
const MARK_SIZE = 64;
const MARK_OVERLAP = 18;
const MARK_JOIN_SIZE = 28;

export function PayoutSetupScreen({
  theme,
  insets,
  country,
  onChangeCountry,
  onCreateAccount,
  onLinkExisting,
  onSkip,
  onBack,
  busy = false,
}: PayoutSetupScreenProps) {
  const styles = makeStyles(theme);
  // The sheet is open on arrival: this screen exists to ask one question, and
  // making the user tap Get Started before they can see the question adds a
  // tap without adding information. The hero card's Get Started re-opens it
  // after a dismiss.
  const [sheetOpen, setSheetOpen] = useState(true);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;
  // Measured rather than assumed: the hidden offset has to be at least the
  // sheet's own height or a dismissed sheet leaves a sliver of itself pinned
  // to the bottom edge, and the height moves with font scale and safe-area
  // inset. Seeded generously so the first frame (before onLayout fires) is
  // already offscreen.
  const [sheetHeight, setSheetHeight] = useState(600);

  useEffect(() => {
    Animated.timing(sheetAnim, {
      toValue: sheetOpen ? 1 : 0,
      duration: SHEET_ANIMATION_MS,
      easing: sheetOpen ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [sheetOpen, sheetAnim]);

  const handleSelectCountry = useCallback(
    (next: PayoutCountry) => {
      onChangeCountry(next);
      setCountryPickerOpen(false);
    },
    [onChangeCountry]
  );

  const sheetTranslate = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [sheetHeight, 0],
  });

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        {onBack ? (
          <TouchableOpacity
            onPress={onBack}
            style={styles.headerButton}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <MaterialIcons name="chevron-left" size={28} color={theme.text} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerButton} />
        )}
        <Text style={styles.headerTitle} accessibilityRole="header">
          {PAYOUT_SETUP_COPY.headerTitle}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.heroWrap}>
        <View style={styles.heroCard}>
          <View style={styles.markRow}>
            <View style={[styles.markCircle, styles.bountyMark]}>
              <Image
                source={require('../../assets/images/bounty-icon.png')}
                style={styles.markImage}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
              />
            </View>
            <View style={[styles.markCircle, styles.stripeMark]}>
              {/* White on Stripe's brand purple below — the third-party mark,
                  not a themed surface. */}
              <MaterialIcons name="bolt" size={26} color={palette.white} />
            </View>
            {/* Absolutely centered over the row, so the plus lands on the exact
                midpoint of the pair no matter how the two circles are sized or
                overlapped — the previous negative-margin chain only
                approximated it. pointerEvents none: purely decorative. */}
            <View style={styles.markJoinWrap} pointerEvents="none">
              <View style={styles.markJoinRingOuter}>
                <View style={styles.markJoinRingInner}>
                  <View style={styles.markJoin}>
                    <MaterialIcons name="add" size={16} color={theme.textSecondary} />
                  </View>
                </View>
              </View>
            </View>
          </View>

          <Text style={styles.heroTitle}>{PAYOUT_SETUP_COPY.heroTitle}</Text>
          <Text style={styles.heroBody}>{PAYOUT_SETUP_COPY.heroBody}</Text>

          <TouchableOpacity
            style={styles.getStartedButton}
            onPress={() => setSheetOpen(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={PAYOUT_SETUP_COPY.getStarted}
          >
            <Text style={styles.getStartedText}>{PAYOUT_SETUP_COPY.getStarted}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          onPress={onSkip}
          style={styles.skipLink}
          accessibilityRole="button"
          accessibilityLabel={PAYOUT_SETUP_COPY.skip}
        >
          <Text style={styles.skipLinkText}>{PAYOUT_SETUP_COPY.skip}</Text>
        </TouchableOpacity>
      </View>

      {sheetOpen && (
        <Pressable
          style={styles.scrim}
          onPress={() => setSheetOpen(false)}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        />
      )}

      <Animated.View
        pointerEvents={sheetOpen ? 'auto' : 'none'}
        onLayout={event => setSheetHeight(event.nativeEvent.layout.height)}
        style={[
          styles.sheet,
          { paddingBottom: Math.max(insets.bottom, 16) + 8, transform: [{ translateY: sheetTranslate }] },
        ]}
      >
        <View style={styles.grabber} />

        <TouchableOpacity
          onPress={() => setSheetOpen(false)}
          style={styles.sheetClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <MaterialIcons name="close" size={22} color={theme.text} />
        </TouchableOpacity>

        <View style={styles.sheetIcon}>
          <MaterialIcons name="account-balance-wallet" size={24} color={theme.text} />
        </View>

        <Text style={styles.sheetTitle} accessibilityRole="header">
          {PAYOUT_SETUP_COPY.sheetTitle}
        </Text>
        <Text style={styles.sheetBody}>{PAYOUT_SETUP_COPY.sheetBody}</Text>

        <TouchableOpacity
          style={styles.countryRow}
          onPress={() => setCountryPickerOpen(true)}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={`Country, ${country.name}`}
          accessibilityHint="Opens the country list"
        >
          <Text style={styles.countryLabel}>Country</Text>
          <View style={styles.countryValueWrap}>
            <Text style={styles.countryValue}>{country.name}</Text>
            <MaterialIcons name="unfold-more" size={18} color={theme.textSecondary} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, busy && styles.buttonBusy]}
          onPress={onCreateAccount}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={PAYOUT_SETUP_COPY.createAccount}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.primaryButtonText}>{PAYOUT_SETUP_COPY.createAccount}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryButton, busy && styles.buttonBusy]}
          onPress={onLinkExisting}
          disabled={busy}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={PAYOUT_SETUP_COPY.linkExisting}
          accessibilityState={{ disabled: busy }}
        >
          <Text style={styles.secondaryButtonText}>{PAYOUT_SETUP_COPY.linkExisting}</Text>
        </TouchableOpacity>
      </Animated.View>

      <Modal
        visible={countryPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setCountryPickerOpen(false)}
      >
        <Pressable style={styles.pickerScrim} onPress={() => setCountryPickerOpen(false)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <Text style={styles.pickerTitle} accessibilityRole="header">
              Country
            </Text>
            <ScrollView bounces={false}>
              {PAYOUT_COUNTRIES.map(option => {
                const isSelected = option.code === country.code;
                return (
                  <TouchableOpacity
                    key={option.code}
                    style={styles.pickerRow}
                    onPress={() => handleSelectCountry(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected }}
                    accessibilityLabel={option.name}
                  >
                    <Text style={styles.pickerRowText}>{option.name}</Text>
                    {isSelected && (
                      <MaterialIcons name="check" size={20} color={theme.primary} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function makeStyles(t: AppTheme) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: t.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingTop: 4,
      paddingBottom: 12,
    },
    headerButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.surfaceSecondary,
    },
    headerTitle: { fontSize: 18, fontWeight: '700', color: t.text },
    heroWrap: { paddingHorizontal: 16, paddingTop: 8 },
    heroCard: {
      backgroundColor: t.surface,
      borderRadius: t.radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 24,
      alignItems: 'center',
    },
    // The paired marks: two equal circles overlapping by MARK_OVERLAP, with the
    // plus badge pinned to the row's true center (see markJoinWrap). The
    // circles carry the overlap symmetrically — half pulled off each — so the
    // seam between them and the row's midpoint are the same point, which is
    // what lets the badge sit exactly on the join.
    markRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
    },
    markCircle: {
      width: MARK_SIZE,
      height: MARK_SIZE,
      borderRadius: MARK_SIZE / 2,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markImage: { width: 34, height: 34 },
    // Brand green on our side of the pairing, Stripe purple on theirs — the
    // two marks read as two parties being connected, which is the whole point
    // of the graphic. The bounty icon is a light mark, so it holds up on green.
    bountyMark: { backgroundColor: t.primary, marginRight: -MARK_OVERLAP / 2 },
    // Stripe's brand purple — the second mark is the third-party side of the
    // pairing, so it stays Stripe-colored rather than taking our accent.
    stripeMark: { backgroundColor: '#635BFF', marginLeft: -MARK_OVERLAP / 2 },
    markJoinWrap: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Two concentric hairline rings behind the badge, so the join reads as a
    // deliberate connector rather than a stray dot sitting on the seam.
    markJoinRingOuter: {
      width: MARK_JOIN_SIZE + 18,
      height: MARK_JOIN_SIZE + 18,
      borderRadius: (MARK_JOIN_SIZE + 18) / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markJoinRingInner: {
      width: MARK_JOIN_SIZE + 9,
      height: MARK_JOIN_SIZE + 9,
      borderRadius: (MARK_JOIN_SIZE + 9) / 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markJoin: {
      width: MARK_JOIN_SIZE,
      height: MARK_JOIN_SIZE,
      borderRadius: MARK_JOIN_SIZE / 2,
      // The card's own color, not the page's: the badge should read as a hole
      // punched through the overlapping circles, and it sits on the card.
      backgroundColor: t.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitle: {
      marginTop: 18,
      fontSize: 22,
      fontWeight: '700',
      color: t.text,
      textAlign: 'center',
    },
    heroBody: {
      marginTop: 8,
      fontSize: 15,
      lineHeight: 21,
      color: t.textSecondary,
      textAlign: 'center',
    },
    getStartedButton: {
      marginTop: 20,
      paddingVertical: 12,
      paddingHorizontal: 28,
      borderRadius: t.radius.full,
      backgroundColor: t.surfaceSecondary,
    },
    getStartedText: { fontSize: 16, fontWeight: '700', color: t.text },
    skipLink: { alignSelf: 'center', marginTop: 20, padding: 8 },
    skipLinkText: { fontSize: 14, color: t.textSecondary, fontWeight: '500' },
    // Scrims stay black in both themes, matching components/ui/app-modal.tsx:
    // they dim whatever is behind them, so theme.overlay (a 5-10% button tint)
    // would be nearly invisible here.
    scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.surface,
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      paddingHorizontal: 20,
      paddingTop: 12,
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.border,
    },
    sheetClose: {
      position: 'absolute',
      top: 20,
      right: 20,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    sheetIcon: {
      marginTop: 16,
      width: 48,
      height: 48,
      borderRadius: t.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sheetTitle: { marginTop: 16, fontSize: 24, fontWeight: '700', color: t.text },
    sheetBody: { marginTop: 8, fontSize: 15, lineHeight: 21, color: t.textSecondary },
    countryRow: {
      marginTop: 20,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: t.surfaceSecondary,
      borderRadius: t.radius.lg,
      paddingHorizontal: 18,
      paddingVertical: 16,
    },
    countryLabel: { fontSize: 16, fontWeight: '600', color: t.text },
    countryValueWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    countryValue: { fontSize: 16, color: t.textSecondary },
    primaryButton: {
      marginTop: 12,
      height: 56,
      borderRadius: t.radius.full,
      backgroundColor: t.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: { fontSize: 17, fontWeight: '700', color: t.background },
    secondaryButton: {
      marginTop: 10,
      height: 56,
      borderRadius: t.radius.full,
      backgroundColor: t.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    secondaryButtonText: { fontSize: 17, fontWeight: '600', color: t.text },
    buttonBusy: { opacity: 0.6 },
    pickerScrim: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    pickerCard: {
      width: '100%',
      maxHeight: '70%',
      backgroundColor: t.surface,
      borderRadius: t.radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.border,
      paddingVertical: 12,
      paddingHorizontal: 8,
    },
    pickerTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: t.text,
      paddingHorizontal: 12,
      paddingBottom: 8,
    },
    pickerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 12,
    },
    pickerRowText: { fontSize: 16, color: t.text },
  });
}
