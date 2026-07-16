import { MaterialIcons } from '@expo/vector-icons';
import * as React from 'react';
import { Animated, Modal, StyleSheet, Text, View } from 'react-native';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { Button } from './button';

export type FeedbackVariant = 'success' | 'error' | 'warning' | 'info';

export interface FeedbackModalProps {
  visible: boolean;
  variant: FeedbackVariant;
  title: string;
  message: string;
  /** Label for the primary (only) action. Defaults to "OK". */
  actionLabel?: string;
  /** Called when the user acknowledges the modal. */
  onDismiss: () => void;
}

const VARIANT_ICON: Record<FeedbackVariant, keyof typeof MaterialIcons.glyphMap> = {
  success: 'check-circle',
  error: 'error-outline',
  warning: 'warning-amber',
  info: 'info-outline',
};

function variantColor(theme: AppTheme, variant: FeedbackVariant): string {
  switch (variant) {
    case 'success':
      return theme.success;
    case 'error':
      return theme.error;
    case 'warning':
      return theme.warning;
    case 'info':
      return theme.info;
  }
}

function variantHaptic(variant: FeedbackVariant) {
  switch (variant) {
    case 'success':
      return hapticFeedback.success;
    case 'error':
      return hapticFeedback.error;
    case 'warning':
      return hapticFeedback.warning;
    case 'info':
      return hapticFeedback.light;
  }
}

/**
 * Themed, reusable replacement for `Alert.alert()` success/error/warning/info
 * confirmations. Blocks like a native alert (no backdrop-dismiss) so callers
 * that gate navigation on acknowledgment (e.g. "OK" after a deposit) keep the
 * exact same behavior, just styled to match the rest of the app.
 */
export function FeedbackModal({ visible, variant, title, message, actionLabel = 'OK', onDismiss }: FeedbackModalProps) {
  const { theme } = useAppThemeContext();
  const styles = React.useMemo(() => makeStyles(theme), [theme]);
  const color = variantColor(theme, variant);
  const scaleAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!visible) {
      scaleAnim.setValue(0);
      return;
    }
    variantHaptic(variant)();
    Animated.spring(scaleAnim, { toValue: 1, tension: 50, friction: 7, useNativeDriver: true }).start();
    // Re-trigger only when a fresh modal is shown, not on every theme/variant re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onDismiss}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <View
          style={styles.card}
          accessible
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Animated.View style={[styles.iconCircle, { borderColor: color, transform: [{ scale: scaleAnim }] }]}>
            <MaterialIcons name={VARIANT_ICON[variant]} size={40} color={color} />
          </Animated.View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <Button
            variant={variant === 'error' ? 'destructive' : 'default'}
            onPress={onDismiss}
            accessibilityLabel={actionLabel}
            style={styles.actionButton}
          >
            {actionLabel}
          </Button>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      justifyContent: 'center',
      alignItems: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 400,
      backgroundColor: theme.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: theme.border,
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 20,
      alignItems: 'center',
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: theme.isDark ? 0.5 : 0.15,
      shadowRadius: 24,
      elevation: 12,
    },
    iconCircle: {
      width: 72,
      height: 72,
      borderRadius: 36,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 16,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: theme.text,
      textAlign: 'center',
      marginBottom: 8,
    },
    message: {
      fontSize: 15,
      lineHeight: 22,
      color: theme.textSecondary,
      textAlign: 'center',
      marginBottom: 24,
    },
    actionButton: {
      width: '100%',
    },
  });
}
