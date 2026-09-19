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
 * (hooks/use-wallet-deposit: Stripe card confirm / Apple Pay, then
 * /wallet/deposit) for exactly the shortfall, and hands the result straight
 * back to the gate — no keypad, no "add funds" detour, no success modal to
 * dismiss. When the server confirms the balance the gate resolves on its own
 * and useAcceptRequest calls acceptRequest.
 *
 * What replaced the old confirm -> insufficient -> top-up -> re-check chain
 * is deliberately smaller, not just shorter: the only decisions left on this
 * screen are "hire this person for this amount" and "not now".
 */

import { MaterialIcons } from '@expo/vector-icons';
import { ErrorBanner } from 'components/error-banner';
import { PaymentMethodsModal } from 'components/payment-methods-modal';
import { Avatar, AvatarFallback, AvatarImage } from 'components/ui/avatar';
import type { AcceptFundingGate as AcceptFundingGateState } from 'hooks/useAcceptFunding';
import { useWalletDeposit } from 'hooks/use-wallet-deposit';
import { getBottomNavContentGap, getBottomNavOccludedHeight } from 'lib/constants/navigation';
import { hapticFeedback } from 'lib/haptic-feedback';
import { stripeService } from 'lib/services/stripe-service';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import { getUserFriendlyError } from 'lib/utils/error-messages';
import React, { useEffect, useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface AcceptFundingGateProps {
  gate: AcceptFundingGateState;
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
 * without scrolling. A 320×568 SE gets a tighter sheet; a 430×932 Pro Max a
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
    cardPaddingVertical: clamp(h * 0.024, compact ? 10 : 14, 24),
    rowPaddingVertical: clamp(h * 0.014, compact ? 7 : 9, 12),
    eyebrowFontSize: clamp(h * 0.017, 11, 12),
    titleFontSize: clamp(Math.min(width * 0.068, h * 0.032), 20, 28),
    subtitleFontSize: clamp(h * 0.019, 12, 14),
    amountFontSize: clamp(Math.min(width * 0.11, h * 0.052), 30, 44),
    captionFontSize: clamp(h * 0.018, 12, 13),
    heldFontSize: clamp(h * 0.02, 13, 14),
    rowFontSize: clamp(h * 0.02, 13, 14),
    bodyFontSize: clamp(h * 0.019, 12, 14),
    buttonPaddingVertical: clamp(h * 0.019, compact ? 12 : 14, 18),
    buttonFontSize: clamp(h * 0.022, 15, 16),
    secondaryPaddingVertical: clamp(h * 0.014, compact ? 8 : 10, 14),
    avatarSize: clamp(Math.min(width * 0.13, h * 0.06), 40, 52),
  };
}

type GateMetrics = ReturnType<typeof getGateMetrics>;

