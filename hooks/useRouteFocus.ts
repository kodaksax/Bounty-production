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
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

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
 *
 * `active: false` is for a tab of the tab shell that is mounted but not the
 * one in view: a return then only marks it stale, and the refresh runs once
 * `active` turns true, so a Back press doesn't refetch every off-screen tab.
 */
export function useRefreshOnReturn(onReturn: () => void, { active = true }: { active?: boolean } = {}) {
  const navigation = useFocusNavigation();
  const callbackRef = useRef(onReturn);
  callbackRef.current = onReturn;
  const activeRef = useRef(active);
  activeRef.current = active;
  const staleRef = useRef(false);

  useEffect(() => {
    if (!navigation) return;
    let covered = false;
    const offBlur = navigation.addListener('blur', () => {
      covered = true;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!covered) return;
      covered = false;
      if (activeRef.current) callbackRef.current();
      else staleRef.current = true;
    });
    return () => {
      offBlur();
      offFocus();
    };
  }, [navigation]);

  useEffect(() => {
    if (!active || !staleRef.current) return;
    staleRef.current = false;
    callbackRef.current();
  }, [active]);
}

/**
 * For a native <Modal> (AppModal) that can open a screen: the screen is
 * pushed onto the navigator *under* the modal, where it can't be seen. This
 * hides the modal while another screen covers the one it was opened on and
 * shows it again when that screen is popped, so Back returns to the modal.
 *
 * Pass the modal's own open state and the parent's unmount callback; hand the
 * returned `presented` to AppModal's `visible` and `onClosed` to its
 * `onClosed`. Only a real close (`visible` false) reaches `onClose`.
 */
export function useModalYieldsToPushedScreens(visible: boolean, onClose: () => void) {
  const focused = useIsScreenFocused();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Closed while hidden (e.g. closed as it pushes the screen): AppModal has
  // already finished its own close, so no onClosed is coming — finish here.
  useEffect(() => {
    if (!visible && !focused) onCloseRef.current();
  }, [visible, focused]);

  const onClosed = useCallback(() => {
    if (!visibleRef.current) onCloseRef.current();
  }, []);

  return { presented: visible && focused, onClosed };
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
