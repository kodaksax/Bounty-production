import { useEffect, useState } from 'react';
import { getBountyExactLocation, type ExactBountyLocation } from '../lib/services/bounty-location-service';

/**
 * Exact address for a bounty, for its poster or accepted hunter only.
 *
 * `enabled` is the caller's own participant check — it saves a round trip for
 * people who'd be refused anyway. It is not the security boundary:
 * get_bounty_exact_location() re-checks auth.uid() server-side and returns
 * nothing to anyone else.
 */
export function useBountyExactLocation(bountyId: string | number | null | undefined, enabled: boolean) {
  const [exact, setExact] = useState<ExactBountyLocation | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || bountyId == null || bountyId === '') {
      setExact(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setExact(null);
    setIsLoading(true);
    getBountyExactLocation(String(bountyId)).then((result) => {
      if (cancelled) return;
      setExact(result);
      setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [bountyId, enabled]);

  return { exact, isLoading };
}

/** "55 Elm Street, Boston, MA, Apt 4B" — the full exact line for participants. */
export function formatExactAddress(exact: ExactBountyLocation | null): string | null {
  if (!exact?.location) return null;
  return exact.unit ? `${exact.location}, ${exact.unit}` : exact.location;
}
