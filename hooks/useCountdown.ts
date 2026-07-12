import { useEffect, useState } from 'react';

export interface CountdownResult {
  /** True once the deadline is 24 hours away or less (and hasn't passed). */
  isWithin24h: boolean;
  /** True once the deadline has passed. */
  isExpired: boolean;
  /** "HH:MM:SS" remaining, only meaningful when isWithin24h is true. */
  label: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.floor(msRemaining / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Live-ticking countdown to a bounty deadline. Ticks every second once the
 * deadline is within 24 hours; otherwise it only re-checks once a minute so
 * a card left open across the 24h boundary still flips on without paying
 * for per-second re-renders while the deadline is far away.
 */
export function useCountdown(endDate?: string | null): CountdownResult {
  const target = endDate ? new Date(endDate).getTime() : NaN;
  const [now, setNow] = useState(() => Date.now());

  const msRemaining = target - now;
  const isWithin24h = Number.isFinite(target) && msRemaining > 0 && msRemaining <= DAY_MS;

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (target - Date.now() <= 0) return; // already expired, nothing to tick

    const tickMs = isWithin24h ? 1000 : 60000;
    const interval = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(interval);
  }, [target, isWithin24h]);

  if (!Number.isFinite(target)) {
    return { isWithin24h: false, isExpired: false, label: '' };
  }

  return {
    isWithin24h,
    isExpired: msRemaining <= 0,
    label: isWithin24h ? formatCountdown(msRemaining) : '',
  };
}
