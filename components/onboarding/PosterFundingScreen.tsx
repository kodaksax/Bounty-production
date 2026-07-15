import { MaterialIcons } from '@expo/vector-icons';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildDepositSuccessMessage, useWalletDeposit } from '../../hooks/use-wallet-deposit';
import { hapticFeedback } from '../../lib/haptic-feedback';
import type { OnboardingDetailsStyles } from '../../lib/onboarding/onboarding-details-styles';
import { stripeService } from '../../lib/services/stripe-service';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import { getUserFriendlyError } from '../../lib/utils/error-messages';
import { ErrorBanner } from '../error-banner';
import { PaymentMethodsModal } from '../payment-methods-modal';
import { BrandingLogo } from '../ui/branding-logo';
import { EscrowExplainer } from '../ui/escrow-explainer';
import { FeedbackModal } from '../ui/feedback-modal';
import { InfoTooltip } from '../ui/tooltip';
import { OnboardingProgressDots } from './OnboardingProgressDots';

type PosterFundingScreenProps = {
  styles: OnboardingDetailsStyles;
  price: string;
  posting: boolean;
  onBack: () => void;
  onFunded: () => void;
  onSkip: () => void;
};

// Text color placed on top of the bright brand-green primary fill, matching
// the dark-on-green convention used across onboarding/wallet.
const ON_PRIMARY_TEXT = '#052e1b';

