import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { Keyboard, type ScrollView, type TextInput } from 'react-native';

// A scroll can stop just short of its target, or never report the last pixel.
const SETTLED_TOLERANCE = 2;
// Longer than the platforms' animated scrollTo, so this only runs if the
// scroll events stop before the target is reached.
const SCROLL_FALLBACK_MS = 500;

function raiseKeyboard(input: TextInput | null) {
  if (!input) return;
  // focus() does nothing on the input React Native already counts as focused,
  // and Android's back button hides the keyboard without blurring the field.
  if (input.isFocused() && !Keyboard.isVisible()) input.blur();
  input.focus();
}

/**
 * Scrolls to `y`, then focuses an input once the scroll has landed. Doing both
 * in one tick starts the keyboard while the scroll is still moving.
 */
export function useFocusAfterScroll(scrollRef: RefObject<ScrollView | null>) {
  const offsetRef = useRef(0);
  const targetRef = useRef(0);
  const pendingInputRef = useRef<RefObject<TextInput | null> | null>(null);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);

  const cancel = useCallback(() => {
    pendingInputRef.current = null;
    if (fallbackRef.current !== null) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const land = useCallback(() => {
    const input = pendingInputRef.current;
    if (!input) return;
    pendingInputRef.current = null;
    if (fallbackRef.current !== null) clearTimeout(fallbackRef.current);
    fallbackRef.current = null;
    // The next frame, so a template tap's draft update has committed first.
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      raiseKeyboard(input.current);
    });
  }, []);

  const focusAfterScroll = useCallback(
    (input: RefObject<TextInput | null>, y: number) => {
      cancel();
      pendingInputRef.current = input;
      targetRef.current = y;
      if (Math.abs(offsetRef.current - y) <= SETTLED_TOLERANCE) {
        land();
        return;
      }
      scrollRef.current?.scrollTo({ y, animated: true });
      fallbackRef.current = setTimeout(land, SCROLL_FALLBACK_MS);
    },
    [cancel, land, scrollRef]
  );

  const onScrollOffset = useCallback(
    (y: number) => {
      offsetRef.current = y;
      if (Math.abs(y - targetRef.current) <= SETTLED_TOLERANCE) land();
    },
    [land]
  );

  return { focusAfterScroll, onScrollOffset };
}
