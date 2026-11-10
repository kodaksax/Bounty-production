/**
 * Draws the toasts raised through lib/toast.ts. Mounted once at the root, so a
 * toast survives the navigation that often follows it (save, then go back).
 */
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAccessibleAnimation } from '../../hooks/use-accessible-animation';
import { hapticFeedback } from '../../lib/haptic-feedback';
import { duration, easeOut } from '../../lib/motion';
import { useAppThemeContext } from '../../lib/themes/AppThemeContext';
import type { AppTheme } from '../../lib/themes/types';
import { subscribeToToasts, type ToastOptions, type ToastTone } from '../../lib/toast';

function readingTime(message: string) {
  return Math.min(6000, Math.max(2500, 1500 + message.length * 45));
}

const ICONS: Record<ToastTone, keyof typeof MaterialIcons.glyphMap> = {
  success: 'check-circle',
  error: 'error-outline',
  info: 'info-outline',
};

export function AppToastHost() {
  const { theme } = useAppThemeContext();
  const styles = useMemo(() => makeStyles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const { prefersReducedMotion } = useAccessibleAnimation();
  const [toast, setToast] = useState<ToastOptions | null>(null);
  const progress = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const dismiss = useCallback(() => {
    clearTimer();
    Animated.timing(progress, {
      toValue: 0,
      duration: duration.exit,
      easing: easeOut,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [progress]);

  const present = useCallback(
    (next: ToastOptions) => {
      clearTimer();
      setToast(next);
      if (next.tone === 'error') hapticFeedback.error();
      else hapticFeedback.success();
      AccessibilityInfo.announceForAccessibility?.(next.message);
      Animated.timing(progress, {
        toValue: 1,
        duration: duration.base,
        easing: easeOut,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
      hideTimer.current = setTimeout(dismiss, next.duration ?? readingTime(next.message));
    },
    [dismiss, progress]
  );

  useEffect(() => {
    const unsubscribe = subscribeToToasts(present);
    return () => {
      unsubscribe();
      clearTimer();
    };
  }, [present]);

  if (!toast) return null;

  const tone = toast.tone ?? 'success';
  const iconColor = tone === 'success' ? theme.successText : tone === 'error' ? theme.errorText : theme.infoText;
  const translateY = prefersReducedMotion
    ? 0
    : progress.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View style={[styles.toast, { opacity: progress, transform: [{ translateY }] }]}>
        <Pressable
          onPress={dismiss}
          style={styles.row}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          accessibilityHint="Double tap to dismiss"
        >
          <MaterialIcons name={ICONS[tone]} size={20} color={iconColor} />
          <Text style={styles.message}>{toast.message}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function makeStyles(theme: AppTheme) {
  return StyleSheet.create({
    host: {
      position: 'absolute',
      left: 16,
      right: 16,
      alignItems: 'center',
      zIndex: 1000,
      elevation: 1000,
    },
    toast: {
      maxWidth: 520,
      alignSelf: 'stretch',
      backgroundColor: theme.surface,
      borderRadius: theme.radius.xl,
      borderWidth: 1,
      borderColor: theme.borderSubtle,
      ...theme.shadows.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    message: {
      ...theme.textStyles.label,
      fontWeight: '500',
      color: theme.text,
      flex: 1,
    },
  });
}
