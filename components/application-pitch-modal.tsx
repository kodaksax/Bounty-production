import * as React from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getPitchPrompt, getPitchRequirement, PITCH_REQUIRED_MIN_LENGTH } from '../lib/utils/pitch-requirement';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { AppModal, useModalContentHeight } from './ui/app-modal';
import { TrustSafetyNotice } from './ui/trust-safety-notice';
import { trustSafetyStrings } from '../lib/strings/trust-safety';
import { detectOffPlatformRisk } from '../lib/utils/off-platform-risk';
import { describeOfferSheet } from '../lib/utils/hunter-stage-copy';
import { ConsequenceList } from './poster/blocks';
import { PosterButton } from './poster/poster-button';

export interface ApplicationPitchModalProps {
  visible: boolean;
  bounty: {
    amount?: number | null;
    is_for_honor?: boolean | null;
    category?: string | null;
  };
  /** Net take-home for a paid bounty; ignored for honor bounties. */
  netEarnings: number;
  /** Gross amount held in escrow for a paid bounty; ignored for honor bounties. */
  grossAmount: number;
  isSubmitting: boolean;
  onCancel: () => void;
  /** Called with the trimmed pitch text (or null if left blank). */
  onSubmit: (pitch: string | null) => void;
  /** Fired once per open, the first time the hunter types into the pitch field. */
  onPitchStarted?: () => void;
  /** Fired when the primary action is pressed with a non-empty pitch. */
  onPitchSubmitted?: (pitch: string) => void;
  /** Fired when the primary action is pressed but the pitch is still too short. */
  onPitchBlocked?: (pitchLength: number) => void;
  /** For "Offer to do …" and "If Jordan chooses you" (Focus-first H.2). */
  jobTitle?: string;
  posterName?: string | null;
}

/**
 * Replaces the old bare Alert.alert confirmation for applying to a bounty.
 * Adds a structured "why me?" pitch field whose prominence scales with the
 * bounty amount (see lib/utils/pitch-requirement.ts) instead of blanket
 * friction on every application — a low-amount bounty behaves exactly like
 * the old one-tap Alert (pitch optional, primary button never blocked).
 */
