import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback, useRef } from 'react';

/** The bounty feed tab — the neutral place to land when there is nowhere to go back to. */
export const FEED_FALLBACK: Href = { pathname: '/tabs/bounty-app', params: { screen: 'bounty' } };
/** The profile tab — where verification and account screens are entered from. */
export const PROFILE_FALLBACK: Href = { pathname: '/tabs/bounty-app', params: { screen: 'profile' } };

/**
 * Back navigation that always goes somewhere.
 *
 * A bare `router.back()` is a silent no-op when the screen is the first entry
 * in its stack — which is exactly how a push notification or a shared link
 * opens it (the bounty router and the notification handler both `replace`).
 * The back arrow then does nothing and the user is stranded. This goes back
 * when there is history, and otherwise replaces to `fallback`.
 *
 * `fallback` is a typed `Href` (typed routes are on), so a route that does not
 * exist fails at compile time rather than at the moment someone taps back.
 * Callers may pass an inline route object: the latest value is read through a
 * ref, so the returned callback stays stable across renders either way.
 */
export function useSafeBack(fallback: Href = FEED_FALLBACK) {
  const { back, canGoBack, replace } = useRouter();
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  return useCallback(() => {
    if (canGoBack()) back();
    else replace(fallbackRef.current);
  }, [back, canGoBack, replace]);
}
