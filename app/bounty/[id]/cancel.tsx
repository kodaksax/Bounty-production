import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthContext } from 'hooks/use-auth-context';
import { EMAIL_SUBJECTS, SUPPORT_EMAIL, createSupportTel } from 'lib/constants/support';
import { getBottomNavContentGap, getBottomNavOccludedHeight } from 'lib/constants/navigation';
import { bountyService } from 'lib/services/bounty-service';
import type { CancellationReasonCategory } from 'lib/services/cancellation-service';
import { cancellationService } from 'lib/services/cancellation-service';
import type { Bounty } from 'lib/services/database.types';
import { useAppThemeContext } from 'lib/themes/AppThemeContext';
import type { AppTheme } from 'lib/themes/types';
import { AlertCircle, ArrowLeft, HelpCircle, Mail, Phone } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollView } from '../../../components/ui/keyboard-avoiding';

const CANCELLATION_REASON_OPTIONS: { label: string; value: CancellationReasonCategory }[] = [
  { label: 'Changed my mind', value: 'changed_mind' },
  { label: 'Posted by mistake', value: 'posted_by_mistake' },
  { label: 'No longer needed', value: 'no_longer_needed' },
  { label: 'Timeline issue', value: 'timeline_issue' },
  { label: 'Communication issue', value: 'communication_issue' },
  { label: 'Other', value: 'other' },
];

/** Text on the brand-green CTA / on the blue support buttons, in both themes. */
const ON_ACCENT_TEXT = '#ffffff';

