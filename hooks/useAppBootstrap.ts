/**
 * useAppBootstrap
 *
 * Resolves all initialization state (auth + onboarding) **inside** the
 * "loading" phase so that consumers never see an intermediate or incorrect
 * screen.  This eliminates the "onboarding screen flash" that occurred when
 * navigation was attempted before the onboarding check had finished.
 *
 * State machine:
 *   "loading"        — auth provider is still initializing OR the onboarding
 *                      check is in progress. Block any navigation UI.
 *   "unauthenticated" — no active session; show sign-in.
 *   "authenticated"  — session exists and onboarding status is fully known.
 *                      `onboardingComplete` tells consumers which screen to
 *                      route to without any further async work.
 *
 * Key guarantees:
 * - The hook never transitions from "loading" to "authenticated" until the
 *   profile has been checked and onboarding is fully resolved: either the
 *   profile indicates completion OR the local AsyncStorage fallback flag has
 *   been checked.
 * - Once resolved for a given session it will not re-run (idempotent per
 *   session), so profile subscription updates don't cause a second check.
 * - A session change (sign-out / different account sign-in) resets the state
 *   back to "loading" and triggers a fresh resolution cycle.
 */

import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useRef, useState } from 'react'
import { getOnboardingCompleteKey, markDeviceHasSignedIn } from '../lib/storage/onboarding'
import { useAuthContext } from './use-auth-context'

export type AppBootstrapState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'authenticated'; onboardingComplete: boolean }

export function useAppBootstrap(): AppBootstrapState {
  const { session, isLoading, profile } = useAuthContext()
  const [state, setState] = useState<AppBootstrapState>({ status: 'loading' })

  // Which user ID we last fully resolved for.
  // undefined = never resolved; null = resolved while logged-out.
  const resolvedForRef = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    // ── Auth provider still loading ───────────────────────────────────────
    if (isLoading) {
      resolvedForRef.current = undefined
      setState({ status: 'loading' })
      return
    }

    const userId = session?.user?.id ?? null

    // ── Already resolved for this session – nothing to do ─────────────────
    if (resolvedForRef.current !== undefined && resolvedForRef.current === userId) {
      return
    }

    // ── Session changed (sign-out / switch account) – reset ───────────────
    if (resolvedForRef.current !== undefined) {
      resolvedForRef.current = undefined
      setState({ status: 'loading' })
    }

    // ── No active session ─────────────────────────────────────────────────
    if (!userId) {
      resolvedForRef.current = null
      setState({ status: 'unauthenticated' })
      return
    }

    // ── Authenticated ─────────────────────────────────────────────────────

    // Any resolved session means this device has completed a sign-in/sign-up
    // at least once — mark it so a future logout shows the log-in form
    // instead of the first-time onboarding welcome screen.
    markDeviceHasSignedIn()

    // Fast path: profile already says onboarding is complete.
    // Avoid the async round-trip to AsyncStorage entirely.
    if (profile?.onboarding_completed === true && !profile?.needs_onboarding) {
      resolvedForRef.current = userId
      setState({ status: 'authenticated', onboardingComplete: true })
      return
    }

    // Slow path: profile says incomplete, is null (fetch failed), or the DB
    // flag was never written (e.g. network error during done.tsx submit).
    // Fall back to the per-user AsyncStorage flag and trust it here so
    // bootstrap isn't blocked by a network call. Profile existence verification
    // happens later in bounty-app.tsx with its own safety timeout.
    let cancelled = false

    ;(async () => {
      let onboardingComplete = false

      try {
        const stored = await AsyncStorage.getItem(getOnboardingCompleteKey(userId))
        if (stored === 'true') {
          // Trust the per-user AsyncStorage flag directly — making an uncached
          // Supabase network call here blocks bootstrap indefinitely when the
          // network is slow or unavailable on app restore (a common scenario).
          // Profile row existence is verified by bounty-app.tsx which has its
          // own safety timeout; stale flags (deleted profile rows) are handled
          // there by redirecting the user back through onboarding.
          onboardingComplete = true
        }
      } catch {
        // AsyncStorage unavailable — default to onboarding (safe fallback).
        onboardingComplete = false
      }

      if (!cancelled) {
        resolvedForRef.current = userId
        setState({ status: 'authenticated', onboardingComplete })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [session, isLoading, profile])

  return state
}
