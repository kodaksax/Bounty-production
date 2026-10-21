/**
 * Route focus helpers for screens that stay mounted underneath others.
 *
 * The root navigator is a native Stack (app/_layout.tsx): a pushed screen
 * slides over the one below, which stays mounted with its scroll position and
 * state intact. Before that the root was a Slot, which unmounted the screen
 * you left and remounted it on return — and some screens relied on that
 * remount to refetch. `useRefreshOnReturn` gives them the same refresh
 * without the remount.
 *
 * All three read React Navigation's context directly instead of using
 * expo-router's `useIsFocused` / `useFocusEffect`, so they are inert (focused,
 * no-op) when rendered outside a navigator — unit tests, previews — rather
 * than throwing.
 */
import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';

type FocusNavigation = {
  isFocused: () => boolean;
  addListener: (event: 'focus' | 'blur', callback: () => void) => () => void;
  setOptions?: (options: Record<string, unknown>) => void;
};

function useFocusNavigation(): FocusNavigation | null {
  const navigation = useContext(NavigationContext) as FocusNavigation | undefined;
  return navigation ?? null;
}

/** Whether the enclosing screen is the focused one. `true` outside a navigator. */
export function useIsScreenFocused(): boolean {
  const navigation = useFocusNavigation();
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  return focused;
}

/**
 * Calls `onReturn` each time the screen regains focus after something was
 * pushed over it — never on the first focus, which the screen's own mount
 * effects already cover. The callback is read through a ref, so callers
 * don't need to memoize it.
 */
export function useRefreshOnReturn(onReturn: () => void) {
  const navigation = useFocusNavigation();
  const callbackRef = useRef(onReturn);
  callbackRef.current = onReturn;

  useEffect(() => {
    if (!navigation) return;
    let covered = false;
    const offBlur = navigation.addListener('blur', () => {
      covered = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!covered) return;
      covered = false;
      callbackRef.current();
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);
}

/**
 * Turns the iOS edge swipe-back on or off for the enclosing screen. For
 * screens that guard leaving (unsaved changes) — the Android back button is
 * intercepted with useBackHandler, but the swipe would skip that prompt.
 */
export function useSwipeBackEnabled(enabled: boolean) {
  const navigation = useFocusNavigation();
  useEffect(() => {
    navigation?.setOptions?.({ gestureEnabled: enabled });
  }, [navigation, enabled]);
}
