/**
 * AppModal — single shared presentation + animation system for every
 * dialog/confirmation/bottom-sheet in the app (see
 * docs/MODAL_ANIMATION_STANDARD.md for the full audit and rationale).
 *
 * One Reanimated-driven timeline (UI thread, not JS) coordinates backdrop
 * fade + content fade/scale/slide. Content only mounts once `visible` goes
 * true. The native <Modal> itself is a separate OS window/view controller
 * that stays the top-level touch target for as long as it is presented, no
 * matter what `pointerEvents` its children carry — so it is torn down the
 * instant `visible` goes false, before any fade plays, and the fade-out is
 * finished afterwards by a plain (non-Modal) view that lives in the same
 * native hierarchy as whatever screen is showing behind it. That view is
 * purely decorative — always `pointerEvents="none"` — so a blocked action's
 * very next tap reaches the real screen immediately instead of landing on a
 * closing modal that can't yet let it through.
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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Pressable, StyleSheet, useWindowDimensions, View, type ViewStyle } from 'react-native';
import { useKeyboardInset } from './keyboard-avoiding';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { duration, easeIn, easeOut } from '../../lib/motion';

// From the app-wide motion tokens (lib/motion.ts): opens decelerate in,
// closes accelerate out and finish sooner than they arrived.
export const MODAL_OPEN_DURATION = duration.base;
export const MODAL_CLOSE_DURATION = duration.exit;
export const MODAL_EASE_OUT = easeOut;
export const MODAL_EASE_IN = easeIn;

export type AppModalVariant = 'dialog' | 'sheet';

/** A window-coordinate rect, as returned by `measureInWindow`. */
export type ModalOrigin = { x: number; y: number; width: number; height: number };

type Measurable = {
  measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

/**
 * Captures the `origin` for an AppModal opened from a tappable element.
 * Attach `originRef` to the element and open through `openFrom(() => show())`:
 * it measures the element first and opens in the same callback, so the
 * dialog's first frame already knows where to grow from. Opens plainly when
 * the element can't be measured.
 */
export function useModalOrigin<T = unknown>() {
  const originRef = useRef<T | null>(null);
  const [origin, setOrigin] = useState<ModalOrigin | null>(null);

  const openFrom = useCallback((open: () => void) => {
    const node = originRef.current as Measurable | null;
    let opened = false;
    const openOnce = () => {
      if (opened) return;
      opened = true;
      open();
    };
    if (!node?.measureInWindow) {
      setOrigin(null);
      openOnce();
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      setOrigin(width > 0 && height > 0 ? { x, y, width, height } : null);
      openOnce();
    });
    // measureInWindow answers within the frame; never let a dropped callback
    // swallow the tap.
    setTimeout(openOnce, 50);
  }, []);

  return { originRef, origin, openFrom };
}

