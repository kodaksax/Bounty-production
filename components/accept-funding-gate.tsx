/**
 * The one sheet the poster sees between tapping "Select" on a hunter and the
 * acceptance being attempted.
 *
 * Driven entirely by useAcceptFunding — this component holds no money logic
 * of its own. Its job is to make the hire a single decision:
 *
 *   balance covers it   ->  "Confirm & hire"       (1 tap)
 *   balance is short    ->  "Pay $shortfall & hire" (1 tap + payment auth)
 *
 * The second variant runs the SAME deposit path the wallet uses
 * (hooks/use-wallet-deposit, then /wallet/deposit) for exactly the shortfall,
 * and hands the result straight back to the gate — no keypad, no "add funds"
 * detour, no success modal to dismiss. When the server confirms the balance
 * the gate resolves on its own and useAcceptRequest calls acceptRequest.
 *
 * How the poster can pay:
 *   - saved card        one tap ("Pay $X & hire")
 *   - Apple Pay (iOS)   one tap, direct
 *   - Payment Sheet     Apple Pay / Google Pay, saved cards and new card entry
 *                       in one native sheet. The primary button when no card
 *                       is saved, and "Use another card" otherwise.
 *                       DESIGN-GAP: the handoff folds these into one primary
 *                       action; the separate, tested wallet buttons are kept.
 *   - Link a card       the original card-entry modal; the fallback when the
 *                       sheet is unavailable (web).
 *
 * A failed payment never closes the sheet: it says what happened in plain
 * words, keeps the hunter selected, and offers the next thing to try.
 *
 * What replaced the old confirm -> insufficient -> top-up -> re-check chain
 * is deliberately smaller, not just shorter: the only decisions left on this
 * screen are "hire this person for this amount" and "not now".
 */

import { MaterialIcons } from '@expo/vector-icons';
import { ErrorBanner } from 'components/error-banner';
import { ConsequenceList, FlowTitle } from 'components/poster/blocks';
import { SlideInScreen } from 'components/ui/slide-in-screen';
import { IdCheckLine } from 'components/poster/id-check';
import { QuickConfirm } from 'components/poster/quick-confirm';
import { MoneyLine } from 'components/poster/four-questions';
import { PaymentMethodsModal } from 'components/payment-methods-modal';
import { Avatar, AvatarFallback, AvatarImage } from 'components/ui/avatar';
import { TrustSafetyNotice } from 'components/ui/trust-safety-notice';
import type { AcceptFundingGate as AcceptFundingGateState } from 'hooks/useAcceptFunding';
import { useWalletDeposit } from 'hooks/use-wallet-deposit';
import { useSingleFlight } from 'hooks/useSingleFlight';
import { getFloatingTabBarTop } from 'components/ui/floating-tab-bar';
import { getBottomNavContentGap } from 'lib/constants/navigation';
import { usePaymentPromiseCopy } from 'lib/experiments/payment-promise-copy';
import { FOCUS_POLICY } from 'lib/constants/focus-policy';
import { hapticFeedback } from 'lib/haptic-feedback';
import { trackWorkspacePrimaryTapped } from 'lib/services/focus-analytics';
import { stripeService } from 'lib/services/stripe-service';
import { fundingSourceLine, paymentPromiseStrings } from 'lib/strings/payment-promise';
import { trustSafetyStrings } from 'lib/strings/trust-safety';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import { describeHire } from 'lib/utils/poster-stage-copy';
import { describePaymentFailure } from 'lib/utils/payment-failure-message';
import type { DepositResult } from 'hooks/use-wallet-deposit';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AcceptFundingGateProps {
  /** Rendered inside the tab shell, under its floating bar. */
  overTabBar?: boolean;
  gate: AcceptFundingGateState;
  /**
   * The other people who offered, for "Priya's and Sam's offers close"
   * (Focus-first screen E). Without them the line says "Other offers close".
   */
  otherApplicantNames?: readonly string[];
  /** Where "Back to My Jobs" goes when a poster leaves a payment that is still confirming (E.3). */
  onLeavePending?: () => void;
  /**
   * Opens on 4b, the quick confirm that confirms itself after
   * FOCUS_POLICY.quickConfirmSeconds. Only when the Bounty balance or a saved
   * card can pay; anything else (no card, a failed or partial payment, "Change")
   * is screen E, which never confirms on its own.
   */
  quickConfirm?: { jobTitle: string; jobIcon: string; sub?: string | null };
}