export default function CancellationRequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session } = useAuthContext();
  const userId = session?.user?.id;
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const s = useMemo(() => makeStyles(theme), [theme]);

  // The floating BottomNav overlays this route, so the scroll tail has to clear
  // the bar plus the crosshair that overhangs it — derived from the live
  // viewport, same as the wallet/funding screens.
  const bottomClearance =
    getBottomNavOccludedHeight(insets.bottom, windowWidth) + getBottomNavContentGap(windowHeight);

  const [bounty, setBounty] = useState<Bounty | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonCategory, setReasonCategory] = useState<CancellationReasonCategory>('other');

  /**
   * A cancellation request is the HUNTER's exit from work they've taken on and
   * can't finish — it asks the poster (or support) for release, and approving
   * it returns the poster's escrow in full.
   *
   * It is deliberately not available to posters. A poster whose bounty nobody
   * has accepted deletes it outright and is refunded on the spot; once a hunter
   * is on the clock, the poster's route is a dispute, which is the flow that
   * can settle escrow in either direction. Letting a poster file a request
   * here made them both requester and beneficiary of a flow whose whole point
   * is the other party's consent.
   */
  const isAcceptedHunter = !!bounty && !!userId && bounty.accepted_by === userId;

  useEffect(() => {
    loadBounty();
  }, [id]);

  const loadBounty = async () => {
    try {
      setLoading(true);
      const bountyData = await bountyService.getById(id);
      if (bountyData) {
        setBounty(bountyData);
      }
    } catch (error) {
      console.error('Error loading bounty:', error);
      Alert.alert('Error', 'Failed to load bounty details');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitCancellation = async () => {
    if (!reason.trim()) {
      Alert.alert('Error', 'Please provide a reason for cancellation');
      return;
    }

    if (!userId || !bounty) {
      Alert.alert('Error', 'Unable to submit cancellation request');
      return;
    }

    try {
      setSubmitting(true);

      // The server decides the rest: it re-checks that this user really is the
      // accepted hunter, flips the bounty status (which the hunter cannot do
      // through RLS), and files the request at a full refund.
      const result = await cancellationService.createCancellationRequest(
        id,
        userId,
        reason,
        reasonCategory
      );

      if (result) {
        const isForHonorAutoCancel = !!bounty.is_for_honor;
        if (isForHonorAutoCancel) {
          // For honor bounties are auto-removed after cancellation — delete locally/server-side so lists update
          try {
            await bountyService.delete(bounty.id);
          } catch (e) {
            console.error('Error auto-deleting for-honor bounty after cancellation:', e);
          }
        }

        Alert.alert(
          'Success',
          isForHonorAutoCancel
            ? 'For honor bounty cancelled and removed from your postings. No manual dispute review is required.'
            : 'Cancellation request submitted successfully',
          [
            {
              text: 'OK',
              onPress: () => router.back(),
            },
          ]
        );
      } else {
        Alert.alert('Error', 'Failed to submit cancellation request');
      }
    } catch (error) {
      console.error('Error submitting cancellation:', error);
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  };

  const handleContactSupport = () => {
    const subject = bounty ? EMAIL_SUBJECTS.cancellation(bounty.title) : EMAIL_SUBJECTS.general;
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`);
  };

  const handleCallSupport = () => {
    Linking.openURL(createSupportTel());
  };

  if (loading) {
    return (
      <View style={[s.screen, s.centered]}>
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  if (!bounty) {
    return (
      <View style={[s.screen, s.centered, s.centeredPad]}>
        <AlertCircle size={48} color={theme.error} />
        <Text style={s.stateTitle}>Bounty not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={[s.primaryButton, s.stateButton]}>
          <Text style={s.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Edge case: Bounty already completed - cannot cancel
  if (bounty.status === 'completed') {
    return (
      <View style={[s.screen, s.centered, s.centeredPad]}>
        <AlertCircle size={48} color={theme.warning} />
        <Text style={s.stateTitle}>Cannot Cancel</Text>
        <Text style={s.stateBody}>
          This bounty has already been completed. If you have an issue, please contact support for
          dispute resolution.
        </Text>
        <View style={s.stateActions}>
          <TouchableOpacity onPress={handleContactSupport} style={[s.primaryButton, s.rowButton]}>
            <Mail size={18} color={ON_ACCENT_TEXT} />
            <Text style={[s.primaryButtonText, s.rowButtonText]}>Email Support</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleCallSupport} style={[s.primaryButton, s.rowButton]}>
            <Phone size={18} color={ON_ACCENT_TEXT} />
            <Text style={[s.primaryButtonText, s.rowButtonText]}>Call Support</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.linkButton}>
            <Text style={s.linkButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Edge case: Bounty already cancelled
  if (bounty.status === 'cancelled') {
    return (
      <View style={[s.screen, s.centered, s.centeredPad]}>
        <AlertCircle size={48} color={theme.textSecondary} />
        <Text style={s.stateTitle}>Already Cancelled</Text>
        <Text style={s.stateBody}>This bounty has already been cancelled.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[s.primaryButton, s.stateButton]}>
          <Text style={s.primaryButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Edge case: Bounty already has pending cancellation request
  if (bounty.status === 'cancellation_requested') {
    return (
      <View style={[s.screen, s.centered, s.centeredPad]}>
        <AlertCircle size={48} color={theme.warning} />
        <Text style={s.stateTitle}>Cancellation Pending</Text>
        <Text style={s.stateBody}>
          A cancellation request is already pending for this bounty. Please wait for the other party
          to respond.
        </Text>
        <View style={s.stateActions}>
          <TouchableOpacity onPress={handleContactSupport} style={[s.primaryButton, s.rowButton]}>
            <HelpCircle size={18} color={ON_ACCENT_TEXT} />
            <Text style={[s.primaryButtonText, s.rowButtonText]}>Contact Support</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.linkButton}>
            <Text style={s.linkButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Only the hunter working the bounty can ask to cancel it. Posters land here
  // from a stale link or an older build; send them to the flow that actually
  // fits rather than filing a request the settlement path doesn't expect.
  if (!isAcceptedHunter) {
    return (
      <View style={[s.screen, s.centered, s.centeredPad]}>
        <AlertCircle size={48} color={theme.warning} />
        <Text style={s.stateTitle}>Not available here</Text>
        <Text style={s.stateBody}>
          Only the hunter working on a bounty can request its cancellation. If you posted this
          bounty and need to stop it, open a dispute so support can settle the escrow, or delete
          the posting if no hunter has been selected yet.
        </Text>
        <View style={s.stateActions}>
          <TouchableOpacity onPress={handleContactSupport} style={[s.primaryButton, s.rowButton]}>
            <HelpCircle size={18} color={ON_ACCENT_TEXT} />
            <Text style={[s.primaryButtonText, s.rowButtonText]}>Contact Support</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={s.linkButton}>
            <Text style={s.linkButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const submitDisabled = submitting || !reason.trim();

  return (
    <View style={s.screen}>
      <KeyboardAwareScrollView
        style={s.scroll}
        contentContainerStyle={{ paddingBottom: bottomClearance }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[s.header, { paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={() => router.back()} style={s.backButton}>
            <ArrowLeft size={24} color={theme.text} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Request Cancellation</Text>
          <Text style={s.headerSubtitle}>{bounty.title}</Text>
        </View>

        {/* Content */}
        <View style={s.content}>
          {/* Info Box */}
          <View style={[s.calloutBox, s.warningBox]}>
            <AlertCircle size={20} color={theme.warning} />
            <View style={s.calloutBody}>
              <Text style={[s.calloutTitle, s.warningText]}>Cancellation Policy</Text>
              <Text style={[s.calloutText, s.warningText]}>
                {bounty.is_for_honor
                  ? 'For honor bounties are automatically cancelled after submission. We still collect your reason to improve matching and quality metrics.'
                  : `You're asking to step off this bounty. If the poster or support approves, the full $${Number(
                      bounty.amount
                    ).toFixed(2)} returns to their wallet and you won't be paid for it. They can also decline, or raise a dispute.`}
              </Text>
            </View>
          </View>

          {/* Bounty Details */}
          <View style={s.detailsCard}>
            <Text style={s.detailLabel}>Bounty Amount</Text>
            <Text style={s.detailAmount}>${bounty.amount.toFixed(2)}</Text>
            <Text style={s.detailLabel}>Status</Text>
            <Text style={s.detailValue}>{bounty.status.replace('_', ' ')}</Text>
          </View>

          {/* Reason Input */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>Why are you cancelling? *</Text>
            <View style={s.chipRow}>
              {CANCELLATION_REASON_OPTIONS.map(option => {
                const selected = reasonCategory === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setReasonCategory(option.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    style={[s.chip, selected ? s.chipSelected : s.chipUnselected]}
                  >
                    <Text style={[s.chipText, selected ? s.chipTextSelected : s.chipTextUnselected]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={s.helperText}>
              Please explain why you want to cancel this bounty. This will be shared with the other
              party.
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Enter your reason..."
              placeholderTextColor={theme.textDisabled}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              style={s.textInput}
            />
          </View>

          {/* Submit Button */}
          <TouchableOpacity
            onPress={handleSubmitCancellation}
            disabled={submitDisabled}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitDisabled, busy: submitting }}
            style={[s.submitButton, submitDisabled && s.submitButtonDisabled]}
          >
            {submitting ? (
              <ActivityIndicator color={ON_ACCENT_TEXT} />
            ) : (
              <Text style={[s.submitButtonText, submitDisabled && s.submitButtonTextDisabled]}>
                {bounty.is_for_honor ? 'Cancel For Honor Bounty' : 'Submit Cancellation Request'}
              </Text>
            )}
          </TouchableOpacity>

          {/* Support Contact Section */}
          <View style={[s.calloutBox, s.infoBox]}>
            <HelpCircle size={20} color={theme.info} />
            <View style={s.calloutBody}>
              <Text style={[s.calloutTitle, s.infoText]}>Need Help?</Text>
              <Text style={[s.calloutText, s.infoText, s.calloutTextSpaced]}>
                If you have questions about the cancellation process or need assistance with a
                dispute, our support team is here to help.
              </Text>
              <View style={s.supportRow}>
                <TouchableOpacity onPress={handleContactSupport} style={s.supportButton}>
                  <Mail size={14} color={ON_ACCENT_TEXT} />
                  <Text style={s.supportButtonText}>Email</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleCallSupport} style={s.supportButton}>
                  <Phone size={14} color={ON_ACCENT_TEXT} />
                  <Text style={s.supportButtonText}>Call</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          <TouchableOpacity onPress={() => router.back()} disabled={submitting} style={s.linkButton}>
            <Text style={s.linkButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

/**
 * Every color comes from the active AppTheme — the screen was previously
 * hardcoded to the dark palette (#0B0F14 page, white text) with two stray
 * light-mode callouts (amber-50 / blue-50), so it read as a dark screen in
 * light mode and had unreadable amber-900-on-cream / gray-700-on-#1F2937 text
 * in dark mode. Callout tints are the semantic color at low alpha, which works
 * on both a white and a near-black page.
 */
function makeStyles(theme: AppTheme) {
  const warningTint = theme.isDark ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.16)';
  const warningBorder = theme.isDark ? 'rgba(251,191,36,0.34)' : 'rgba(180,83,9,0.28)';
  const infoTint = theme.isDark ? 'rgba(96,165,250,0.14)' : 'rgba(59,130,246,0.10)';
  const infoBorder = theme.isDark ? 'rgba(96,165,250,0.34)' : 'rgba(59,130,246,0.28)';

  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: theme.background,
    },
    scroll: {
      flex: 1,
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    centeredPad: {
      padding: 24,
    },
    stateTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: theme.text,
      marginTop: 16,
      textAlign: 'center',
    },
    stateBody: {
      color: theme.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    stateActions: {
      marginTop: 24,
      width: '100%',
      maxWidth: 320,
      gap: 12,
    },
    stateButton: {
      marginTop: 24,
      paddingHorizontal: 24,
    },
    header: {
      backgroundColor: theme.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
      paddingHorizontal: 16,
      paddingBottom: 24,
    },
    backButton: {
      marginBottom: 16,
      alignSelf: 'flex-start',
      padding: 4,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
    },
    headerSubtitle: {
      color: theme.textSecondary,
      marginTop: 4,
    },
    content: {
      padding: 24,
    },
    calloutBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      borderWidth: 1,
      borderRadius: 8,
      padding: 16,
    },
    warningBox: {
      backgroundColor: warningTint,
      borderColor: warningBorder,
      marginBottom: 24,
    },
    infoBox: {
      backgroundColor: infoTint,
      borderColor: infoBorder,
      marginTop: 24,
    },
    calloutBody: {
      flex: 1,
      marginLeft: 12,
    },
    calloutTitle: {
      fontWeight: '600',
      marginBottom: 4,
    },
    calloutText: {
      fontSize: 13,
      lineHeight: 19,
    },
    calloutTextSpaced: {
      marginBottom: 12,
    },
    // Amber/blue body copy that stays legible on the tint in both themes: the
    // bright semantic color on dark, a deep shade of the same hue on light.
    warningText: {
      color: theme.isDark ? '#FCD34D' : '#92400E',
    },
    infoText: {
      color: theme.isDark ? '#93C5FD' : '#1E3A8A',
    },
    detailsCard: {
      backgroundColor: theme.surface,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 8,
      padding: 16,
      marginBottom: 24,
    },
    detailLabel: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: 4,
    },
    detailAmount: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.text,
      marginBottom: 12,
    },
    detailValue: {
      fontSize: 16,
      fontWeight: '500',
      color: theme.text,
      textTransform: 'capitalize',
    },
    section: {
      marginBottom: 24,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: theme.text,
      marginBottom: 8,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 12,
    },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
    },
    chipSelected: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    chipUnselected: {
      backgroundColor: theme.surfaceSecondary,
      borderColor: theme.border,
    },
    chipText: {
      fontSize: 13,
    },
    chipTextSelected: {
      color: ON_ACCENT_TEXT,
      fontWeight: '600',
    },
    chipTextUnselected: {
      color: theme.text,
    },
    helperText: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: 12,
    },
    textInput: {
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.surfaceSecondary,
      borderRadius: 8,
      padding: 12,
      fontSize: 16,
      color: theme.text,
      minHeight: 120,
    },
    submitButton: {
      backgroundColor: theme.primary,
      borderRadius: 8,
      paddingVertical: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    submitButtonDisabled: {
      backgroundColor: theme.surfaceSecondary,
    },
    submitButtonText: {
      color: ON_ACCENT_TEXT,
      fontSize: 16,
      fontWeight: '600',
      textAlign: 'center',
    },
    submitButtonTextDisabled: {
      color: theme.textDisabled,
    },
    supportRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    supportButton: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: '#1D4ED8',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
    },
    supportButtonText: {
      color: ON_ACCENT_TEXT,
      fontSize: 13,
      fontWeight: '500',
      marginLeft: 4,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonText: {
      color: ON_ACCENT_TEXT,
      fontWeight: '600',
    },
    rowButton: {
      flexDirection: 'row',
    },
    rowButtonText: {
      marginLeft: 8,
    },
    linkButton: {
      marginTop: 16,
      paddingVertical: 16,
      paddingHorizontal: 24,
    },
    linkButtonText: {
      color: theme.textSecondary,
      fontWeight: '500',
      textAlign: 'center',
    },
  });
}
