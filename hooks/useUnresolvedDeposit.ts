/**
 * The payment still being confirmed for one job, if there is one (E.3 in the
 * workspace). Asks the server on arrival, on return and every few seconds
 * while the screen is showing; `onResolved` fires once with the answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadUnresolvedDeposit,
  reconcileUnresolvedDeposit,
  type UnresolvedDepositRecord,
} from '../lib/services/unresolved-deposit';
import { useIsScreenFocused } from './useRouteFocus';

const POLL_MS = 10_000;

export function useUnresolvedDeposit(
  bountyId: string | null,
  enabled: boolean,
  onResolved: (verdict: 'credited' | 'not_charged', record: UnresolvedDepositRecord) => void
): { record: UnresolvedDepositRecord | null; check: () => void; checked: boolean } {
  const [record, setRecord] = useState<UnresolvedDepositRecord | null>(null);
  // The job whose first answer is in. Until then the job page can't know
  // whether choosing someone is safe (E.3), so it keeps showing the loader.
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const focused = useIsScreenFocused();
  const resolvedRef = useRef(onResolved);
  resolvedRef.current = onResolved;

  useEffect(() => {
    if (!enabled || !bountyId || !focused) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const found = await loadUnresolvedDeposit().catch(() => null);
      if (!active) return;
      const mine = found && found.bountyId === bountyId ? found : null;
      setRecord(mine);
      setCheckedFor(bountyId);
      if (!mine) return;
      const verdict = await reconcileUnresolvedDeposit(mine);
      if (!active) return;
      if (verdict === 'pending') {
        timer = setTimeout(() => void run(), POLL_MS);
        return;
      }
      setRecord(null);
      resolvedRef.current(verdict, mine);
    };
    void run();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [bountyId, enabled, focused, attempt]);

  const check = useCallback(() => setAttempt((n) => n + 1), []);
  // Not asked (disabled, or the screen isn't focused yet): nothing to wait for
  // once disabled; while unfocused the page isn't on screen anyway.
  const checked = !enabled || !bountyId || checkedFor === bountyId;
  return { record, check, checked };
}
