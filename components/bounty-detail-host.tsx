/**
 * Owns the bounty detail popup for a list whose rows can leave it while the
 * popup is open (the feed).
 *
 * Each card used to mount its own BountyDetailModal, so the popup lived
 * exactly as long as the card's row did. In the feed that is not long enough:
 * apply, open the poster's profile, come back, and the feed reloads your
 * applications, drops the bounty you just applied to (applied bounties leave
 * the open feed), unmounts its row — and the popup with it. A realtime status
 * change, a removal or a passed deadline did the same with no navigation at
 * all. Here the popup holds its own copy of the bounty, so it stays until the
 * user closes it, whatever happens to the row.
 *
 * Cards rendered outside a host (a profile's bounty history) keep their own
 * popup — see useBountyDetailHost.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BountyDetailModal, type BountyDetailModalProps } from './bountydetailmodal';
import type { ModalOrigin } from './ui/app-modal';

export type BountyDetailSnapshot = BountyDetailModalProps['bounty'];

type BountyDetailHostValue = {
  open: (bounty: BountyDetailSnapshot, origin: ModalOrigin | null) => void;
  /**
   * A card for this bounty unmounted. If it opened the popup, the popup stops
   * growing out of / shrinking back into where it was — another card (or
   * nothing) sits there now.
   */
  cardGone: (id: string) => void;
};

const BountyDetailHostContext = createContext<BountyDetailHostValue | null>(null);

/** The enclosing host, or null when cards should open their own popup. */
export function useBountyDetailHost(): BountyDetailHostValue | null {
  return useContext(BountyDetailHostContext);
}

export function BountyDetailHost({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<{ bounty: BountyDetailSnapshot; origin: ModalOrigin | null } | null>(null);

  const open = useCallback((bounty: BountyDetailSnapshot, origin: ModalOrigin | null) => {
    setCurrent({ bounty, origin });
  }, []);
  const cardGone = useCallback((id: string) => {
    setCurrent(prev =>
      prev && prev.origin && String(prev.bounty.id) === id ? { ...prev, origin: null } : prev
    );
  }, []);
  const close = useCallback(() => setCurrent(null), []);
  const value = useMemo(() => ({ open, cardGone }), [open, cardGone]);

  return (
    <BountyDetailHostContext.Provider value={value}>
      {children}
      {current && (
        <BountyDetailModal
          key={String(current.bounty.id)}
          bounty={current.bounty}
          origin={current.origin}
          onClose={close}
        />
      )}
    </BountyDetailHostContext.Provider>
  );
}
