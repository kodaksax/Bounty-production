import { getWalletPostingFee } from 'lib/services/bounty-funding-service';
import { useEffect, useState } from 'react';

// Shared across mounts so the amount step and the publish hook agree on one
// value per session and the composer does not re-fetch it on every step.
let cachedFee: number | null = null;
let pending: Promise<number> | null = null;

/**
 * The flat fee (dollars) debited from the wallet next to escrow when a bounty
 * is funded at post. 0 while loading, on error, or when the fee is off; the
 * server charges from its own config either way (see getWalletPostingFee).
 */
export function useWalletPostingFee(): number {
  const [fee, setFee] = useState(cachedFee ?? 0);

  useEffect(() => {
    if (cachedFee !== null) {
      setFee(cachedFee);
      return;
    }

    let cancelled = false;
    if (!pending) {
      pending = getWalletPostingFee().then(value => {
        cachedFee = value;
        return value;
      });
    }
    pending.then(value => {
      if (!cancelled) setFee(value);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return fee;
}

/** Test seam — resets the module-level cache between suites. */
export function __resetWalletPostingFeeCacheForTests(): void {
  cachedFee = null;
  pending = null;
}
