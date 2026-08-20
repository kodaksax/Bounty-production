/**
 * The raw URL that opened (or re-opened) the app, for auth-callback handling.
 *
 * Why not `useLocalSearchParams()`: on native, expo-router's
 * `extractExactPathFromURL` rebuilds the incoming link as
 * `host + pathname + search` and drops the fragment. Supabase puts recovery
 * tokens in the fragment, so the router's params are structurally incapable of
 * carrying them on iOS/Android. `expo-linking` hands back the untouched string.
 *
 * Why not `Linking.useURL()`: it collapses "not resolved yet" and "no link"
 * into the same `null`, which forces callers into a timing guess — wait a bit
 * and hope. This hook reports `resolved` explicitly so a caller can hold a
 * "Verifying…" state until the answer is actually known, then decide once.
 *
 * Covers all three entry shapes:
 *   cold start        → `getInitialURL()`
 *   already running   → the `url` event
 *   resumed from bg   → the `url` event (iOS/Android both re-deliver)
 */

import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export type IncomingAuthUrl = {
  /** The raw link, fragment intact, or null when the app was not opened by one. */
  url: string | null;
  /** False only while the cold-start lookup is still in flight. */
  resolved: boolean;
};

function readWebHref(): string | null {
  const location = (globalThis as { location?: { href?: string } }).location;
  return location?.href ?? null;
}

export function useIncomingAuthUrl(): IncomingAuthUrl {
  const [state, setState] = useState<IncomingAuthUrl>(() =>
    // On web the address bar is readable synchronously, so there is no
    // unresolved window at all — and reading it in the initialiser means the
    // first render already has the fragment.
    Platform.OS === 'web' ? { url: readWebHref(), resolved: true } : { url: null, resolved: false }
  );

  useEffect(() => {
    if (Platform.OS === 'web') return;

    let cancelled = false;

    // A `url` event can land before the cold-start lookup settles. When it
    // does, the event is the newer link and must win, so the initial-URL
    // result only fills an empty slot.
    Linking.getInitialURL()
      .then(url => {
        if (cancelled) return;
        setState(prev => (prev.url ? { ...prev, resolved: true } : { url, resolved: true }));
      })
      .catch(() => {
        if (cancelled) return;
        setState(prev => ({ ...prev, resolved: true }));
      });

    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (cancelled) return;
      setState({ url, resolved: true });
    });

    return () => {
      cancelled = true;
      try {
        subscription?.remove?.();
      } catch {
        // Older RN subscription shapes; nothing to clean up if remove is absent.
      }
    };
  }, []);

  return state;
}
