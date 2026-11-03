/**
 * The app-open resume prompt. Purely presentational —
 * app/hooks/useResumeComposerPrompt.ts decides
 * whether it shows. Drawn like MomentSheet so the app has one prompt style.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../lib/themes/AppThemeContext';
import type { AppTheme } from '../lib/themes/types';
import { AppModal } from './ui/app-modal';

interface ResumeComposerSheetProps {
  /** The waiting draft's title while the sheet is up, else null. */
  draftTitle: string | null;
  onContinue: () => void;
  onDismiss: () => void;
}

export function ResumeComposerSheet({ draftTitle, onContinue, onDismiss }: ResumeComposerSheetProps) {
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const visible = draftTitle !== null;

  // Keep the last title on screen while the sheet plays its close animation.
  const [displayTitle, setDisplayTitle] = useState(draftTitle);
  useEffect(() => {
    if (draftTitle !== null) setDisplayTitle(draftTitle);
  }, [draftTitle]);

  if (displayTitle === null) return null;

  return (
    <AppModal
      visible={visible}
      // Android back is an explicit "not now"; the backdrop is not.
      onRequestClose={onDismiss}
      dismissable={false}
      variant="sheet"
    >
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}
        accessibilityViewIsModal
        testID="resume-composer-sheet"
      >
        <View style={styles.iconCircle}>
          <MaterialIcons name="edit-note" size={32} color={theme.primary} />
        </View>

        <Text style={styles.title} accessibilityRole="header">
          Your bounty draft is waiting
        </Text>
        <Text style={styles.body}>Pick up where you left off.</Text>
        {displayTitle ? (
          <Text style={styles.draftTitle} numberOfLines={2}>
            {`“${displayTitle}”`}
          </Text>
        ) : null}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={onContinue}
          accessibilityRole="button"
          accessibilityLabel="Continue your post"
          testID="resume-composer-continue"
        >
          <Text style={styles.primaryButtonText}>Continue your post</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          accessibilityHint="Your draft is kept."
          testID="resume-composer-dismiss"
        >
          <Text style={styles.secondaryButtonText}>Not now</Text>
        </TouchableOpacity>
      </View>
    </AppModal>
  );
}

export default ResumeComposerSheet;

// Same measurements as components/moments/MomentSheet.tsx.
function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    sheet: {
      backgroundColor: theme.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: 24,
      paddingTop: 24,
      borderWidth: 1,
      borderColor: theme.border,
      borderBottomWidth: 0,
    },
    iconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: theme.background,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 16,
      borderWidth: 1,
      borderColor: theme.border,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      marginBottom: 8,
    },
    body: {
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 20,
      marginBottom: 12,
    },
    draftTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: theme.text,
      lineHeight: 21,
      marginBottom: 20,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderBottomWidth: 4,
      borderBottomColor: theme.primaryShade,
      borderRadius: 999,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 8,
    },
    primaryButtonText: {
      color: '#052e1b',
      fontSize: 16,
      fontWeight: '700',
    },
    secondaryButton: {
      alignItems: 'center',
      paddingVertical: 12,
    },
    secondaryButtonText: {
      color: theme.textSecondary,
      fontSize: 14,
      fontWeight: '500',
    },
  });
}
