/**
 * useOtaUpdates
 *
 * expo-updates only checks for updates on a cold launch, and applies whatever
 * it downloaded on the launch *after* that. Resuming from background is not a
 * launch, so a user who never force-quits can sit on an old bundle for days.
 *
 * This hook closes that gap: it checks on every foreground, downloads in the
 * background, and reloads only when the app has been away long enough that a
 * reload is indistinguishable from a normal cold start — and never while a
 * critical operation (payment, publish) is in flight.
 *
 * Equivalent to CodePush's ON_NEXT_RESUME + minimumBackgroundDuration, which
 * expo-updates has no built-in setting for.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import {
  getActiveCriticalOperations,
  isCriticalOperationInProgress,
} from '../lib/services/critical-operation';

/** Minimum time away before an update is allowed to apply on resume. */
const STALE_BACKGROUND_MS = 10 * 60 * 1000;
/** Floor between checks so rapid app-switching doesn't hammer the update server. */
const MIN_CHECK_INTERVAL_MS = 60 * 1000;

export interface UseOtaUpdatesOptions {
  /**
   * Extra guard on top of the critical-operation registry. Return true to keep
   * a ready update staged instead of reloading now.
   */
  isBusy?: () => boolean;
  /** Escape hatch for tests and debug tooling. */
  enabled?: boolean;
}

export function useOtaUpdates(options: UseOtaUpdatesOptions = {}) {
  const { isBusy, enabled = true } = options;

  const backgroundedAtRef = useRef<number | null>(null);
  const lastCheckRef = useRef(0);
  const inFlightRef = useRef(false);
  // An update fetched during this process but not yet applied. `isUpdatePending`
  // is only exposed through the useUpdates() hook in this SDK version, and a
  // bundle staged by a *previous* process is applied by the native layer at cold
  // start anyway — so only this process's fetch needs tracking.
  const pendingRef = useRef(false);
  // Kept in a ref so the AppState listener never has to be torn down and
  // re-registered when the caller passes a new inline closure.
  const isBusyRef = useRef(isBusy);
  isBusyRef.current = isBusy;

  const syncUpdates = useCallback(
    async (awayMs: number) => {
      // Updates.isEnabled is false in Expo Go and dev clients; __DEV__ keeps
      // this off in local development where the bundle comes from Metro.
      if (!enabled || __DEV__ || !Updates.isEnabled) return;
      if (inFlightRef.current) return;
      if (Date.now() - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;

      inFlightRef.current = true;
      lastCheckRef.current = Date.now();

      try {
        // Already downloaded earlier in this session and declined at the time —
        // no need to ask the server again.
        if (!pendingRef.current) {
          const check = await Updates.checkForUpdateAsync();
          if (!check.isAvailable) return;
          const fetched = await Updates.fetchUpdateAsync();
          pendingRef.current = fetched.isNew;
        }

        if (!pendingRef.current) return;

        // Staged but not applied: too soon, or the user is mid-transaction.
        // Either way expo-updates keeps it on disk and applies it at the next
        // cold start, so nothing is lost by declining here.
        if (awayMs < STALE_BACKGROUND_MS) return;

        if (isCriticalOperationInProgress() || isBusyRef.current?.()) {
          if (__DEV__) {
            console.log(
              '[useOtaUpdates] Update ready but deferring — active:',
              getActiveCriticalOperations()
            );
          }
          return;
        }

        await Updates.reloadAsync();
      } catch {
        // Offline, or the update server is unreachable. Silent by design —
        // this is background maintenance and retries on the next foreground.
      } finally {
        inFlightRef.current = false;
      }
    },
    [enabled]
  );

  useEffect(() => {
    const handleChange = (next: AppStateStatus) => {
      if (next === 'background' || next === 'inactive') {
        // Only record the first transition: iOS emits 'inactive' before
        // 'background', and overwriting would reset the clock.
        if (backgroundedAtRef.current === null) {
          backgroundedAtRef.current = Date.now();
        }
        return;
      }

      if (next === 'active') {
        const awayMs = backgroundedAtRef.current ? Date.now() - backgroundedAtRef.current : 0;
        backgroundedAtRef.current = null;
        void syncUpdates(awayMs);
      }
    };

    // Cold start: stage anything pending for the next launch, never reload here
    // (awayMs 0) — the user just opened the app and is looking at it.
    void syncUpdates(0);

    const subscription = AppState.addEventListener('change', handleChange);
    return () => subscription.remove();
  }, [syncUpdates]);
}

export default useOtaUpdates;
