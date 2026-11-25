/**
 * The hire banner on the poster's job page (E2E-05, Whole-Job Test 2026-11-24).
 *
 * "You chose Ana. Ana is your helper now." used to be a toast that vanished
 * after about ten seconds. It now stays until the poster dismisses it, across
 * reloads and app restarts: `show` is called only after the server confirmed
 * the hire, and stores the name on the device; `dismiss` clears it. Jobs hired
 * before this (or on another device) have nothing stored and show no banner;
 * "The story so far" keeps the record of the hire either way.
 */
import { useCallback, useEffect, useState } from 'react';
import { storage } from '../lib/storage';

/** SecureStore keys allow only letters, digits, ".", "-" and "_". */
export function hireBannerKey(bountyId: string): string {
  return `hire-banner.${bountyId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export function useHireBanner(bountyId: string | null | undefined): {
  /** The chosen helper's name while the banner is up, else null. */
  name: string | null;
  /** True once the stored answer for this job has been read. */
  ready: boolean;
  show: (name: string) => void;
  dismiss: () => void;
} {
  const [state, setState] = useState<{ for: string | null; name: string | null }>({ for: null, name: null });

  useEffect(() => {
    let active = true;
    if (!bountyId) {
      setState({ for: null, name: null });
      return;
    }
    const id = String(bountyId);
    storage
      .getItem(hireBannerKey(id))
      .then((raw) => {
        if (!active) return;
        let name: string | null = null;
        try {
          name = raw ? (JSON.parse(raw) as { name?: string }).name ?? null : null;
        } catch {
          name = null;
        }
        setState({ for: id, name });
      })
      .catch(() => active && setState({ for: id, name: null }));
    return () => {
      active = false;
    };
  }, [bountyId]);

  const show = useCallback(
    (name: string) => {
      if (!bountyId) return;
      const id = String(bountyId);
      setState({ for: id, name });
      void storage.setItem(hireBannerKey(id), JSON.stringify({ name }));
    },
    [bountyId]
  );

  const dismiss = useCallback(() => {
    if (!bountyId) return;
    const id = String(bountyId);
    setState({ for: id, name: null });
    void storage.removeItem(hireBannerKey(id));
  }, [bountyId]);

  const ready = !bountyId || state.for === String(bountyId);
  return { name: ready && bountyId ? state.name : null, ready, show, dismiss };
}
