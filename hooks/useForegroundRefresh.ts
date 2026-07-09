/**
 * useForegroundRefresh
 *
 * Invokes a callback when the app returns to the foreground ('active') after
 * having been backgrounded for at least `minBackgroundMs`.
 *
 * Why: on React Native, JS timers and in-flight network requests are paused
 * (or silently dropped) while the app is backgrounded. When the user returns
 * to the app without signing out, screens that only fetch on mount are left
 * with stale — or seemingly empty — data until a manual pull-to-refresh.
 * Wiring this hook into data screens ensures Supabase-backed data silently
 * repopulates after the app resumes.
 *
 * The callback is invoked via a ref, so callers don't need to memoize it and
 * the AppState listener is only registered once per mount.
 */

import { useEffect, useRef } from 'react'
import { AppState, AppStateStatus } from 'react-native'

/** Default minimum time (ms) the app must be backgrounded before a refresh fires. */
export const DEFAULT_MIN_BACKGROUND_MS = 30_000

export function useForegroundRefresh(
  onForeground: () => void,
  { minBackgroundMs = DEFAULT_MIN_BACKGROUND_MS }: { minBackgroundMs?: number } = {}
) {
  const callbackRef = useRef(onForeground)
  callbackRef.current = onForeground

  const minBackgroundMsRef = useRef(minBackgroundMs)
  minBackgroundMsRef.current = minBackgroundMs

  useEffect(() => {
    let lastState: AppStateStatus = AppState?.currentState ?? 'active'
    let backgroundedAt: number | null = null

    const handleChange = (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        // Record when the app first left the foreground; 'inactive' → 'background'
        // transitions must not reset the timestamp.
        if (backgroundedAt === null) {
          backgroundedAt = Date.now()
        }
      } else if (nextState === 'active' && lastState !== 'active') {
        const elapsed = backgroundedAt === null ? 0 : Date.now() - backgroundedAt
        backgroundedAt = null
        if (elapsed >= minBackgroundMsRef.current) {
          try {
            callbackRef.current()
          } catch (e) {
            // Refresh callbacks are best-effort; never crash on foreground.
            console.warn('[useForegroundRefresh] onForeground callback threw:', e)
          }
        }
      }
      lastState = nextState
    }

    let subscription: { remove?: () => void } | null = null
    try {
      if (AppState?.addEventListener) {
        subscription = AppState.addEventListener('change', handleChange)
      }
    } catch {
      // AppState may be unavailable in some test environments; skip gracefully.
    }

    return () => {
      try {
        subscription?.remove?.()
      } catch {
        // swallow cleanup errors
      }
    }
  }, [])
}