/**
 * Stripe refuses charges under $0.50 (and use-wallet-deposit's Apple Pay path
 * enforces the same floor). A shortfall of a few cents is charged at the
 * minimum instead of dead-ending; the excess is ordinary wallet balance, not
 * a fee, and stays the poster's.
 */
export const MIN_SHORTFALL_CHARGE = 0.5;

/** The amount the sheet will actually charge for a given shortfall. */
export function chargeAmountForShortfall(shortfall: number): number {
  if (!Number.isFinite(shortfall) || shortfall <= 0) return 0;
  return Number(Math.max(shortfall, MIN_SHORTFALL_CHARGE).toFixed(2));
}

const clamp = (value: number, min: number, max: number) =>
  Math.round(Math.min(max, Math.max(min, value)));

/**
 * Every size on the sheet is derived from the room actually available — the
 * window height minus the status bar and the floating BottomNav — rather than
 * fixed points, so the whole thing (hunter, amount, "held until you approve",
 * the balance rows AND the pay / "Not now" buttons) is on screen at once
 * without scrolling where it fits. Body text stays 17pt or larger so older
 * posters can read it; on a small phone the info scrolls and the buttons stay
 * pinned. A 320×568 SE gets a tighter sheet; a 430×932 Pro Max a
 * roomier one. Nothing here is allowed to push the buttons below the fold: a
 * poster who has to scroll to find "Pay" is a poster who taps nothing.
 */
function getGateMetrics(width: number, usableHeight: number) {
  const h = Math.max(usableHeight, 420);
  // Below ~620pt of usable height (SE / small Android with the nav bar) the
  // secondary copy is trimmed and vertical rhythm tightens; type scales
  // continuously, but the row heights and paddings need a floor to stay
  // tappable, so that floor is what gets traded for space.
  const compact = h < 620;
  return {
    compact,
    horizontalPadding: clamp(width * 0.06, 16, 28),
    topPadding: clamp(h * 0.02, 8, 24),
    sectionGap: clamp(h * 0.016, compact ? 6 : 10, 16),
    cardPaddingVertical: clamp(h * 0.022, 14, 22),
    rowPaddingVertical: clamp(h * 0.014, compact ? 7 : 9, 12),
    eyebrowFontSize: clamp(h * 0.021, 14, 15),
    titleFontSize: clamp(Math.min(width * 0.068, h * 0.032), 20, 28),
    subtitleFontSize: clamp(h * 0.019, 12, 14),
    amountFontSize: clamp(Math.min(width * 0.11, h * 0.052), 30, 44),
    captionFontSize: clamp(h * 0.018, 12, 13),
    heldFontSize: clamp(h * 0.024, 15, 17),
    rowFontSize: clamp(h * 0.028, 17, 19),
    bodyFontSize: clamp(h * 0.027, 17, 19),
    buttonPaddingVertical: clamp(h * 0.023, compact ? 14 : 16, 20),
    buttonFontSize: clamp(h * 0.032, 19, 22),
    secondaryPaddingVertical: clamp(h * 0.02, compact ? 12 : 14, 16),
    avatarSize: clamp(Math.min(width * 0.13, h * 0.06), 40, 52),
  };
}

type GateMetrics = ReturnType<typeof getGateMetrics>;

/** The gate takes over its host's screen, so it slides in like a pushed route. */
export function AcceptFundingGate({ hostSlides = false, ...props }: AcceptFundingGateProps & {
  /** The host already slides the gate in over its own screen. */
  hostSlides?: boolean;
}) {
  if (hostSlides) return <AcceptFundingGateContent {...props} />;
  return (
    <SlideInScreen>
      <AcceptFundingGateContent {...props} />
    </SlideInScreen>
  );
}

