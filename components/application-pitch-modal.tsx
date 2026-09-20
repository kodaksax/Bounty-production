import * as React from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { getPitchPrompt, getPitchRequirement, PITCH_REQUIRED_MIN_LENGTH } from '../lib/utils/pitch-requirement';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { AppModal } from './ui/app-modal';
import { Button } from './ui/button';

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
}: ApplicationPitchModalProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);

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

  const title = isForHonor ? 'Apply for this bounty?' : `Apply and earn $${netEarnings.toFixed(2)}?`;
  const description = isForHonor
    ? "The poster gets your application and can accept it. You'll be notified either way — you can withdraw it any time before they accept."
    : `The poster gets your application and can accept it. If they do, $${grossAmount.toFixed(2)} is held in escrow before you start, and $${netEarnings.toFixed(2)} lands in your wallet once they approve your work. You can withdraw the application any time before they accept.`;

  const primaryLabel = isForHonor ? 'Apply' : `Apply — earn $${netEarnings.toFixed(2)}`;

  return (
    <AppModal visible={visible} onRequestClose={onCancel} variant="sheet" dismissable={!isSubmitting}>
      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description}>{description}</Text>

        <View style={styles.pitchSection}>
          <View style={styles.pitchLabelRow}>
            <Text style={styles.pitchLabel}>Why me?</Text>
            {requirement === 'required' && <Text style={styles.requiredTag}>Required</Text>}
            {requirement === 'optional' && <Text style={styles.optionalTag}>Optional</Text>}
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
          {requirement === 'encouraged' && trimmed.length === 0 && (
            <Text style={styles.encouragedHint}>Applications with a pitch get chosen more often.</Text>
          )}
          {requirement === 'required' && (
            <View style={styles.requiredFooter}>
              {showRequiredError && (
                <Text style={styles.errorHint} accessibilityLiveRegion="polite">
                  Write at least {PITCH_REQUIRED_MIN_LENGTH} characters to apply for this bounty.
                </Text>
              )}
              <Text style={[styles.counter, showRequiredError && styles.counterError]}>
                {trimmed.length}/{PITCH_REQUIRED_MIN_LENGTH}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.actions}>
          <Button variant="ghost" onPress={onCancel} disabled={isSubmitting} style={styles.cancelButton}>
            Cancel
          </Button>
          <Button
            variant="default"
            onPress={handleSubmit}
            disabled={isSubmitting}
            style={styles.submitButton}
            accessibilityState={{ disabled: isSubmitting }}
          >
            {isSubmitting ? <ActivityIndicator size="small" color="#fff" /> : primaryLabel}
          </Button>
        </View>
      </View>
    </AppModal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    card: {
      width: '100%',
      backgroundColor: theme.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 28,
    },
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
      fontSize: 11,
      fontWeight: '700',
      color: theme.error,
      textTransform: 'uppercase',
    },
    optionalTag: {
      fontSize: 11,
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
