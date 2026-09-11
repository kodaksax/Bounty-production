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
 *
 * Keyboard avoidance is built in (see `components/ui/keyboard-avoiding`).
 * RN's own `KeyboardAvoidingView` measures against the window and so does
 * nothing useful inside a `<Modal>`, which is why every dialog with a text
 * field used to let the keyboard cover its input. Here the backdrop area
 * shrinks by the keyboard's actual overlap, so a centered card re-centers in
 * the space that is left and a sheet rides up with the keyboard. Cards that
 * are taller than that remaining space must also cap their own height —
 * read it from `useModalContentHeight()` rather than from `Dimensions`.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useKeyboardInset } from './keyboard-avoiding';
import Reanimated, {
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

/**
 * Height actually available to modal content right now: the window minus the
 * keyboard overlap and the root's own padding. Cards sized off `Dimensions`
 * keep their full height when the keyboard opens and push their own footer
 * (and any input in it) off-screen — cap against this instead.
 */
const ModalContentHeightContext = createContext<number | null>(null);

/** Available content height inside the nearest `AppModal`. */
export function useModalContentHeight(): number | null {
  return useContext(ModalContentHeightContext);
}

/** Vertical padding `dialogRoot` reserves above and below the card. */
const DIALOG_ROOT_PADDING = 16;

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
  /**
   * Shrink the modal area by the keyboard overlap so content with a text
   * field stays visible. On by default; turn it off only for a modal that
   * manages the keyboard itself.
   */
  avoidKeyboard?: boolean;
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
  avoidKeyboard = true,
}: AppModalProps) {
  const [mounted, setMounted] = useState(visible);
  const progress = useSharedValue(visible ? 1 : 0);
  const { height: windowHeight } = useWindowDimensions();
  // Only listen while actually mounted — an unmounted modal shifting for a
  // keyboard belonging to the screen behind it would be a no-op at best.
  const { inset: keyboardInset, height: keyboardHeight } = useKeyboardInset({
    enabled: avoidKeyboard && mounted,
  });

  const contentHeight = useMemo(() => {
    const chrome = variant === 'dialog' ? DIALOG_ROOT_PADDING * 2 : 0;
    return Math.max(0, windowHeight - keyboardHeight - chrome);
  }, [windowHeight, keyboardHeight, variant]);

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
      <View style={StyleSheet.absoluteFill}>
        {/* Backdrop covers the keyboard too, so a tap anywhere still dismisses. */}
        <Reanimated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => dismissable && onRequestClose()}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
          />
        </Reanimated.View>
        {/* `paddingBottom` is the keyboard overlap: a centered dialog
            re-centers in what is left, a sheet is pushed up by exactly the
            keyboard's height. Driven by the keyboard's own curve. */}
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            variant === 'sheet' ? styles.sheetRoot : styles.dialogRoot,
            { marginBottom: keyboardInset },
            containerStyle,
          ]}
          pointerEvents="box-none"
        >
          <Reanimated.View
            style={[variant === 'dialog' ? styles.dialogContent : null, contentAnimStyle, contentStyle]}
            pointerEvents="box-none"
            accessibilityViewIsModal={accessibilityViewIsModal}
          >
            <ModalContentHeightContext.Provider value={contentHeight}>
              {children}
            </ModalContentHeightContext.Provider>
          </Reanimated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  dialogRoot: { justifyContent: 'center', alignItems: 'center', padding: DIALOG_ROOT_PADDING },
  // Gives dialog content a real width to resolve percentage-based card
  // widths against, since `alignItems: 'center'` on dialogRoot otherwise
  // shrinks children to their own content size instead of stretching them.
  dialogContent: { width: '100%' },
  sheetRoot: { justifyContent: 'flex-end' },
});