function AcceptFundingGateContent({ gate, otherApplicantNames, quickConfirm, onLeavePending, overTabBar = false }: AcceptFundingGateProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const showPaymentPromise = usePaymentPromiseCopy();

  // The root layout already keeps every screen between the status bar and the
  // home indicator. Only the tab host has the floating bar over this gate.
  const footerClearance = overTabBar
    ? getFloatingTabBarTop(insets.bottom) + getBottomNavContentGap(windowHeight)
    : insets.bottom > 0 ? 4 : 12;
  const usableHeight = windowHeight - insets.top - insets.bottom - footerClearance;

  const metrics = useMemo(
    () => getGateMetrics(windowWidth, usableHeight),
    [windowWidth, usableHeight]
  );
  const styles = useMemo(() => makeStyles(theme, metrics), [theme, metrics]);

  const {
    isProcessing,
    error,
    setError,
    successInfo,
    setSuccessInfo,
    showPaymentMethodsModal,
    setShowPaymentMethodsModal,
    primaryCardPaymentMethod,
    stripeLoading,
    stripeError,
    loadPaymentMethods,
    payWithCard,
    payWithApplePay,
    payWithPaymentSheet,
    isGooglePayAvailable,
    walletName,
  } = useWalletDeposit();

  const amount = gate.requirement?.amountRequired ?? 0;
  const shortfall = gate.requirement?.shortfall ?? 0;
  const balance = gate.requirement?.posterBalance ?? 0;
  const needsPayment = shortfall > 0;
  const chargeAmount = chargeAmountForShortfall(shortfall);
  const settling = gate.stage === 'settling';
  const paymentPending = gate.stage === 'pending';
  const hasPaymentMethod = !!primaryCardPaymentMethod;
  const busy = isProcessing || settling || paymentPending;
  // The native Payment Sheet; web stubs Stripe, so it keeps the card modal.
  const sheetAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

  // --- Deposit outcome -> gate --------------------------------------------
  // payWithCard/payWithApplePay return a definitive outcome for every exit
  // path — including validation and preflight failures that never touch
  // Stripe/Apple Pay — so the gate is driven directly from that return value
  // rather than inferred from `isProcessing` transitioning. Inferring it that
  // way missed any exit that never set `isProcessing`, which left
  // `paymentInFlightRef` stuck and could race a background/cancel event
  // against a still-in-flight attempt.
  const resolveOutcome = ({ outcome, failure, paymentIntentId }: DepositResult, paid: number) => {
    if (outcome === 'succeeded') {
      setSuccessInfo(null);
      if (paymentIntentId) gate.onPaymentSucceeded(paid, paymentIntentId);
      else gate.onPaymentSucceeded(paid);
      return;
    }
    if (outcome === 'pending') {
      gate.onPaymentPending(paid, paymentIntentId);
      return;
    }
    // The sheet explains a failure itself (gate.paymentFailure), so the
    // deposit hook's generic banner would only repeat it less clearly.
    if (failure) setError(null);
    gate.onPaymentFailed(outcome, failure);
  };

  // --- Actions --------------------------------------------------------------
  const handleConfirm = () => {
    hapticFeedback.light();
    gate.onConfirm();
  };

  // The three pay buttons share one synchronous lock, taken before
  // gate.onPaymentStarted: `busy` is React state and still reads false for a
  // second tap that lands before the re-render, which would record a second
  // payment attempt and race the first one's outcome.
  const payFlight = useSingleFlight();

  const handlePayWithCard = () => payFlight.run(async () => {
    // Guarded here as well as via `disabled`: an empty method list while
    // Stripe is still loading must never be mistaken for "no card on file".
    if (busy || stripeLoading) return;
    hapticFeedback.light();
    if (!hasPaymentMethod) {
      // No card on file: linking one is the first half of the same tap, not a
      // separate screen. The sheet stays put and the button becomes "Pay" once
      // the modal closes with a method loaded.
      if (gate.onPaymentStarted('linkCard') === false) return;
      setShowPaymentMethodsModal(true);
      return;
    }
    if (gate.onPaymentStarted('card') === false) return;
    resolveOutcome(await payWithCard(chargeAmount), chargeAmount);
  });

  const handleApplePay = () => payFlight.run(async () => {
    if (busy) return;
    hapticFeedback.light();
    if (gate.onPaymentStarted('applePay') === false) return;
    resolveOutcome(await payWithApplePay(chargeAmount), chargeAmount);
  });

  /** Apple Pay / Google Pay / saved or new card, in Stripe's own sheet. */
  const handlePaymentSheet = () => payFlight.run(async () => {
    if (busy) return;
    hapticFeedback.light();
    if (!sheetAvailable) {
      if (gate.onPaymentStarted('linkCard') === false) return;
      setShowPaymentMethodsModal(true);
      return;
    }
    if (gate.onPaymentStarted('paymentSheet') === false) return;
    resolveOutcome(await payWithPaymentSheet(chargeAmount), chargeAmount);
  });

  const handlePrimaryPay = () => {
    // Until the saved-card list has loaded, "no card" is unknown, not false;
    // choosing the sheet now would hide a one-tap card the poster has.
    if (stripeLoading) return;
    return hasPaymentMethod || !sheetAvailable ? handlePayWithCard() : handlePaymentSheet();
  };

  const handleCancel = () => {
    // Backing out under an in-flight charge would orphan its outcome; the
    // buttons are disabled then, this is belt-and-braces.
    if (isProcessing || paymentPending) return;
    hapticFeedback.light();
    gate.onCancel();
  };

  // --- Copy ----------------------------------------------------------------
  const money = (n: number) => `$${n.toFixed(2)}`;
  const initial = gate.hunterName.trim().charAt(0).toUpperCase() || '?';
  // Focus-first screen E (and E.3 while a payment confirms). Copy only: every
  // amount below is the gate's own (useAcceptFunding's requirement).
  const hire = describeHire({
    hunterName: gate.hunterName,
    amount,
    charge: needsPayment ? chargeAmount : 0,
    fromBalance: needsPayment ? Math.max(0, amount - chargeAmount) : amount,
    paysByCard: hasPaymentMethod,
    otherApplicantNames,
  });

  // --- 4b: quick confirm ----------------------------------------------------
  // Once it is confirmed or dismissed, the rest of this hire is screen E.
  const [quickDone, setQuickDone] = useState(false);
  // "What Bounty checks" covers Go back, so the countdown waits while it's open.
  const [idSheetOpen, setIdSheetOpen] = useState(false);
  // Confirmed from the balance: keep the quick view up, busy, until the gate
  // closes, rather than flipping to screen E for the moment the hire takes.
  const [quickConfirming, setQuickConfirming] = useState(false);
  // "What Bounty checks" covers Go back, so the countdown waits while it's open.
  const [idSheetOpen, setIdSheetOpen] = useState(false);
  const quickSeconds = FOCUS_POLICY.quickConfirmSeconds;
  if (
    quickConfirm &&
    !quickDone &&
    quickSeconds &&
    !showPaymentPromise &&
    gate.requirement &&
    (gate.stage === 'confirm' || gate.stage === 'pay') &&
    !isProcessing &&
    !gate.paymentFailure &&
    !gate.remainderAfterDeposit &&
    !error &&
    (!needsPayment || (!stripeError && (stripeLoading || hasPaymentMethod)))
  ) {
    const first = hire.back.replace(/^Back to /, '');
    const bountyId = String(gate.requirement.bountyId);
    const fromBalance = needsPayment ? Math.max(0, amount - chargeAmount) : amount;
    const sources = [
      fromBalance > 0 ? `Balance ${money(fromBalance)}` : null,
      needsPayment && hasPaymentMethod
        ? `${stripeService.formatCardDisplay(primaryCardPaymentMethod)} ${money(chargeAmount)}`
        : null,
    ].filter(Boolean);
    return (
      <QuickConfirm
        // A different charge is a different decision: start the clock again.
        key={`${gate.stage}:${amount}:${chargeAmount}`}
        name={first}
        avatarUri={gate.hunterAvatar}
        sub={quickConfirm.sub}
        idLine={
          gate.idCheck ? (
            <IdCheckLine
              name={gate.idCheck.name}
              verified={gate.idCheck.verified}
              align="center"
              onSheetVisibleChange={setIdSheetOpen}
            />
          ) : null
        }
        paused={idSheetOpen}
        rows={[
          { icon: quickConfirm.jobIcon, title: quickConfirm.jobTitle, detail: `${first} does it for ${money(amount)}` },
          { icon: 'lock', title: `Bounty holds your ${money(amount)}`, detail: hire.items[1].detail },
          { icon: hire.items[2].icon, title: hire.items[2].title, detail: hire.items[2].detail },
          {
            icon: needsPayment ? 'credit-card' : 'account-balance-wallet',
            title: sources.join(' · ') || 'Checking payment…',
            onChange: needsPayment ? () => setQuickDone(true) : undefined,
          },
        ]}
        note={`${hire.note} ${first} starts the work next.`}
        seconds={quickSeconds}
        ready={!needsPayment || (!stripeLoading && hasPaymentMethod)}
        busy={quickConfirming}
        paddingTop={metrics.topPadding}
        paddingBottom={footerClearance}
        onConfirm={(how) => {
          trackWorkspacePrimaryTapped({
            bountyId,
            side: 'posted',
            screenId: '4b',
            action: how === 'tap' ? 'quick_confirm' : 'quick_confirm_timeout',
          });
          if (needsPayment) {
            setQuickDone(true);
            void handlePayWithCard();
          } else {
            setQuickConfirming(true);
            handleConfirm();
          }
        }}
        onBack={handleCancel}
      />
    );
  }

  let primaryLabel: string;
  let primaryA11y: string;
  if (paymentPending) {
    primaryLabel = 'Payment pending…';
    primaryA11y = 'Payment status is still being confirmed';
  } else if (settling) {
    primaryLabel = 'Confirming payment…';
    primaryA11y = 'Confirming your payment';
  } else if (!needsPayment) {
    primaryLabel = showPaymentPromise ? paymentPromiseStrings.fundAndHire : hire.primary;
    primaryA11y = showPaymentPromise
      ? paymentPromiseStrings.fundAndHireA11y(gate.hunterName)
      : hire.primary;
  } else if (stripeLoading) {
    primaryLabel = 'Checking payment methods…';
    primaryA11y = 'Checking payment methods';
  } else if (!hasPaymentMethod && !sheetAvailable) {
    primaryLabel = `Link a card to pay ${money(chargeAmount)}`;
    primaryA11y = primaryLabel;
  } else if (isProcessing) {
    primaryLabel = 'Processing…';
    primaryA11y = 'Processing payment';
  } else {
    primaryLabel = showPaymentPromise ? paymentPromiseStrings.fundAndHire : hire.primary;
    primaryA11y = showPaymentPromise
      ? paymentPromiseStrings.fundAndHireA11y(gate.hunterName)
      : hire.primary;
  }
  const primaryDisabled = busy || (needsPayment && stripeLoading);
  const showApplePay = Platform.OS === 'ios' && needsPayment && !settling && !paymentPending;
  // With a saved card the primary button charges it; this is the way to
  // anything else. Without one, the primary button already opens the sheet.
  const showOtherWays =
    needsPayment && !settling && !paymentPending && sheetAvailable && hasPaymentMethod;
  const otherWaysLabel = isGooglePayAvailable ? 'Use Google Pay or another card' : 'Use another card';

  const failureCopy = gate.paymentFailure
    ? describePaymentFailure(gate.paymentFailure, { walletName })
    : null;

  // Apple's HIG calls for a black Apple Pay button on light backgrounds and a
  // white one on dark backgrounds, so the mark stays crisp in both themes.
  const applePayBg = theme.isDark ? '#ffffff' : '#000000';
  const applePayFg = theme.isDark ? '#000000' : '#ffffff';

  // A control, not copy: both versions of the sheet keep it.
  const payingWithRow =
    needsPayment && hasPaymentMethod && !stripeLoading ? (
      <TouchableOpacity
        style={styles.row}
        onPress={() => setShowPaymentMethodsModal(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`Change payment method, currently ${stripeService.formatCardDisplay(
          primaryCardPaymentMethod
        )}`}
      >
        {/* Stacked: side by side, a card number at this size pushes Change off the row. */}
        <View style={styles.rowStack}>
          <Text style={[styles.rowLabel, styles.payingText]}>Paying with</Text>
          <Text style={[styles.rowValue, styles.payingText]}>
            {stripeService.formatCardDisplay(primaryCardPaymentMethod)}
          </Text>
        </View>
        <Text style={[styles.changeLink, styles.payingText]}>Change</Text>
      </TouchableOpacity>
    ) : null;

  return (
    <View style={styles.root}>
      {/* Single column: getGateMetrics sizes everything to fit the info block
          and the actions on screen together without scrolling in the common
          case. But those metrics only account for viewport size — not Dynamic
          Type, an unusually long hunter name, or a multi-line error banner —
          so the info block scrolls (as add-money-screen's keypad does) rather
          than clip. The actions stay outside the ScrollView so "Pay"/"Not
          now" are always reachable even when the info above them overflows. */}
      <View
        style={[
          styles.sheet,
          { paddingTop: metrics.topPadding, paddingBottom: footerClearance },
        ]}
      >
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
        <View style={styles.info}>
          {showPaymentPromise ? null : (
            <View style={styles.focusHead} testID="hire-confirmation">
              <FlowTitle title={hire.title} />
              {gate.idCheck ? <IdCheckLine name={gate.idCheck.name} verified={gate.idCheck.verified} /> : null}
              <ConsequenceList
                label={hire.label}
                items={hire.items.map((item) => ({ ...item, icon: item.icon as never }))}
              />
              <View style={styles.heldRow}>
                <MaterialIcons name="lock-outline" size={16} color={theme.textSecondary} />
                <Text style={styles.heldText}>
                  {gate.requirement?.fundingMode === 'at_accept'
                    ? trustSafetyStrings.payWhenYouHire
                    : 'Held for in-app completion or dispute review'}
                </Text>
              </View>
              <Text style={styles.noFees}>{hire.note}</Text>
            </View>
          )}
          {showPaymentPromise ? (
          <>
          <Text style={styles.eyebrow}>{needsPayment ? 'PAY & HIRE' : 'HIRE'}</Text>

          <View style={styles.hunterRow}>
            <Avatar style={styles.avatar}>
              <AvatarImage src={gate.hunterAvatar || undefined} alt={gate.hunterName} />
              <AvatarFallback>
                <Text style={styles.avatarFallbackText}>{initial}</Text>
              </AvatarFallback>
            </Avatar>
            <View style={styles.hunterText}>
              <Text style={styles.title} accessibilityRole="header">
                {gate.hunterName}
              </Text>
            </View>
          </View>
          {/* Both versions of screen E say whether the ID was checked. */}
          {gate.idCheck ? <IdCheckLine name={gate.idCheck.name} verified={gate.idCheck.verified} /> : null}
          </>
          ) : null}

          {showPaymentPromise ? (
            <View style={styles.promiseCard} testID="payment-promise-summary">
              <Text style={styles.promiseSummary}>
                {paymentPromiseStrings.fundingSummary(money(amount))}
              </Text>
              <Text style={styles.promiseSource}>
                {fundingSourceLine(amount, needsPayment ? chargeAmount : 0, money)}
              </Text>
              <Text style={styles.promiseHold}>{paymentPromiseStrings.fundingHold}</Text>
            </View>
          ) : null}

          {gate.remainderAfterDeposit && (
            <View style={styles.notice} accessibilityRole="alert">
              <MaterialIcons name="info-outline" size={18} color={theme.primary} />
              <Text style={styles.noticeText}>
                Payment received. {money(chargeAmount)} more is needed to hire {gate.hunterName}.
              </Text>
            </View>
          )}

          {paymentPending && (
            <View style={styles.pending} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="hire-payment-pending">
              <Text style={styles.pendingNow}>{hire.pending.now}</Text>
              <Text style={styles.pendingMeans}>{hire.pending.means}</Text>
              <MoneyLine kind="warn" text={hire.pending.money} testID="hire-payment-pending-money" />
            </View>
          )}

          {failureCopy && !busy && (
            <View style={styles.failure} accessibilityRole="alert" accessibilityLiveRegion="polite">
              <MaterialIcons name="error-outline" size={18} color={theme.error} />
              <View style={styles.failureText}>
                <Text style={styles.failureTitle}>{failureCopy.title}</Text>
                <Text style={styles.failureBody}>{failureCopy.message}</Text>
                <Text style={styles.failureBody}>
                  {gate.hunterName} is still selected. Nothing has changed on this bounty.
                </Text>
              </View>
            </View>
          )}

          {/* Anything that is not a payment decline (session expired, payment
              methods failed to load). A decline is explained above instead,
              and is never "retried" onto the card that was just declined. */}
          {!failureCopy && (error || stripeError) && (
            <ErrorBanner
              error={getUserFriendlyError(error || stripeError)}
              onDismiss={() => {
                setError(null);
                if (stripeError) loadPaymentMethods().catch(() => {});
              }}
              onAction={stripeError ? () => loadPaymentMethods() : undefined}
            />
          )}

          {showPaymentPromise ? (
            payingWithRow && <View style={[styles.rowGroup, styles.payingWith]}>{payingWithRow}</View>
          ) : (
            <>
              <View style={styles.rowGroup}>
                <View style={styles.row}>
                  <Text style={styles.rowLabel}>Wallet balance</Text>
                  <Text style={styles.rowValue}>{money(balance)}</Text>
                </View>
                {needsPayment ? (
                  <>
                    <View style={styles.row}>
                      <Text style={styles.rowLabel}>Charged now</Text>
                      <Text style={styles.rowValue}>{money(chargeAmount)}</Text>
                    </View>
                    {payingWithRow}
                  </>
                ) : (
                  <View style={styles.row}>
                    <Text style={styles.rowLabel}>After this hire</Text>
                    <Text style={styles.rowValue}>{money(Math.max(0, balance - amount))}</Text>
                  </View>
                )}
              </View>

              <TrustSafetyNotice message={trustSafetyStrings.posterHire} />
              <Text style={styles.body}>
                {trustSafetyStrings.paymentProtection} Refunds and releases depend on the bounty’s state and any dispute review.
              </Text>
            </>
          )}
        </View>
        </ScrollView>

        <View style={styles.actions}>
          {showApplePay && (
            <TouchableOpacity
              style={[styles.applePayButton, { backgroundColor: applePayBg }, busy && styles.muted]}
              onPress={handleApplePay}
              disabled={busy}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Pay ${chargeAmount.toFixed(2)} dollars with Apple Pay and hire`}
              accessibilityState={{ disabled: busy, busy: isProcessing }}
            >
              {isProcessing ? (
                <ActivityIndicator size="small" color={applePayFg} />
              ) : (
                <>
                  <MaterialIcons name="apple" size={22} color={applePayFg} />
                  <Text style={[styles.applePayButtonText, { color: applePayFg }]}>Pay</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={primaryA11y}
            accessibilityState={{ disabled: primaryDisabled, busy }}
            style={[styles.primaryButton, primaryDisabled && styles.muted]}
            disabled={primaryDisabled}
            onPress={needsPayment ? handlePrimaryPay : handleConfirm}
            activeOpacity={0.85}
          >
            {busy || (needsPayment && stripeLoading) ? (
              <ActivityIndicator
                size="small"
                color={ON_PRIMARY_TEXT}
                style={styles.buttonSpinner}
              />
            ) : null}
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>

          {showOtherWays && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`${otherWaysLabel} to pay ${chargeAmount.toFixed(2)} dollars`}
              accessibilityState={{ disabled: busy }}
              style={styles.secondaryButton}
              disabled={busy}
              onPress={handlePaymentSheet}
            >
              <Text style={styles.otherWaysText}>{otherWaysLabel}</Text>
            </TouchableOpacity>
          )}

          {paymentPending && gate.canLeavePending ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Back to My Jobs"
              style={styles.secondaryButton}
              onPress={() => {
                hapticFeedback.light();
                gate.onLeavePending();
                onLeavePending?.();
              }}
              testID="hire-leave-pending"
            >
              <Text style={styles.secondaryButtonText}>Back to My Jobs</Text>
            </TouchableOpacity>
          ) : (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={
              showPaymentPromise ? paymentPromiseStrings.notYetA11y : 'Not yet, go back without choosing anyone'
            }
            accessibilityState={{ disabled: isProcessing || paymentPending }}
            style={styles.secondaryButton}
            disabled={isProcessing || paymentPending}
            onPress={handleCancel}
          >
            <Text style={styles.secondaryButtonText}>
              {showPaymentPromise ? paymentPromiseStrings.notYet : hire.cancel}
            </Text>
          </TouchableOpacity>
          )}
        </View>
      </View>

      {showPaymentMethodsModal && (
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => {
            setShowPaymentMethodsModal(false);
            loadPaymentMethods().catch(() => {});
          }}
          onBackdropPress={() => {
            // Unlike the wallet keypad, dismissing the modal does NOT leave
            // the sheet: the poster is mid-hire and the only thing that
            // changed is whether a card exists yet.
            setShowPaymentMethodsModal(false);
            loadPaymentMethods().catch(() => {});
          }}
        />
      )}
    </View>
  );
}

/** Matches the on-primary convention used across onboarding/wallet CTAs. */
const ON_PRIMARY_TEXT = '#FFFFFF';

const makeStyles = (theme: AppTheme, metrics: GateMetrics) =>
  StyleSheet.create({
    focusHead: { gap: 18 },
    noFees: { color: theme.poster.ink2, fontSize: 15 },
    pending: { gap: 10 },
    pendingNow: { color: theme.poster.ink, fontSize: 24, fontWeight: '800', lineHeight: 30 },
    pendingMeans: { color: theme.poster.ink, fontSize: 17, lineHeight: 25 },
    root: { flex: 1, backgroundColor: theme.background },
    // The scrollable info block and the fixed actions footer as siblings:
    // actions size to their own content and stay pinned below the scroll
    // area, so they're reachable regardless of how much room the info block
    // needs.
    sheet: {
      flex: 1,
      paddingHorizontal: metrics.horizontalPadding,
    },
    scroll: { flex: 1 },
    // flexGrow + centering means short content (the common case, thanks to
    // getGateMetrics) is centered in the available space exactly as before;
    // content that doesn't fit scrolls from the top instead of clipping.
    scrollContent: { flexGrow: 1, justifyContent: 'center' },
    info: { gap: metrics.sectionGap },
    eyebrow: {
      color: theme.textSecondary,
      fontSize: metrics.eyebrowFontSize,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    hunterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    avatar: {
      width: metrics.avatarSize,
      height: metrics.avatarSize,
      borderRadius: metrics.avatarSize / 2,
      backgroundColor: theme.surfaceSecondary,
    },
    avatarFallbackText: {
      color: theme.text,
      fontSize: Math.round(metrics.avatarSize * 0.4),
      fontWeight: '700',
    },
    hunterText: { flex: 1, gap: 2 },
    title: { color: theme.text, fontSize: metrics.titleFontSize, fontWeight: '800' },
    subtitle: { color: theme.textSecondary, fontSize: metrics.subtitleFontSize },
    card: {
      backgroundColor: theme.surface,
      ...theme.insetBorder, // pressed-in edge: dark top → light bottom
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: metrics.cardPaddingVertical,
      paddingHorizontal: 16,
      alignItems: 'center',
      gap: 4,
    },
    promiseCard: {
      backgroundColor: theme.surface,
      ...theme.insetBorder, // pressed-in edge: dark top → light bottom
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: metrics.cardPaddingVertical,
      paddingHorizontal: 20,
      gap: metrics.sectionGap,
    },
    promiseSummary: {
      color: theme.text,
      fontSize: metrics.rowFontSize + 4,
      lineHeight: metrics.rowFontSize + 12,
      fontWeight: '700',
    },
    promiseSource: {
      color: theme.text,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
      fontWeight: '600',
    },
    promiseHold: {
      color: theme.textSecondary,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
    },
    amount: { color: theme.text, fontSize: metrics.amountFontSize, fontWeight: '800' },
    amountCaption: { color: theme.textSecondary, fontSize: metrics.captionFontSize },
    heldRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: metrics.compact ? 6 : 10,
    },
    heldText: { color: theme.textSecondary, fontSize: metrics.heldFontSize, fontWeight: '600' },
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      padding: metrics.compact ? 8 : 12,
    },
    noticeText: {
      flex: 1,
      color: theme.text,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
    },
    failure: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      borderLeftWidth: 3,
      borderLeftColor: theme.error,
      padding: metrics.compact ? 8 : 12,
    },
    failureText: { flex: 1, gap: 2 },
    failureTitle: {
      color: theme.text,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
      fontWeight: '700',
    },
    failureBody: {
      color: theme.textSecondary,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
    },
    body: {
      color: theme.textSecondary,
      fontSize: metrics.bodyFontSize,
      lineHeight: metrics.bodyFontSize + 6,
    },
    rowGroup: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 4,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingVertical: metrics.rowPaddingVertical,
    },
    // Narrower than the summary card, so it reads as a detail under it.
    payingWith: { alignSelf: 'center', width: '88%', paddingHorizontal: 14, paddingVertical: 0 },
    payingText: { fontSize: metrics.rowFontSize - 2 },
    rowStack: { flex: 1, gap: 2, paddingRight: 10 },
    rowLabel: { color: theme.textSecondary, fontSize: metrics.rowFontSize },
    rowValue: { color: theme.text, fontSize: metrics.rowFontSize, fontWeight: '600' },
    changeLink: { color: theme.primaryLight, fontSize: metrics.rowFontSize, fontWeight: '600' },
    actions: {
      paddingTop: metrics.sectionGap,
      gap: metrics.compact ? 8 : 12,
    },
    applePayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 12,
      paddingVertical: metrics.buttonPaddingVertical,
    },
    applePayButtonText: { fontSize: metrics.buttonFontSize, fontWeight: '600' },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      borderRadius: 12,
      paddingVertical: metrics.buttonPaddingVertical,
    },
    primaryButtonText: {
      color: ON_PRIMARY_TEXT,
      fontSize: metrics.buttonFontSize,
      fontWeight: '700',
    },
    buttonSpinner: { marginRight: 8 },
    muted: { opacity: 0.45 },
    secondaryButton: { paddingVertical: metrics.secondaryPaddingVertical, alignItems: 'center' },
    otherWaysText: {
      color: theme.primaryLight,
      fontSize: metrics.buttonFontSize - 1,
      fontWeight: '600',
    },
    secondaryButtonText: {
      color: theme.text,
      fontSize: metrics.buttonFontSize - 2,
      fontWeight: '600',
    },
  });

export default AcceptFundingGate;
