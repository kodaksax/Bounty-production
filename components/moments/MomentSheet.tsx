/**
 * Moments Queue — presentation.
 *
 * Renders whatever MomentsProvider decides is the single, currently-active
 * moment as a bottom sheet. Purely presentational: all decisions about
 * *which* moment and *when* live in lib/moments/engine.ts + the provider —
 * this component just shows content.spec and calls accept()/dismiss().
 *
 * Always closable: the close button, Android back and a backdrop tap all
 * count as "Later" (the moment may return after a week, up to its cap). No
 * one should be stuck on a sheet they don't want to answer.
 */
import { MaterialIcons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { useMoments } from '../../providers/moments-provider';
import { AppModal } from '../ui/app-modal';

export function MomentSheet() {
  const { activeMoment, activeContent, accept, dismiss, decline } = useMoments();
  const { theme } = useAppThemeContext();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const visible = !!activeMoment && !!activeContent;

  // Keep rendering the last moment's content while the sheet plays its close
  // animation — `activeContent` goes null the instant the moment is
  // dismissed/accepted, which would otherwise blank the sheet mid-transition.
  const [displayContent, setDisplayContent] = useState(activeContent);
  useEffect(() => {
    if (activeContent) setDisplayContent(activeContent);
  }, [activeContent]);

  if (!displayContent) return null;
  const content = displayContent;

  return (
    <AppModal
      visible={visible}
      // Back and the backdrop are "Later", same as the close button. A tap
      // in the first moments after it opens is ignored by the provider (a
      // double-tap carried over from something else), never written.
      onRequestClose={dismiss}
      dismissable
      variant="sheet"
    >
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} accessibilityViewIsModal>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={dismiss}
          accessibilityRole="button"
          accessibilityLabel="Close"
          accessibilityHint="Closes this for now. You can do it later."
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID="moment-sheet-close"
        >
          <MaterialIcons name="close" size={24} color={theme.textSecondary} />
        </TouchableOpacity>
        {content.icon && (
          <View style={styles.iconCircle}>
            <MaterialIcons name={content.icon as any} size={32} color={theme.primary} />
          </View>
        )}

        <Text style={styles.title} accessibilityRole="header">
          {content.title}
        </Text>
        <Text style={styles.body}>{content.body}</Text>

        {content.estimatedMinutes ? (
          <View style={styles.metaRow}>
            <MaterialIcons name="schedule" size={14} color={theme.textSecondary} />
            <Text style={styles.metaText}>About {content.estimatedMinutes} min</Text>
          </View>
        ) : null}

        {content.benefits && content.benefits.length > 0 && (
          <View style={styles.benefitsList}>
            {content.benefits.map((b, i) => (
              <View key={i} style={styles.benefitRow}>
                <MaterialIcons name="check" size={16} color={theme.primary} />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.primaryButton}
          onPress={accept}
          accessibilityRole="button"
          accessibilityLabel={content.primaryLabel}
        >
          <Text style={styles.primaryButtonText}>{content.primaryLabel}</Text>
        </TouchableOpacity>

        {content.secondaryLabel && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={dismiss}
            accessibilityRole="button"
            accessibilityLabel={content.secondaryLabel}
          >
            <Text style={styles.secondaryButtonText}>{content.secondaryLabel}</Text>
          </TouchableOpacity>
        )}

        {content.declineLabel && (
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={decline}
            accessibilityRole="button"
            accessibilityLabel={content.declineLabel}
            testID="moment-sheet-decline"
          >
            <Text style={styles.declineButtonText}>{content.declineLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </AppModal>
  );
}

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
    closeButton: {
      position: 'absolute',
      top: 12,
      right: 12,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
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
      // Clear of the close button when there's no icon above the title.
      paddingRight: 40,
    },
    body: {
      fontSize: 14,
      color: theme.textSecondary,
      lineHeight: 20,
      marginBottom: 12,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginBottom: 12,
    },
    metaText: {
      fontSize: 12,
      color: theme.textSecondary,
    },
    benefitsList: {
      marginBottom: 20,
      gap: 8,
    },
    benefitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    benefitText: {
      fontSize: 13,
      color: theme.text,
      flex: 1,
    },
    primaryButton: {
      backgroundColor: theme.primary,
      borderRadius: 999,
      paddingVertical: 16,
      alignItems: 'center',
      marginBottom: 8,
    },
    primaryButtonText: {
      color: theme.onPrimary,
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
    declineButtonText: {
      color: theme.textSecondary,
      fontSize: 13,
      textDecorationLine: 'underline',
    },
  });
}
