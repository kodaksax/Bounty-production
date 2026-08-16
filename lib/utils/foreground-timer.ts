/**
 * createForegroundTimer
 *
 * Accumulates elapsed time while explicitly told to run, excluding any period
 * between a pause() and its matching resume() — the caller is expected to
 * wire those to AppState leaving/returning to 'active' so backgrounded time
 * (a phone call, the app switcher, the device sitting untouched) never counts
 * toward a timing metric.
 *
 * Uses performance.now() when available: it's monotonic, so a wall-clock
 * adjustment while the app is backgrounded (timezone/DST change, NTP sync, a
 * user editing the device clock) can't skew the accumulated duration the way
 * Date.now() deltas could. Falls back to Date.now() on RN runtimes that don't
 * expose a global `performance` — on those, a clock adjustment during a
 * long background period could still introduce drift.
 */

/**
 * Exported so callers that need to time a background span directly (rather
 * than through a ForegroundTimer's pause/resume) — e.g. CreateBountyFlow's
 * `background_seconds` — use the same monotonic source instead of Date.now().
 */
export function getMonotonicNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export interface ForegroundTimer {
  /** Zeroes accumulation and begins running. */
  start: () => void;
  /** Stops accumulating. No-op if already paused. */
  pause: () => void;
  /** Resumes accumulating. No-op if already running. */
  resume: () => void;
  /** Foreground-only seconds accumulated since start(), rounded at read time. */
  elapsedSeconds: () => number;
  /** Zeroes accumulation without changing whether the timer is running. */
  reset: () => void;
}

export function createForegroundTimer(): ForegroundTimer {
  let accumulatedMs = 0;
  let runningSinceMs: number | null = null;

  const start = () => {
    accumulatedMs = 0;
    runningSinceMs = getMonotonicNow();
  };

  const pause = () => {
    if (runningSinceMs === null) return;
    accumulatedMs += getMonotonicNow() - runningSinceMs;
    runningSinceMs = null;
  };

  const resume = () => {
    if (runningSinceMs !== null) return;
    runningSinceMs = getMonotonicNow();
  };

  const elapsedSeconds = () => {
    const liveMs = runningSinceMs === null ? 0 : getMonotonicNow() - runningSinceMs;
    return Math.round((accumulatedMs + liveMs) / 1000);
  };

  const reset = () => {
    accumulatedMs = 0;
    if (runningSinceMs !== null) {
      runningSinceMs = getMonotonicNow();
    }
  };

  return { start, pause, resume, elapsedSeconds, reset };
}
