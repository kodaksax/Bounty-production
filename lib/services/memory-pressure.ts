/**
 * Android memory-pressure handling.
 *
 * WHY THIS EXISTS
 * Google Play's technical quality requirements (enforced from February 2027)
 * measure "Bitmap memory usage" at the 90th percentile and apply *separate,
 * much tighter* thresholds to non-visible app states than to the foreground:
 *
 *   Foreground                 no published limit
 *   User-perceived services    > 200 MB is "bad behavior"
 *   Background                 > 200 MB is "bad behavior"
 *   Cached                     > 400 MB is "bad behavior"
 *
 * Google's guidance is explicit that bitmaps "should not be held in memory for
 * extended periods of time in non-visible app states". Bounty is an
 * image-heavy marketplace — feed thumbnails, avatars, bounty attachments and
 * completion-proof photos — and expo-image keeps a decoded-bitmap memory cache
 * that, before this module, was never released. A user who scrolled a long
 * feed and then switched apps left that cache resident for as long as Android
 * kept the process, counting against the Background/Cached thresholds and
 * making Bounty a more attractive target for low-memory process termination.
 *
 * WHY IT IS DRIVEN BY AppState AND NOT A MEMORY WARNING
 * React Native does not forward Android's `onTrimMemory` to JavaScript. The
 * `memoryWarning` AppState event is emitted by RCTAppState on iOS only; on
 * Android `MemoryPressureRouter` dispatches trim callbacks to native listeners
 * (Yoga and the ViewManager caches) and never crosses the bridge. Verified
 * against react-native 0.83.10 — there is no JS-visible memory-pressure signal
 * on Android, so backgrounding is the only hook available to us.
 *
 * WHY THE DELAY
 * Clearing on every `background` transition would thrash the cache during the
 * extremely common "flick to another app and come straight back" and
 * camera/photo-picker round trips, forcing a full re-decode of the visible
 * feed and making the app feel slower. We only trim once the app has stayed
 * backgrounded past `TRIM_DELAY_MS`, by which point Android considers the
 * process a background/cached candidate anyway.
 *
 * WHAT IS DELIBERATELY NOT CLEARED
 * - The expo-image *disk* cache. Clearing it would force a re-download of
 *   every thumbnail on resume, which costs the user cellular data and makes
 *   the app slower on exactly the poor connections it needs to tolerate. Disk
 *   is not counted by the bitmap-memory metric.
 * - Anything holding user state (drafts, offline queue, session). This module
 *   only releases data that can be re-derived for free.
 */

import { AppState, type AppStateStatus, Platform } from 'react-native';

/**
 * How long the app must stay backgrounded before its decoded-bitmap cache is
 * released. Long enough to survive an app-switch or a photo-picker round trip,
 * short enough that a genuinely backgrounded process is not holding bitmaps
 * when Android samples it.
 */
const TRIM_DELAY_MS = 15_000;

type Trimmer = { name: string; run: () => void | Promise<unknown> };

const trimmers: Trimmer[] = [];

/**
 * Registers an additional cache to release when the app has been backgrounded.
 * Callbacks must be cheap, must never throw meaningfully (failures are
 * swallowed), and must only drop data that can be recreated without user
 * input — never pending writes, drafts or queued actions.
 */
export function registerMemoryTrimmer(name: string, run: () => void | Promise<unknown>): () => void {
  const entry: Trimmer = { name, run };
  trimmers.push(entry);
  return () => {
    const i = trimmers.indexOf(entry);
    if (i >= 0) trimmers.splice(i, 1);
  };
}

async function runTrimmers(): Promise<void> {
  // expo-image is required lazily so this module stays importable in tests and
  // in any runtime where the native view module is unavailable.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { Image } = require('expo-image');
    await Image?.clearMemoryCache?.();
  } catch {
    // expo-image unavailable (Jest, web) — nothing to release.
  }

  for (const trimmer of trimmers) {
    try {
      await trimmer.run();
    } catch (e) {
      if (__DEV__) {
        console.warn(`[memory-pressure] trimmer "${trimmer.name}" failed:`, e);
      }
    }
  }
}

/**
 * Starts watching for background transitions. Safe to call more than once —
 * subsequent calls are no-ops until the returned teardown runs.
 *
 * Returns a teardown function that removes the AppState subscription and
 * cancels any pending trim.
 */
export function startMemoryPressureWatcher(): () => void {
  // iOS already releases image memory under pressure via UIKit's own
  // didReceiveMemoryWarning path, and the Play thresholds this guards against
  // are Android-only. Keep the no-op cheap rather than branching at call sites.
  if (Platform.OS !== 'android') {
    return () => {};
  }

  let pendingTrim: ReturnType<typeof setTimeout> | undefined;

  const cancelPendingTrim = () => {
    if (pendingTrim) {
      clearTimeout(pendingTrim);
      pendingTrim = undefined;
    }
  };

  const handleChange = (next: AppStateStatus) => {
    if (next === 'active') {
      // Came back before the delay elapsed — keep the cache warm.
      cancelPendingTrim();
      return;
    }

    // 'background' and 'inactive' both mean "not visible". Only schedule once.
    if (pendingTrim) return;
    pendingTrim = setTimeout(() => {
      pendingTrim = undefined;
      void runTrimmers();
    }, TRIM_DELAY_MS);
  };

  const subscription = AppState.addEventListener('change', handleChange);

  return () => {
    cancelPendingTrim();
    try {
      subscription.remove();
    } catch {
      // Already removed.
    }
  };
}

/** Exposed for tests and for an explicit "free what you can" call site. */
export const __testables = { runTrimmers, TRIM_DELAY_MS };
