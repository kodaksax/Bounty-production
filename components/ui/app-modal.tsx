/**
 * AppModal — single shared presentation + animation system for every
 * dialog/confirmation/bottom-sheet in the app (see
 * docs/MODAL_ANIMATION_STANDARD.md for the full audit and rationale).
 *
 * One Reanimated-driven timeline (UI thread, not JS) coordinates backdrop
 * fade + content fade/scale/slide. Content only mounts once `visible` goes
 * true, and the underlying native <Modal> only unmounts after the close
 * animation has actually finished — so a modal never blinks in before its
 * data is ready and never vanishes mid-transition.
 *
 * Full-screen workflow sheets (dispute forms, review flows, attachment
 * viewer) intentionally keep RN's native `presentationStyle="pageSheet"` /
 * `"fullScreen"` + `animationType="slide"` instead of this component — that
 * IS the native OS sheet transition the task asks us to match, and layering
 * a second animation system on top of it would reintroduce the exact
 * "multiple animations fighting" bug this component exists to remove.
 */
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const MODAL_OPEN_DURATION = 220;
export const MODAL_CLOSE_DURATION = 180;
export const MODAL_EASE_OUT = Easing.out(Easing.cubic);

export type AppModalVariant = 'dialog' | 'sheet';

export interface AppModalProps {
  visible: boolean;
  /** Called after the user asks to dismiss (backdrop tap / back button). Also used as the close trigger for imperative callers. */
  onRequestClose: () => void;
  /**
   * Fires once the close animation has actually finished (backdrop + content
   * fully faded out). Use this — not `onRequestClose` — as the signal to
   * unmount/remove this component from its parent, so callers whose parent
   * conditionally renders them (`{show && <Modal .../>}`) don't rip the
   * modal out mid-transition.
   */
  onClosed?: () => void;
  children: React.ReactNode;
  /** 'dialog' = centered card (fade + scale 0.96→1.0). 'sheet' = bottom sheet (fade + slide up). */
  variant?: AppModalVariant;
  /** Tapping the backdrop dismisses. Set false for blocking confirmations (matches previous Alert.alert-style behavior). */
  dismissable?: boolean;
  containerStyle?: ViewStyle;
  contentStyle?: ViewStyle;
  statusBarTranslucent?: boolean;
  accessibilityViewIsModal?: boolean;
}

export function AppModal({
  visible,
  onRequestClose,
  onClosed,
  children,
  variant = 'dialog',
  dismissable = true,
  containerStyle,
  contentStyle,
  statusBarTranslucent = true,
  accessibilityViewIsModal = true,
}: AppModalProps) {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      progress.value = withTiming(1, { duration: MODAL_OPEN_DURATION, easing: MODAL_EASE_OUT });
    } else {
      progress.value = withTiming(0, { duration: MODAL_CLOSE_DURATION, easing: MODAL_EASE_OUT }, (finished) => {
        if (finished) {
          runOnJS(setMounted)(false);
          if (onClosed) runOnJS(onClosed)();
        }
      });
    }
    // onClosed is intentionally excluded: it's a completion callback, not a
    // dependency the animation should restart for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const contentAnimStyle = useAnimatedStyle(() => {
    if (variant === 'sheet') {
      return {
        opacity: progress.value,
        transform: [{ translateY: (1 - progress.value) * 32 }],
      };
    }
    return {
      opacity: progress.value,
      transform: [{ scale: 0.96 + progress.value * 0.04 }],
    };
  });

  if (!mounted) return null;

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
      statusBarTranslucent={statusBarTranslucent}
    >
      <View
        style={[StyleSheet.absoluteFill, variant === 'sheet' ? styles.sheetRoot : styles.dialogRoot, containerStyle]}
      >
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => dismissable && onRequestClose()}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Animated.View>
        <Animated.View
          style={[variant === 'dialog' ? styles.dialogContent : null, contentAnimStyle, contentStyle]}
          pointerEvents="box-none"
          accessibilityViewIsModal={accessibilityViewIsModal}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  dialogRoot: { justifyContent: 'center', alignItems: 'center', padding: 16 },
  // Gives dialog content a real width to resolve percentage-based card
  // widths against, since `alignItems: 'center'` on dialogRoot otherwise
  // shrinks children to their own content size instead of stretching them.
  dialogContent: { width: '100%' },
  sheetRoot: { justifyContent: 'flex-end' },
});
