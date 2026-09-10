/**
 * keyboard-avoiding — the app's single keyboard-avoidance system.
 *
 * Problem this exists to solve: React Native's built-in `KeyboardAvoidingView`
 * measures its own frame against the *window*, so it silently does nothing
 * inside a centered `<Modal>` card, mis-measures whenever a bottom bar or
 * safe-area inset sits underneath it, and animates on its own schedule rather
 * than the keyboard's. The result is the reported bug: the composer in the
 * bounty detail modal slides under the iOS keyboard and the user cannot see
 * what they are typing.
 *
 * The fix is to read the keyboard's *actual* frame from the OS event and drive
 * layout with the keyboard's own duration and easing curve, so an input rides
 * up locked to the keyboard the way iMessage and Instagram DMs do:
 *
 *   - `useKeyboardInset()`      the raw primitive: how many points of this
 *                              screen the keyboard currently covers.
 *   - `<KeyboardStickyView>`    a bottom-docked bar (chat composer, action
 *                              row) that rides the keyboard. Native-driven.
 *   - `<KeyboardAvoidingScreen>` drop-in replacement for RN's
 *                              `KeyboardAvoidingView` on form screens.
 *   - `<KeyboardAwareScrollView>` a ScrollView that keeps the focused input
 *                              above the keyboard and pads its own content.
 *
 * Overlap, not keyboard height. We derive the covered height from
 * `screenY` (`windowHeight - endCoordinates.screenY`) rather than trusting
 * `endCoordinates.height`. That is what keeps floating/split iPad keyboards,
 * hardware keyboards showing only the shortcut bar, and the keyboard's own
 * dismissal gesture from over-shifting the layout.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  type EasingFunction,
  type KeyboardEvent,
  type ScrollViewProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

/**
 * Fallback timing for events that carry no duration — Android's `did*` events
 * never do. Close to the real iOS keyboard curve.
 */
const FALLBACK_DURATION = 250;

/**
 * iOS reports the keyboard's animation curve as a UIViewAnimationCurve; the
 * keyboard uses the private `keyboardEasing` curve (7), which is closest to
 * `Easing.out(Easing.poly(4))`. Matching it is what makes the input look
 * *attached* to the keyboard instead of chasing it.
 */
function keyboardEasing(curve?: string): EasingFunction {
  if (curve === 'linear') return Easing.linear;
  if (curve === 'easeIn') return Easing.in(Easing.ease);
  if (curve === 'easeOut') return Easing.out(Easing.ease);
  return Easing.out(Easing.poly(4));
}

/**
 * How much of the window the keyboard's end frame covers.
 *
 * Derived from `screenY`, not `height`: a floating or split iPad keyboard,
 * and a hardware keyboard showing only the shortcut bar, both report a tall
 * frame that sits partly (or entirely) off-screen, and shifting by that full
 * height would push the layout far past the keyboard.
 */
function coveredHeight(event: KeyboardEvent): number {
  const end = event.endCoordinates;
  if (!end) return 0;
  const windowHeight = Dimensions.get('window').height;
  return Math.max(0, windowHeight - (end.screenY ?? windowHeight));
}

export interface KeyboardInsetOptions {
  /**
   * Points of the keyboard overlap this surface does *not* need to clear —
   * typically a safe-area inset or a floating bottom bar that the keyboard
   * already covers. Subtracted from the overlap, clamped at 0.
   */
  offset?: number;
  /** Set false to freeze the inset at 0 (e.g. a screen that is not focused). */
  enabled?: boolean;
}

export interface KeyboardInset {
  /**
   * Animated overlap in points, for *layout* props (paddingBottom, height,
   * bottom, marginBottom). JS-driven — layout props cannot be native-driven.
   */
  inset: Animated.Value;
  /**
   * Animated `-overlap`, for `transform: [{ translateY }]`. Native-driven, so
   * a docked bar tracks the keyboard on the UI thread without JS jank.
   */
  translateY: Animated.Value;
  /**
   * The overlap as a plain number, for layout that has to be *computed*
   * rather than animated (capping a modal card's height, say). It updates on
   * `keyboardWillChangeFrame`, i.e. as the animation starts rather than after
   * it lands.
   */
  height: number;
  /** Whether the keyboard currently covers any part of this surface. */
  isVisible: boolean;
}