// Poster branch, step 3 of 4. Confirms funding for the exact bounty amount
// chosen on the previous step (no editable keypad here — that decision was
// already made) so this reads as a single, purpose-built payment
// confirmation rather than a generic wallet top-up dropped into onboarding.
// A DB trigger (fn_reserve_bounty_escrow) requires the wallet balance to
// already cover the bounty amount at the moment the bounty row is inserted,
// which is why this funding step exists as a distinct step from the task
// composer.
export function PosterFundingScreen({ styles, price, posting, onBack, onFunded, onSkip }: PosterFundingScreenProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const amount = Number(price) || 0;

  const {
    isProcessing,
    error, setError,
    successInfo, setSuccessInfo,
    showPaymentMethodsModal, setShowPaymentMethodsModal,
    paymentMethods, stripeLoading, stripeError, loadPaymentMethods,
    payWithCard, payWithApplePay,
  } = useWalletDeposit();

  const hasPaymentMethod = paymentMethods.length > 0;
  const busy = isProcessing || stripeLoading || posting;

  const applePayBg = theme.isDark ? '#ffffff' : '#000000';
  const applePayFg = theme.isDark ? '#000000' : '#ffffff';

  const handleBack = () => {
    if (posting) return;
    hapticFeedback.light();
    onBack();
  };

  const handleCardPayment = async () => {
    hapticFeedback.light();
    await payWithCard(amount);
  };

  const handleApplePayPress = async () => {
    hapticFeedback.light();
    await payWithApplePay(amount);
  };

  let primaryLabel: string;
  if (posting) primaryLabel = 'Posting…';
  else if (!hasPaymentMethod) primaryLabel = 'Link Payment Method';
  else if (isProcessing) primaryLabel = 'Processing…';
  else if (stripeLoading) primaryLabel = 'Checking Methods…';
  else primaryLabel = `Add $${price || '0'} & Post Bounty`;

  return (
    <View style={styles.fundingContainer}>
      <View style={[styles.fundingHeader, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.fundingHeaderButton}
          disabled={posting}
          accessibilityRole="button"
          accessibilityLabel="Back to bounty details"
        >
          <MaterialIcons name="close" size={24} color={theme.text} />
        </TouchableOpacity>
        <BrandingLogo size="small" />
        <View style={styles.fundingHeaderButton} />
      </View>

      <OnboardingProgressDots total={4} activeIndex={2} />

      <ScrollView
        style={styles.fundingScroll}
        contentContainerStyle={styles.fundingScrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.fundingTitle} accessibilityRole="header">
          Add ${price || '0'} to post this as a paid bounty
        </Text>

        <View style={styles.fundingAmountSection}>
          <Text style={styles.fundingAmountLabel}>Amount needed</Text>
          <Text
            style={styles.fundingAmountText}
            accessibilityRole="text"
            accessibilityLabel={`Amount needed, $${price || '0'}`}
          >
            ${price || '0'}
          </Text>
        </View>

        <View style={styles.fundingEscrowWrapper}>
          <EscrowExplainer amount={amount} variant="inline" />
        </View>

        {(error || stripeError) && (
          <View style={styles.fundingErrorWrapper}>
            <ErrorBanner
              error={getUserFriendlyError(error || stripeError)}
              onDismiss={() => {
                setError(null);
                if (stripeError) loadPaymentMethods().catch(() => { });
              }}
              onAction={error?.type === 'payment' ? () => payWithCard(amount) : (stripeError ? () => loadPaymentMethods() : undefined)}
            />
          </View>
        )}

        <View style={styles.fundingPaymentSection}>
          <Text style={styles.fundingSectionLabel}>Payment method</Text>
          {stripeLoading ? (
            <View style={styles.fundingPaymentCard}>
              <ActivityIndicator size="small" color={theme.textSecondary} />
              <Text style={styles.fundingPaymentCardText}>Checking payment methods…</Text>
            </View>
          ) : hasPaymentMethod ? (
            <TouchableOpacity
              style={styles.fundingPaymentCard}
              onPress={() => setShowPaymentMethodsModal(true)}
              accessibilityRole="button"
              accessibilityLabel={`Change payment method, currently ${stripeService.formatCardDisplay(paymentMethods[0])}`}
            >
              <View style={styles.fundingPaymentCardIcon}>
                <MaterialIcons name="credit-card" size={20} color={theme.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fundingPaymentCardText}>{stripeService.formatCardDisplay(paymentMethods[0])}</Text>
                <Text style={styles.fundingPaymentCardSub}>Default payment method</Text>
              </View>
              <Text style={styles.fundingChangeLink}>Change</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={styles.fundingPaymentCard}
              onPress={() => setShowPaymentMethodsModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Link a card or bank account"
            >
              <View style={styles.fundingPaymentCardIcon}>
                <MaterialIcons name="add" size={20} color={theme.primary} />
              </View>
              <Text style={[styles.fundingPaymentCardText, { flex: 1 }]}>Link a card or bank account</Text>
              <MaterialIcons name="chevron-right" size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <View style={[styles.fundingActions, { paddingBottom: insets.bottom + 16 }]}>
        {Platform.OS === 'ios' && (
          <TouchableOpacity
            style={[styles.fundingApplePayButton, { backgroundColor: applePayBg }]}
            onPress={handleApplePayPress}
            disabled={amount <= 0 || busy}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Pay with Apple Pay"
            accessibilityState={{ disabled: amount <= 0 || busy, busy: isProcessing }}
          >
            {isProcessing ? (
              <ActivityIndicator size="small" color={applePayFg} />
            ) : (
              <>
                <MaterialIcons name="apple" size={22} color={applePayFg} />
                <Text style={[styles.fundingApplePayButtonText, { color: applePayFg, marginLeft: 6 }]}>Pay</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.fundingPrimaryButton, busy && styles.fundingPrimaryButtonMuted]}
          disabled={busy}
          onPress={!hasPaymentMethod ? () => setShowPaymentMethodsModal(true) : handleCardPayment}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={!hasPaymentMethod ? 'Link a payment method' : `Add $${price || '0'} and post bounty`}
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy && (
            <ActivityIndicator size="small" color={ON_PRIMARY_TEXT} style={{ marginRight: 8 }} />
          )}
          <Text style={styles.fundingPrimaryButtonText}>{primaryLabel}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.forHonorRow}>
        <Text style={styles.forHonorLabel}>Prefer not to pay?</Text>
        <InfoTooltip
          title="What is a For Honor bounty?"
          content="For Honor bounties are completed without any payment — ideal for volunteer work, community requests, or favors. Hunters take them on to help out and build their reputation, not to earn money. You can always add payment to a future bounty."
          iconSize={16}
        />
      </View>
      <TouchableOpacity
        style={styles.skipLink}
        onPress={onSkip}
        disabled={posting}
        accessibilityRole="button"
        accessibilityLabel="Post as a For Honor bounty instead, no payment required"
      >
        <Text style={styles.fundingSkipLinkText}>
          {posting ? 'Posting…' : 'Post as For Honor instead'}
        </Text>
      </TouchableOpacity>

      {showPaymentMethodsModal && (
        <PaymentMethodsModal
          isOpen={showPaymentMethodsModal}
          onClose={() => {
            setShowPaymentMethodsModal(false);
            loadPaymentMethods();
          }}
          onBackdropPress={() => {
            setShowPaymentMethodsModal(false);
            loadPaymentMethods();
          }}
        />
      )}

      {/* Success confirmation — tapping through posts the bounty immediately,
          making the fund → post relationship explicit rather than implicit. */}
      <FeedbackModal
        visible={!!successInfo}
        variant="success"
        title="Funded!"
        message={successInfo ? buildDepositSuccessMessage(successInfo) : ''}
        actionLabel="Post Bounty"
        onDismiss={() => {
          setSuccessInfo(null);
          onFunded();
        }}
      />
    </View>
  );
}
