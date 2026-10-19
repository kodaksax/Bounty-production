import { useEffect, useState } from 'react';
import { getMyCoordinates } from '../lib/services/bounty-location-service';
import type { LocationCoordinates, LocationPermissionState } from '../lib/types';

/**
 * How long to wait for a GPS fix, when permission is already granted, before
 * the feed loads with the saved point (or none). Keeps the first load from
 * showing "Any distance" and then snapping to the local default.
 */
export const FEED_LOCATION_FIX_WAIT_MS = 1500;

export interface FeedLocation {
  /** The point the feed measures from: the device fix, else the saved profile point. */
  coords: LocationCoordinates | null;
  /** True once there is enough to pick the feed's default distance. Never stays false. */
  ready: boolean;
}

/**
 * The hunter's location for the feed's radius default (SBA-02). A hunter
 * "has a location" when the device has a fix or their profile has a saved
 * point (written from GPS by useActiveHunters, or from a ZIP before applying).
 */
export function useFeedLocation(params: {
  userId: string | null | undefined;
  deviceLocation: LocationCoordinates | null;
  permission: LocationPermissionState | null;
}): FeedLocation {
  const { userId, deviceLocation, permission } = params;
  const [saved, setSaved] = useState<LocationCoordinates | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  const [fixWaitOver, setFixWaitOver] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setSaved(null);
      setSavedChecked(true);
      return;
    }
    setSavedChecked(false);
    getMyCoordinates(userId).then(result => {
      if (cancelled) return;
      setSaved(result.ok ? result.coords : null);
      setSavedChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    const t = setTimeout(() => setFixWaitOver(true), FEED_LOCATION_FIX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  const coords = deviceLocation ?? saved;
  const permissionKnown = permission != null;
  const ready =
    fixWaitOver ||
    (savedChecked && permissionKnown && (!permission?.granted || deviceLocation != null || saved != null));

  return { coords, ready };
}

export default useFeedLocation;