/**
 * How many points of the screen the keyboard covers right now, as animated
 * values plus a plain number. The building block for everything below; use it
 * directly when a surface needs custom keyboard-driven layout.
 */
export function useKeyboardInset({ offset = 0, enabled = true }: KeyboardInsetOptions = {}): KeyboardInset {
  const inset = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const [height, setHeight] = useState(0);

  // Read through a ref so changing `offset` never re-subscribes the listeners
  // (which would drop the keyboard event mid-animation).
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  useEffect(() => {
    // Android's window is `adjustResize` (Expo's default
    // `softwareKeyboardLayoutMode: 'resize'`), so the OS already shrinks the
    // app window by the keyboard and the layout reflows on its own — shifting
    // again here would double-count and launch content off the top. Avoidance
    // is an iOS concern, which is why the chat composer has always been
    // configured `Platform.select({ ios: 'padding', android: undefined })`.
    if (!enabled || Platform.OS !== 'ios') {
      inset.setValue(0);
      translateY.setValue(0);
      setHeight(0);
      return;
    }

    const animateTo = (next: number, duration: number, curve?: string) => {
      setHeight(next);
      const easing = keyboardEasing(curve);
      Animated.parallel([
        Animated.timing(inset, {
          toValue: next,
          duration,
          easing,
          useNativeDriver: false,
        }),
        Animated.timing(translateY, {
          toValue: -next,
          duration,
          easing,
          useNativeDriver: true,
        }),
      ]).start();
    };

    const onShow = (event: KeyboardEvent) => {
      animateTo(
        Math.max(0, coveredHeight(event) - offsetRef.current),
        event.duration || FALLBACK_DURATION,
        event.easing
      );
    };

    const onHide = (event: KeyboardEvent) => {
      animateTo(0, event?.duration || FALLBACK_DURATION, event?.easing);
    };

    // `will*` fires *before* the keyboard moves and carries the real duration
    // and curve, which is what buys us the in-sync ride rather than a chase.
    const subscriptions = [
      Keyboard.addListener('keyboardWillChangeFrame', onShow),
      Keyboard.addListener('keyboardWillHide', onHide),
    ];

    return () => subscriptions.forEach(s => s.remove());
  }, [enabled, inset, translateY]);

  return { inset, translateY, height, isVisible: height > 0 };
}

export interface KeyboardStickyViewProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Points of overlap this bar already clears (safe area, bottom nav). */
  offset?: number;
  enabled?: boolean;
}

/**
 * A bottom-docked bar that rides the keyboard — chat composers, modal action
 * rows, sticky CTAs. Uses a native-driven transform, so the bar stays welded
 * to the top of the keyboard through the whole animation.
 *
 * The bar keeps its place in normal layout, so whatever scrolls above it does
 * not need to know the keyboard exists; pair with `KeyboardAwareScrollView`
 * when the content behind must also stay reachable.
 */
export function KeyboardStickyView({ children, style, offset = 0, enabled = true }: KeyboardStickyViewProps) {
  const { translateY } = useKeyboardInset({ offset, enabled });
  return <Animated.View style={[style, { transform: [{ translateY }] }]}>{children}</Animated.View>;
}

export interface KeyboardAvoidingScreenProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /**
   * Points of keyboard overlap this container already clears. 0 for a
   * full-bleed container that reaches the screen's bottom edge; pass
   * `insets.bottom` when the container is already inset by the safe area,
   * otherwise the safe area gets counted twice and a gap opens under the
   * input.
   */
  offset?: number;
  /**
   * `padding` shrinks the container from the bottom (right for a `flex: 1`
   * screen whose content should compress). `position` shifts the whole
   * container up (right for a centered card that should stay intact).
   */
  behavior?: 'padding' | 'position';
  enabled?: boolean;
}