/** Dialog scale at the start of a plain open, and when growing out of an origin. */
const DIALOG_FROM_SCALE = 0.96;
const ORIGIN_FROM_SCALE = 0.86;

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
  /**
   * Window rect of whatever opened this dialog (the tapped card). The dialog
   * then grows out of that spot and shrinks back into it on close, so it
   * reads as the card opening rather than a page appearing from nowhere.
   * Dialog variant only; ignored for sheets.
   */
  origin?: ModalOrigin | null;
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
  origin = null,
}: AppModalProps) {
  // 'open': native <Modal> is presented (also covers the opening animation).
  // 'closing': native <Modal> is already gone; a plain, always-inert view is
  // finishing the fade-out in its place. 'closed': nothing rendered.
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(visible ? 'open' : 'closed');
  // Always starts closed, even when mounted already visible (the usual
  // `{show && <Modal visible />}` pattern). Starting at 1 there skipped the
  // opening animation entirely — the bounty detail popped in with no motion.
  const progress = useSharedValue(0);
  // Where the dialog grows from, as an offset from the window centre, and the
  // scale it starts at. Fixed at open, so the close returns to the same spot.
  const fromX = useSharedValue(0);
  const fromY = useSharedValue(0);
  const fromScale = useSharedValue(DIALOG_FROM_SCALE);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const originRef = useRef(origin);
  originRef.current = origin;
  // Whether there is an open (or opening) modal to close. Without it, a modal
  // mounted hidden ran the whole close sequence on mount — fade, fallback
  // timer and an onClosed for a modal the user never saw.
  const hasOpenedRef = useRef(false);
  const windowRef = useRef({ width: windowWidth, height: windowHeight });
  windowRef.current = { width: windowWidth, height: windowHeight };
  // Only listen while actually mounted — an unmounted modal shifting for a
  // keyboard belonging to the screen behind it would be a no-op at best.
  const { inset: keyboardInset, height: keyboardHeight } = useKeyboardInset({
    enabled: avoidKeyboard && phase !== 'closed',
  });

  const contentHeight = useMemo(() => {
    const chrome = variant === 'dialog' ? DIALOG_ROOT_PADDING * 2 : 0;
    return Math.max(0, windowHeight - keyboardHeight - chrome);
  }, [windowHeight, keyboardHeight, variant]);

  useEffect(() => {
    if (visible) {
      hasOpenedRef.current = true;
      setPhase('open');
      const from = variant === 'dialog' ? originRef.current : null;
      if (from) {
        const win = windowRef.current;
        fromX.value = from.x + from.width / 2 - win.width / 2;
        fromY.value = from.y + from.height / 2 - win.height / 2;
        fromScale.value = ORIGIN_FROM_SCALE;
      } else {
        fromX.value = 0;
        fromY.value = 0;
        fromScale.value = DIALOG_FROM_SCALE;
      }
      progress.value = withTiming(1, {
        // Growing out of a card travels further than a plain fade-up.
        duration: from ? duration.screen : MODAL_OPEN_DURATION,
        easing: MODAL_EASE_OUT,
      });
      return;
    }

    // Only a true open -> closed transition closes. The flag clears when the
    // close settles rather than here, so a re-run of this effect that cancels
    // an in-flight close (StrictMode's double invoke) still finishes it.
    if (!hasOpenedRef.current) return;

    // Drop the native <Modal> immediately — see the header comment for why
    // this can't wait for the fade. The plain view left behind finishes the
    // animation but can never block a touch.
    setPhase((current) => (current === 'closed' ? current : 'closing'));

    // Settle at most once per close attempt, whether the animation reports
    // completion or the fallback below fires first.
    let settled = false;
    let fallback: ReturnType<typeof setTimeout>;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      hasOpenedRef.current = false;
      setPhase('closed');
      onClosed?.();
    };

    progress.value = withTiming(0, { duration: MODAL_CLOSE_DURATION, easing: MODAL_EASE_IN }, (finished) => {
      if (finished) runOnJS(settle)();
    });

    // Safety net for an interrupted close. `finished` is false when a rapid
    // reopen restarts the animation on the shared value, but the completion
    // report can also just be dropped on the UI thread — which used to leave
    // the Modal mounted at zero opacity, swallowing every touch behind it.
    // Force the settle once the close window has passed so a stuck callback
    // can never strand it.
    fallback = setTimeout(settle, MODAL_CLOSE_DURATION + 80);
    return () => {
      clearTimeout(fallback);
      // A reopen (or unmount) cancels this close attempt outright. The
      // runOnJS(settle) queued above can't itself be cancelled, so force
      // `settled` here too — otherwise that stale callback can still land
      // after the reopen, flipping phase back to 'closed' and firing
      // `onClosed` on a modal the caller thinks is still open.
      settled = true;
    };
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
    const p = progress.value;
    const rest = 1 - p;
    return {
      // From an origin the dialog is fully opaque well before it lands, so
      // it reads as moving rather than fading in on the spot.
      opacity: fromScale.value === ORIGIN_FROM_SCALE ? Math.min(1, p * 1.8) : p,
      transform: [
        { translateX: fromX.value * rest },
        { translateY: fromY.value * rest },
        { scale: fromScale.value + (1 - fromScale.value) * p },
      ],
    };
  });

  if (phase === 'closed') return null;

  // While open, this is gated 'auto' so the backdrop/content can take
  // touches; while closing it is always 'none'. That's now safe to rely on:
  // this view only ever renders inside the real <Modal> during 'open', and
  // as the plain, non-Modal ghost during 'closing' — never both — so 'none'
  // here genuinely lets a tap fall through to whatever's behind it.
  const overlay = (
    <View style={StyleSheet.absoluteFill} pointerEvents={phase === 'open' ? 'auto' : 'none'}>
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
  );

  if (phase === 'closing') {
    // No native <Modal> here on purpose: it would still be the top-level
    // touch target for as long as it's presented, fade or no fade. This is
    // an ordinary view in the same native hierarchy as the screen behind it,
    // so its `pointerEvents="none"` above genuinely releases touches now
    // instead of only once this finishes and unmounts.
    return overlay;
  }

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onRequestClose}
      statusBarTranslucent={statusBarTranslucent}
    >
      {overlay}
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