export function AcceptFundingGate({ gate }: AcceptFundingGateProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  // The floating BottomNav is position:absolute and overlays this gate, so the
  // action buttons must clear the bar's *occluded* height — the bar box plus
  // the crosshair that floats above its top edge — as well as the device safe
  // area. Same derivation as insufficient-balance-screen and add-money-screen.
  const footerClearance =
    getBottomNavOccludedHeight(insets.bottom, windowWidth) + getBottomNavContentGap(windowHeight);
  const usableHeight = windowHeight - insets.top - footerClearance;

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
    paymentMethods,
    stripeLoading,
    stripeError,
    loadPaymentMethods,
    payWithCard,
    payWithApplePay,
  } = useWalletDeposit();

  const amount = gate.requirement?.amountRequired ?? 0;
  const shortfall = gate.requirement?.shortfall ?? 0;
  const balance = gate.requirement?.posterBalance ?? 0;
  const needsPayment = shortfall > 0;
  const chargeAmount = chargeAmountForShortfall(shortfall);
  const settling = gate.stage === 'settling';
  const hasPaymentMethod = paymentMethods.length > 0;
  const busy = isProcessing || settling;

  // --- Deposit outcome -> gate --------------------------------------------
  // use-wallet-deposit reports success by setting `successInfo` (the wallet's
  // keypad shows a "Success!" modal on it). Here nothing is shown: the gate
  // re-checks the server and, if covered, the hire proceeds on its own.
  const outcomeHandledRef = useRef(false);
  useEffect(() => {
    if (!successInfo) return;
    outcomeHandledRef.current = true;
    const paid = successInfo.amount;
    setSuccessInfo(null);
    gate.onPaymentSucceeded(paid);
    // gate callbacks are recreated per render; the effect is keyed on the
    // outcome, not the handler identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [successInfo]);

  // A charge that ended without `successInfo` either errored (the hook set
  // `error`) or was dismissed (Apple Pay cancel sets nothing at all). Both are
  // "nothing charged, sheet stays up"; they differ only in the reason the
  // funnel records.
  const wasProcessingRef = useRef(false);
  useEffect(() => {
    if (isProcessing) {
      wasProcessingRef.current = true;
      outcomeHandledRef.current = false;
      return;
    }
    if (!wasProcessingRef.current) return;
    wasProcessingRef.current = false;
    if (outcomeHandledRef.current || successInfo) return;
    gate.onPaymentFailed(error ? 'failed' : 'cancelled');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessing]);

  // --- Actions --------------------------------------------------------------
  const handleConfirm = () => {
    hapticFeedback.light();
    gate.onConfirm();
  };

  const handlePayWithCard = async () => {
    // Guarded here as well as via `disabled`: an empty method list while
    // Stripe is still loading must never be mistaken for "no card on file".
    if (busy || stripeLoading) return;
    hapticFeedback.light();
    if (!hasPaymentMethod) {
      // No card on file: linking one is the first half of the same tap, not a
      // separate screen. The sheet stays put and the button becomes "Pay" once
      // the modal closes with a method loaded.
      setShowPaymentMethodsModal(true);
      return;
    }
    gate.onPaymentStarted('card');
    await payWithCard(chargeAmount);
  };

  const handleApplePay = async () => {
    if (busy) return;
    hapticFeedback.light();
    gate.onPaymentStarted('applePay');
    await payWithApplePay(chargeAmount);
  };

  const handleCancel = () => {
    // Backing out under an in-flight charge would orphan its outcome; the
    // buttons are disabled then, this is belt-and-braces.
    if (isProcessing) return;
    hapticFeedback.light();
    gate.onCancel();
  };

  // --- Copy ----------------------------------------------------------------
  const money = (n: number) => `$${n.toFixed(2)}`;
  const initial = gate.hunterName.trim().charAt(0).toUpperCase() || '?';

  let primaryLabel: string;
  let primaryA11y: string;
  if (settling) {
    primaryLabel = 'Confirming payment…';
    primaryA11y = 'Confirming your payment';
  } else if (!needsPayment) {
    primaryLabel = 'Confirm & hire';
    primaryA11y = `Confirm and hire ${gate.hunterName} for ${amount.toFixed(2)} dollars`;
  } else if (stripeLoading) {
    primaryLabel = 'Checking payment methods…';
    primaryA11y = 'Checking payment methods';
  } else if (!hasPaymentMethod) {
    primaryLabel = `Link a card to pay ${money(chargeAmount)}`;
    primaryA11y = `Link a payment method to pay ${chargeAmount.toFixed(2)} dollars and hire`;
  } else if (isProcessing) {
    primaryLabel = 'Processing…';
    primaryA11y = 'Processing payment';
  } else {
    primaryLabel = `Pay ${money(chargeAmount)} & hire`;
    primaryA11y = `Pay ${chargeAmount.toFixed(2)} dollars and hire ${gate.hunterName}`;
  }
  const primaryDisabled = busy || (needsPayment && stripeLoading);
  const showApplePay = Platform.OS === 'ios' && needsPayment && !settling;

  // Apple's HIG calls for a black Apple Pay button on light backgrounds and a
  // white one on dark backgrounds, so the mark stays crisp in both themes.
  const applePayBg = theme.isDark ? '#ffffff' : '#000000';
  const applePayFg = theme.isDark ? '#000000' : '#ffffff';

  return (
    <View style={styles.root}>
      {/* One column, no ScrollView: the information and the buttons share a
          single flex container so they are always on screen together. The
          info block sits at the top, the actions at the bottom, and whatever
          room is left over goes between them rather than below the fold. */}
      <View
        style={[
          styles.sheet,
          { paddingTop: insets.top + metrics.topPadding, paddingBottom: footerClearance },
        ]}
      >
        <View style={styles.info}>
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
              <Text style={styles.subtitle}>Bounty reward {money(amount)}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text
              style={styles.amount}
              accessibilityLabel={`${(needsPayment ? chargeAmount : amount).toFixed(2)} dollars`}
            >
              {money(needsPayment ? chargeAmount : amount)}
            </Text>
            <Text style={styles.amountCaption}>
              {needsPayment ? 'charged to your card now' : 'from your wallet balance'}
            </Text>
            <View style={styles.heldRow}>
              <MaterialIcons name="lock-outline" size={16} color={theme.textSecondary} />
              <Text style={styles.heldText}>Held until you approve the work</Text>
            </View>
          </View>

          {gate.remainderAfterDeposit && (
            <View style={styles.notice} accessibilityRole="alert">
              <MaterialIcons name="info-outline" size={18} color={theme.primary} />
              <Text style={styles.noticeText}>
                Payment received. {money(chargeAmount)} more is needed to hire {gate.hunterName}.
              </Text>
            </View>
          )}

          {(error || stripeError) && (
            <ErrorBanner
              error={getUserFriendlyError(error || stripeError)}
              onDismiss={() => {
                setError(null);
                if (stripeError) loadPaymentMethods().catch(() => {});
              }}
              onAction={
                error?.type === 'payment'
                  ? () => {
                      gate.onPaymentStarted('card');
                      void payWithCard(chargeAmount);
                    }
                  : stripeError
                  ? () => loadPaymentMethods()
                  : undefined
              }
            />
          )}

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
                {hasPaymentMethod && !stripeLoading && (
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => setShowPaymentMethodsModal(true)}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel={`Change payment method, currently ${stripeService.formatCardDisplay(
                      paymentMethods[0]
                    )}`}
                  >
                    <Text style={styles.rowLabel}>Paying with</Text>
                    <View style={styles.rowInline}>
                      <Text style={styles.rowValue}>
                        {stripeService.formatCardDisplay(paymentMethods[0])}
                      </Text>
                      <Text style={styles.changeLink}>Change</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <View style={styles.row}>
                <Text style={styles.rowLabel}>After this hire</Text>
                <Text style={styles.rowValue}>{money(Math.max(0, balance - amount))}</Text>
              </View>
            )}
          </View>

          {/* Reassurance copy is the first thing traded for room on a short
            screen — the lock line above already carries the guarantee. */}
          {!metrics.compact && (
            <Text style={styles.body}>
              If it doesn&apos;t work out, you can cancel and the money comes back to your wallet.
            </Text>
          )}
        </View>

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
            onPress={needsPayment ? handlePayWithCard : handleConfirm}
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

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Not now, go back without hiring"
            accessibilityState={{ disabled: isProcessing }}
            style={styles.secondaryButton}
            disabled={isProcessing}
            onPress={handleCancel}
          >
            <Text style={styles.secondaryButtonText}>Not now</Text>
          </TouchableOpacity>
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
const ON_PRIMARY_TEXT = '#052e1b';

const makeStyles = (theme: AppTheme, metrics: GateMetrics) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: theme.background },
    // The single container for everything: info pinned to the top, actions to
    // the bottom, spare room between. No scrolling, no separate footer.
    sheet: {
      flex: 1,
      justifyContent: 'space-between',
      paddingHorizontal: metrics.horizontalPadding,
    },
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
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 16,
      paddingVertical: metrics.cardPaddingVertical,
      paddingHorizontal: 16,
      alignItems: 'center',
      gap: 4,
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
    rowInline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    rowLabel: { color: theme.textSecondary, fontSize: metrics.rowFontSize },
    rowValue: { color: theme.text, fontSize: metrics.rowFontSize, fontWeight: '600' },
    changeLink: { color: theme.primary, fontSize: metrics.rowFontSize, fontWeight: '600' },
    actions: {
      paddingTop: metrics.sectionGap,
      gap: metrics.compact ? 8 : 12,
    },
    applePayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: 14,
      paddingVertical: metrics.buttonPaddingVertical,
    },
    applePayButtonText: { fontSize: metrics.buttonFontSize, fontWeight: '600' },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      borderRadius: 14,
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
    secondaryButtonText: {
      color: theme.textSecondary,
      fontSize: metrics.buttonFontSize - 1,
      fontWeight: '600',
    },
  });

export default AcceptFundingGate;
