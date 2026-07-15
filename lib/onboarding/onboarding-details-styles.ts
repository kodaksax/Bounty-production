/**
 * Shared styles for the onboarding "details" step and its branch screens
 * (profile form, poster composer/funding, hunter location/sample-bounty).
 * Extracted from app/onboarding/details.tsx so each branch can live in its
 * own component file without duplicating this ~600-line StyleSheet.
 */
import { StyleSheet } from 'react-native';
import type { AppTheme } from '../themes/types';

export function makeOnboardingDetailsStyles(theme: AppTheme) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scrollContent: {
      flexGrow: 1,
      paddingHorizontal: 24,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 8,
      marginBottom: 16,
    },
    backButton: {
      padding: 8,
    },
    brandingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    brandingText: {
      fontSize: 18,
      fontWeight: 'bold',
      color: theme.text,
      letterSpacing: 2,
      marginLeft: 6,
    },
    avatarSection: {
      alignItems: 'center',
      marginBottom: 20,
    },
    avatarContainer: {
      position: 'relative',
    },
    avatarImageWrapper: {
      width: 100,
      height: 100,
      borderRadius: 50,
      overflow: 'hidden',
      borderWidth: 3,
      borderColor: theme.border,
    },
    avatarImage: {
      width: '100%',
      height: '100%',
    },
    avatarPlaceholder: {
      width: 100,
      height: 100,
      borderRadius: 50,
      backgroundColor: theme.surface,
      borderWidth: 3,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarEditBadge: {
      position: 'absolute',
      bottom: 0,
      right: 0,
      width: 32,
      height: 32,
      borderRadius: 16,
      backgroundColor: theme.primary,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 2,
      borderColor: theme.background,
    },
    avatarHint: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 8,
    },
    avatarSubhint: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 4,
    },
    header: {
      alignItems: 'center',
      marginBottom: 24,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 8,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      paddingHorizontal: 16,
    },
    inputSection: {
      marginBottom: 24,
    },
    field: {
      marginBottom: 20,
    },
    label: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    input: {
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: theme.text,
      borderWidth: 1,
      borderColor: theme.border,
    },
    bioInput: {
      minHeight: 80,
      textAlignVertical: 'top',
      paddingTop: 12,
    },
    hint: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 6,
      paddingHorizontal: 4,
    },
    hintWithMargin: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 6,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    skillsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    skillChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      backgroundColor: theme.surface,
      borderWidth: 2,
      borderColor: theme.border,
    },
    skillChipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    skillChipText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    skillChipTextSelected: {
      color: '#052e1b',
      fontWeight: '600',
    },
    customSkillsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    customSkillChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 20,
      backgroundColor: theme.surfaceSecondary,
      borderWidth: 1,
      borderColor: theme.border,
    },
    customSkillText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
    customSkillInput: {
      position: 'relative',
    },
    addSkillButton: {
      position: 'absolute',
      right: 8,
      top: 8,
      backgroundColor: theme.primary,
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actions: {
      marginBottom: 24,
    },
    nextButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 16,
      borderRadius: 999,
      marginBottom: 12,
      gap: 8,
    },
    nextButtonText: {
      color: '#052e1b',
      fontSize: 18,
      fontWeight: 'bold',
    },
    skipButton: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipButtonText: {
      color: theme.textSecondary,
      fontSize: 16,
    },
    progressContainer: {
      paddingTop: 16,
    },
    posterContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    posterHeading: {
      fontSize: 30,
      fontWeight: '600',
      color: theme.text,
      textAlign: 'center',
      marginTop: 24,
      marginBottom: 32,
    },
    dottedBox: {
      borderWidth: 2,
      borderStyle: 'dashed',
      borderColor: theme.isDark ? 'rgba(255,255,255,0.35)' : theme.textSecondary,
      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'transparent',
      borderRadius: 12,
      padding: 16,
      marginBottom: 24,
    },
    dottedBoxLabel: {
      color: theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 8,
    },
    dottedBoxExample: {
      color: theme.isDark ? 'rgba(255,255,255,0.75)' : theme.textSecondary,
      fontSize: 15,
      lineHeight: 22,
      fontStyle: 'italic',
    },
    dottedBoxInput: {
      color: theme.text,
      fontSize: 15,
      lineHeight: 22,
      minHeight: 44,
      padding: 0,
      textAlignVertical: 'top',
    },
    priceBox: {
      borderWidth: 2,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      borderRadius: 16,
      padding: 16,
    },
    priceBoxHint: {
      color: theme.textSecondary,
      fontSize: 13,
      marginBottom: 12,
    },
    priceInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    priceInputPill: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      gap: 6,
    },
    priceCurrency: {
      fontSize: 20,
      fontWeight: '700',
      color: '#111827',
    },
    priceInput: {
      fontSize: 20,
      fontWeight: '700',
      color: '#111827',
      minWidth: 40,
      padding: 0,
    },
    priceSimilarText: {
      color: theme.textSecondary,
      fontSize: 13,
      marginLeft: 12,
    },
    priceChipsRow: {
      flexDirection: 'row',
      gap: 8,
    },
    priceChip: {
      borderWidth: 1.5,
      borderColor: theme.text,
      borderRadius: 999,
      paddingHorizontal: 18,
      paddingVertical: 8,
    },
    priceChipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    priceChipText: {
      color: theme.text,
      fontSize: 14,
      fontWeight: '600',
    },
    priceChipTextSelected: {
      color: '#052e1b',
    },
    posterActions: {
      paddingHorizontal: 24,
      paddingBottom: 40,
    },
    hunterContent: {
      flex: 1,
      paddingHorizontal: 24,
    },
    hunterStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 16,
      marginBottom: 32,
      gap: 8,
    },
    hunterStatusSeparator: {
      color: theme.textSecondary,
      fontSize: 14,
    },
    hunterStatusText: {
      color: theme.textSecondary,
      fontSize: 14,
    },
    hunterStatusName: {
      color: theme.text,
      fontWeight: '700',
    },
    bountyCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
    },
    bountyCardTopRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    bountyCardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.textSecondary,
    },
    bountyCardPrice: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.textSecondary,
    },
    bountyCardMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    bountyCardMetaText: {
      fontSize: 14,
      color: theme.textDisabled,
    },
    hunterHeading: {
      fontSize: 28,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginTop: 8,
      marginBottom: 40,
    },
    hunterSpacer: {
      flex: 1,
    },
    hunterActions: {
      paddingBottom: 16,
      gap: 12,
    },
    hunterEmptyNote: {
      fontSize: 13,
      color: theme.textDisabled,
      textAlign: 'center',
      marginBottom: 8,
    },
    locationButton: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 18,
      borderRadius: 999,
    },
    locationButtonText: {
      color: '#ffffff',
      fontSize: 18,
      fontWeight: 'bold',
    },
    zipButton: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surface,
      borderWidth: 2,
      borderColor: theme.text,
      paddingVertical: 18,
      borderRadius: 999,
    },
    zipButtonText: {
      color: theme.text,
      fontSize: 18,
      fontWeight: 'bold',
    },
    hunterFootnote: {
      fontSize: 13,
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 16,
      marginBottom: 24,
      paddingHorizontal: 16,
    },
    earnBanner: {
      borderWidth: 2,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      borderRadius: 16,
      paddingVertical: 18,
      alignItems: 'center',
      marginTop: 16,
      marginBottom: 20,
    },
    earnBannerText: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.primary,
    },
    earnBannerAmount: {
      fontWeight: '800',
    },
    sampleCardTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    sampleCardPrice: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
    },
    viewAcceptButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 14,
      borderRadius: 999,
      marginTop: 14,
    },
    viewAcceptButtonText: {
      color: '#ffffff',
      fontSize: 16,
      fontWeight: 'bold',
    },
    detailSheet: {
      borderWidth: 2,
      borderColor: theme.text,
      borderRadius: 16,
      padding: 16,
      marginTop: 16,
    },
    detailSheetLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1,
      color: theme.textSecondary,
      marginBottom: 8,
    },
    detailSheetText: {
      fontSize: 17,
      fontWeight: '700',
      color: theme.text,
    },
    skipLink: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    skipLinkText: {
      fontSize: 15,
      color: theme.textDisabled,
      textDecorationLine: 'underline',
    },
    // Subtle poster<->hunter escape hatch. Deliberately smaller/lighter than
    // skipLinkText (no underline) so it reads as secondary to both the
    // primary CTA and the "Skip for now" link.
    switchPathLink: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    switchPathLinkText: {
      fontSize: 13,
      color: theme.textDisabled,
    },
    fundingContainer: {
      flex: 1,
      backgroundColor: theme.background,
    },
    fundingHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 24,
      paddingBottom: 4,
    },
    fundingHeaderButton: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Safety-net scroll: the fixed-amount confirm screen (no keypad) is short
    // enough to fit on one screen in normal use, but this still guards against
    // very small devices or large accessibility text sizes without any
    // device-specific spacing hacks — content centers when it fits, scrolls
    // when it doesn't.
    fundingScroll: {
      flex: 1,
    },
    fundingScrollContent: {
      flexGrow: 1,
      justifyContent: 'center',
      paddingHorizontal: 24,
      paddingBottom: 16,
    },
    fundingTitle: {
      fontSize: 22,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 20,
    },
    fundingAmountSection: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 8,
      gap: 6,
      marginBottom: 16,
    },
    fundingAmountLabel: {
      color: theme.primaryLight,
      fontSize: 13,
      fontWeight: 'bold',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    fundingAmountText: {
      color: theme.text,
      fontSize: 52,
      fontWeight: '800',
    },
    fundingEscrowWrapper: {
      marginBottom: 16,
    },
    fundingErrorWrapper: {
      marginBottom: 16,
    },
    fundingSectionLabel: {
      color: theme.textSecondary,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
      marginBottom: 8,
    },
    fundingPaymentSection: {
      marginBottom: 8,
    },
    fundingPaymentCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 14,
      padding: 14,
      gap: 12,
      minHeight: 56,
    },
    fundingPaymentCardIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.surfaceSecondary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fundingPaymentCardText: {
      color: theme.text,
      fontSize: 15,
      fontWeight: '600',
    },
    fundingPaymentCardSub: {
      color: theme.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    fundingChangeLink: {
      color: theme.primary,
      fontSize: 13,
      fontWeight: '700',
    },
    fundingActions: {
      paddingHorizontal: 24,
      paddingTop: 8,
    },
    fundingApplePayButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
      borderRadius: 999,
      marginBottom: 12,
    },
    fundingApplePayButtonText: {
      fontSize: 16,
      fontWeight: '600',
    },
    fundingPrimaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 56,
      borderRadius: 999,
      backgroundColor: theme.primary,
    },
    fundingPrimaryButtonMuted: {
      opacity: 0.6,
    },
    fundingPrimaryButtonText: {
      color: '#052e1b',
      fontSize: 16,
      fontWeight: 'bold',
    },
    fundingSkipLinkText: {
      fontSize: 15,
      color: theme.textDisabled,
      textDecorationLine: 'underline',
    },
    forHonorRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingTop: 4,
    },
    forHonorLabel: {
      fontSize: 13,
      color: theme.textSecondary,
    },
    // Empty state (R5) — shown when a real fetch confirms there are genuinely
    // no open bounties nearby. Never fabricate sample cards to fill this gap.
    emptyState: {
      alignItems: 'center',
      paddingVertical: 32,
      paddingHorizontal: 16,
    },
    emptyStateIcon: {
      width: 72,
      height: 72,
      borderRadius: 36,
      backgroundColor: theme.surface,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 20,
    },
    emptyStateTitle: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    emptyStateBody: {
      fontSize: 14,
      color: theme.textSecondary,
      textAlign: 'center',
      lineHeight: 20,
      marginBottom: 24,
      paddingHorizontal: 16,
    },
    // ZIP entry (inline replacement for the two location/zip CTAs while active)
    zipInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    zipInput: {
      flex: 1,
    },
    zipSearchButton: {
      paddingHorizontal: 24,
      height: 56,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
    },
    zipInlineError: {
      color: theme.error,
      fontSize: 13,
      marginTop: 8,
      paddingHorizontal: 4,
    },
    zipCancelLink: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    zipCancelLinkText: {
      fontSize: 15,
      color: theme.textSecondary,
    },
    // Subtle "enable location later" affordance shown once the hunter is
    // already viewing the online/remote fallback.
    enableLocationLink: {
      alignItems: 'center',
      paddingVertical: 8,
    },
    enableLocationLinkText: {
      fontSize: 13,
      color: theme.primary,
      fontWeight: '600',
    },
    discoveryErrorWrapper: {
      marginBottom: 16,
    },
  });
}

export type OnboardingDetailsStyles = ReturnType<typeof makeOnboardingDetailsStyles>;
