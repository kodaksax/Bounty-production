import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ACTIVE_HUNTERS_RADIUS_MILES,
  countActiveHuntersNearby,
  updateMyCoordinates,
} from '../lib/services/bounty-location-service';

/**
 * Backs the feed's "N active hunters in your area" pill.
 *
 * Two responsibilities, because the count is useless without the first:
 *
 *  1. Publish the viewer's own coordinates. Nothing else in the app writes
 *     profiles.latitude/longitude — every production row is NULL — so without
 *     this the radius query has nothing to measure against and every user sees
 *     zero forever. Each viewer who opens the feed with location granted makes
 *     themselves countable for everyone else.
 *
 *  2. Read the aggregate count back for the viewer's own position.
 *
 * Returns null rather than 0 whenever the number isn't known (no permission, no
 * fix yet, RPC failed), so the caller can hide the pill instead of asserting
 * that nobody is around.
 */

/** Don't rewrite coordinates for a jitter-sized move. ~0.01 deg ≈ 0.7 miles. */
const MIN_DEGREES_MOVED_TO_REPUBLISH = 0.01;

export interface UseActiveHuntersResult {
  count: number | null;
  radiusMiles: number;
  refresh: () => void;
}

export function useActiveHunters(params: {
  userId: string | null;
  latitude: number | null | undefined;
  longitude: number | null | undefined;
  hasPermission: boolean;
  /** Consider someone active if they've had a session within this many days. */
  activeWithinDays?: number;
}): UseActiveHuntersResult {
  const { userId, latitude, longitude, hasPermission, activeWithinDays = 7 } = params;

  const [count, setCount] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  // Last coordinates we published, so a re-render or a metre of GPS drift
  // doesn't turn into a write on every feed refresh.
  const publishedRef = useRef<{ lat: number; lng: number } | null>(null);

  const refresh = useCallback(() => setNonce(n => n + 1), []);

  useEffect(() => {
    // Without a fix or permission there is no honest number to show. Clear any
    // stale count so the pill disappears rather than freezing on an old value.
    if (!hasPermission || latitude == null || longitude == null) {
      setCount(null);
      return;
    }

    let cancelled = false;

    (async () => {
      // Publish first so the viewer is included in everyone else's count, and
      // so a first-time user isn't invisible to the neighbours they're about to
      // be told about. Best-effort: a failure here must not stop the read.
      if (userId) {
        const previous = publishedRef.current;
        const moved =
          !previous ||
          Math.abs(previous.lat - latitude) > MIN_DEGREES_MOVED_TO_REPUBLISH ||
          Math.abs(previous.lng - longitude) > MIN_DEGREES_MOVED_TO_REPUBLISH;
        if (moved) {
          publishedRef.current = { lat: latitude, lng: longitude };
          const ok = await updateMyCoordinates({ userId, latitude, longitude });
          // Allow a retry on the next pass rather than silently never republishing.
          if (!ok) publishedRef.current = previous;
        }
      }

      const next = await countActiveHuntersNearby({
        latitude,
        longitude,
        radiusMiles: ACTIVE_HUNTERS_RADIUS_MILES,
        activeWithinDays,
      });
      if (!cancelled) setCount(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, latitude, longitude, hasPermission, activeWithinDays, nonce]);

  return { count, radiusMiles: ACTIVE_HUNTERS_RADIUS_MILES, refresh };
}

export default useActiveHunters;