/**
 * Drop-in replacement for RN's `KeyboardAvoidingView` that works in the two
 * places the built-in one does not: inside a `<Modal>`, and under a floating
 * bottom bar. Same `flex: 1` usage — wrap the screen body with it.
 */
export function KeyboardAvoidingScreen({
  children,
  style,
  offset = 0,
  behavior = 'padding',
  enabled = true,
}: KeyboardAvoidingScreenProps) {
  const { inset, translateY } = useKeyboardInset({ offset, enabled });

  if (behavior === 'position') {
    return <Animated.View style={[style, { transform: [{ translateY }] }]}>{children}</Animated.View>;
  }
  return <Animated.View style={[style, { paddingBottom: inset }]}>{children}</Animated.View>;
}

export interface KeyboardAwareScrollViewProps extends ScrollViewProps {
  /**
   * Points of keyboard overlap this ScrollView already clears. 0 for a
   * full-bleed list; pass `insets.bottom` when it sits inside a
   * bottom-inset container.
   */
  offset?: number;
  /** Breathing room between the focused input and the top of the keyboard. */
  extraScrollPadding?: number;
  enabled?: boolean;
}

/**
 * A ScrollView that pads its own content by the keyboard overlap and scrolls
 * the focused input back into view. Use it for form screens — anything with a
 * column of inputs where the lower ones would otherwise be unreachable.
 */
export const KeyboardAwareScrollView = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(function KeyboardAwareScrollView(
  { children, offset = 0, extraScrollPadding = 16, enabled = true, ...rest },
  forwardedRef
) {
  const { inset, height, isVisible } = useKeyboardInset({ offset, enabled });
  const scrollRef = useRef<ScrollView>(null);
  // Callers that already held a ref on the ScrollView they replaced keep it.
  useImperativeHandle(forwardedRef, () => scrollRef.current as ScrollView, []);

  useEffect(() => {
    if (!isVisible) return;
    // `currentlyFocusedInput` is only meaningful once the keyboard is up; a
    // frame's delay lets the padding above land first so the scroll target is
    // measured against the final content size.
    const timer = setTimeout(() => {
      // The focused host instance is accepted directly — no `findNodeHandle`,
      // which is a no-op shim under the new architecture.
      const focused = TextInput.State.currentlyFocusedInput();
      const scroll = scrollRef.current;
      if (!focused || !scroll) return;
      scroll.getScrollResponder()?.scrollResponderScrollNativeHandleToKeyboard?.(
        focused,
        extraScrollPadding,
        true
      );
    }, 60);
    return () => clearTimeout(timer);
  }, [isVisible, height, extraScrollPadding]);

  return (
    <ScrollView
      ref={scrollRef}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
      {...rest}
    >
      {children}
      {/* The keyboard's padding lives in a spacer rather than in
          contentContainerStyle, so an Animated value can drive it without
          having to clone and merge the caller's own content style. */}
      <Animated.View style={{ height: inset }} />
    </ScrollView>
  );
})

/**
 * Props to spread onto a `FlatList`/`SectionList`/`VirtualizedList` that
 * contains text inputs. Lists cannot be swapped for `KeyboardAwareScrollView`
 * without giving up virtualization, so they lean on the native path instead:
 * `automaticallyAdjustKeyboardInsets` makes UIScrollView itself inset and
 * scroll for the keyboard, which is as in-sync as it gets.
 *
 * iOS-only (the prop is ignored on Android, where `adjustResize` already
 * resizes the window). Only correct for a list that reaches the bottom of the
 * screen — for one sitting above a fixed bar, use `useKeyboardInset` and pad
 * the bar instead, or the list insets by more than the keyboard covers.
 */
export const keyboardAwareListProps = {
  automaticallyAdjustKeyboardInsets: true,
  keyboardShouldPersistTaps: 'handled',
  keyboardDismissMode: Platform.OS === 'ios' ? 'interactive' : 'on-drag',
} as const;
