/**
 * useVersionGate
 *
 * Checks the installed native build against the published floor on mount and
 * on every foreground, and reports whether to nudge or block.
 *
 * A nudge is snoozed for a day once dismissed — the article's advice, and the
 * difference between a helpful prompt and one users learn to swat away. A
 * required update is never snoozable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import {
  evaluateVersionGate,
  type VersionGateResult,
  type VersionRequirement,
} from '../lib/services/app-version-service';
import { storage } from '../lib/storage';

const SNOOZE_KEY = 'BE:versionNudgeSnoozedUntil';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
/** Don't re-hit the network on every brief app switch. */
const MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface VersionGateState {
  /** Show the blocking "update required" screen. */
  isBlocked: boolean;
  /** Show the dismissible "update available" nudge. */
  showNudge: boolean;
  requirement: VersionRequirement | null;
  installedVersion: string | null;
  /** Dismiss the nudge for 24h. No-op when blocked. */
  snooze: () => void;
}

export function useVersionGate(): VersionGateState {
  const [result, setResult] = useState<VersionGateResult | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<number>(0);
  const lastCheckRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    storage
      .getItem(SNOOZE_KEY)
      .then((value) => {
        if (cancelled || !value) return;
        const parsed = parseInt(value, 10);
        if (Number.isFinite(parsed)) setSnoozedUntil(parsed);
      })
      .catch(() => {
        // Snooze state is a nicety; losing it only means one extra prompt.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const check = useCallback(async (force = false) => {
    if (inFlightRef.current) return;
    if (!force && Date.now() - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;

    inFlightRef.current = true;
    lastCheckRef.current = Date.now();
    try {
      const next = await evaluateVersionGate();
      setResult(next);
    } catch {
      // evaluateVersionGate already fails open; nothing to do here.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void check(true);

    const handleChange = (next: AppStateStatus) => {
      if (next === 'active') void check();
    };
    const subscription = AppState.addEventListener('change', handleChange);
    return () => subscription.remove();
  }, [check]);

  const snooze = useCallback(() => {
    const until = Date.now() + SNOOZE_MS;
    setSnoozedUntil(until);
    void storage.setItem(SNOOZE_KEY, String(until));
  }, []);

  const status = result?.status ?? 'ok';

  return {
    isBlocked: status === 'update-required',
    showNudge: status === 'update-available' && Date.now() >= snoozedUntil,
    requirement: result?.requirement ?? null,
    installedVersion: result?.installedVersion ?? null,
    snooze,
  };
}

export default useVersionGate;