export function ApplicationPitchModal({
  visible,
  bounty,
  netEarnings,
  grossAmount,
  isSubmitting,
  onCancel,
  onSubmit,
  onPitchStarted,
  onPitchSubmitted,
  onPitchBlocked,
  jobTitle,
  posterName,
}: ApplicationPitchModalProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const modalContentHeight = useModalContentHeight();

  const [pitch, setPitch] = React.useState('');
  // Set the first time a required pitch is submitted too short, so the button
  // reads as blocked-with-a-reason instead of silently disabled.
  const [showError, setShowError] = React.useState(false);
  const startedRef = React.useRef(false);

  React.useEffect(() => {
    if (visible) {
      setPitch('');
      setShowError(false);
      startedRef.current = false;
    }
  }, [visible]);

  const requirement = getPitchRequirement(bounty);
  const prompt = getPitchPrompt(bounty.category);
  const trimmed = pitch.trim();
  const isForHonor = !!bounty.is_for_honor;

  const canSubmit = requirement !== 'required' || trimmed.length >= PITCH_REQUIRED_MIN_LENGTH;
  // A required pitch the hunter already tried to submit too short.
  const showRequiredError = showError && !canSubmit;

  const handleChangeText = (text: string) => {
    setPitch(text);
    if (!startedRef.current && text.length > 0) {
      startedRef.current = true;
      onPitchStarted?.();
    }
  };

  const handleSubmit = () => {
    if (isSubmitting) return;
    // Let the press land even when the pitch is short: show an inline reason
    // and record the blocked tap, instead of a dead disabled button that gives
    // no feedback and no signal.
    if (!canSubmit) {
      setShowError(true);
      onPitchBlocked?.(trimmed.length);
      return;
    }
    if (trimmed.length > 0) {
      onPitchSubmitted?.(trimmed);
    }
    onSubmit(trimmed.length > 0 ? trimmed : null);
  };

  // Focus-first H.2. The amounts are calculateHunterEarnings' (via the
  // caller's grossAmount, and describeOfferSheet for the take-home and fee).
  const sheet = describeOfferSheet({
    title: jobTitle,
    posterName: posterName ?? null,
    amount: isForHonor ? null : grossAmount,
    isForHonor,
  });
  const primaryLabel = sheet.send;

  return (
    <AppModal visible={visible} onRequestClose={onCancel} variant="sheet" dismissable={!isSubmitting}>
      <View style={[styles.card, modalContentHeight != null && { maxHeight: modalContentHeight }]}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.cardContent}
        >
          <Text style={styles.title} accessibilityRole="header">{sheet.title}</Text>
          <ConsequenceList
            label={sheet.label}
            items={sheet.items.map((item) => ({ ...item, icon: item.icon as never }))}
            testID="offer-consequences"
          />
          <TrustSafetyNotice message={trustSafetyStrings.beforeAcceptance} />

          <View style={styles.pitchSection}>
          <View style={styles.pitchLabelRow}>
            <Text style={styles.pitchLabel}>{requirement === 'required' ? 'Why you?' : sheet.field}</Text>
            {requirement === 'required' && <Text style={styles.requiredTag}>Required</Text>}
          </View>
          <Text style={styles.pitchPrompt}>{prompt}</Text>
          <TextInput
            value={pitch}
            onChangeText={handleChangeText}
            placeholder="Share your experience with the poster…"
            placeholderTextColor={theme.textDisabled}
            multiline
            numberOfLines={4}
            style={styles.input}
            editable={!isSubmitting}
            accessibilityLabel="Application pitch"
            accessibilityHint={prompt}
          />
          {detectOffPlatformRisk(pitch) && (
            <TrustSafetyNotice message={trustSafetyStrings.profile} urgent />
          )}
          {requirement === 'encouraged' && trimmed.length === 0 && (
            <Text style={styles.encouragedHint}>Applications with a pitch get chosen more often.</Text>
          )}
          {requirement === 'required' && (
            <View style={styles.requiredFooter}>
              {showRequiredError && (
                <Text style={styles.errorHint} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                  Write at least {PITCH_REQUIRED_MIN_LENGTH} characters to apply for this bounty.
                </Text>
              )}
              <Text style={[styles.counter, showRequiredError && styles.counterError]}>
                {trimmed.length}/{PITCH_REQUIRED_MIN_LENGTH}
              </Text>
            </View>
          )}
          </View>

          <View style={styles.focusActions}>
            <PosterButton
              label={primaryLabel}
              onPress={handleSubmit}
              loading={isSubmitting}
              loadingLabel="Sending your offer"
              testID="offer-send"
            />
            <PosterButton kind="neutral" label={sheet.cancel} onPress={onCancel} disabled={isSubmitting} testID="offer-cancel" />
          </View>
        </ScrollView>
      </View>
    </AppModal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    focusActions: { gap: 10, marginTop: 4 },
    card: {
      width: '100%',
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      ...theme.insetBorder, // pressed-in edge: dark top → light bottom
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 28,
    },
    cardContent: { flexGrow: 1, gap: 12 },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 8,
    },
    description: {
      fontSize: 14,
      lineHeight: 20,
      color: theme.textSecondary,
      marginBottom: 20,
    },
    pitchSection: {
      marginBottom: 20,
    },
    pitchLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 4,
    },
    pitchLabel: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.text,
    },
    requiredTag: {
      fontSize: 12,
      fontWeight: '700',
      color: theme.error,
      textTransform: 'uppercase',
    },
    optionalTag: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
      textTransform: 'uppercase',
    },
    pitchPrompt: {
      fontSize: 13,
      color: theme.textSecondary,
      marginBottom: 8,
    },
    input: {
      minHeight: 88,
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: 12,
      padding: 12,
      fontSize: 14,
      color: theme.text,
      textAlignVertical: 'top',
      backgroundColor: theme.surfaceSecondary,
    },
    encouragedHint: {
      fontSize: 12,
      color: theme.warning,
      marginTop: 6,
    },
    requiredFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      marginTop: 6,
    },
    errorHint: {
      flex: 1,
      fontSize: 12,
      color: theme.error,
    },
    counter: {
      marginLeft: 'auto',
      fontSize: 12,
      color: theme.textSecondary,
    },
    counterError: {
      color: theme.error,
      fontWeight: '600',
    },
    actions: {
      flexDirection: 'row',
      gap: 10,
    },
    cancelButton: {
      flex: 1,
    },
    submitButton: {
      flex: 2,
    },
  });
}
