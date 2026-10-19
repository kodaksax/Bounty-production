import { useCallback, useRef, useState } from 'react';
import { analyticsService } from '../lib/services/analytics-service';
import { getMyCoordinates } from '../lib/services/bounty-location-service';

/**
 * Before applying to in-person work, a hunter with no saved location is asked
 * for a ZIP (SBA-02; components/zip-location-modal.tsx). Online jobs never
 * ask, and neither does a failed lookup: the server just records no distance
 * for that application, which is better than blocking it on a network blip.
 *
 * Usage:
 *   const gate = useApplyLocationGate(userId);
 *   gate.run({ bountyId, workType }, () => continueApplying());
 *   <ZipLocationModal visible={gate.visible} onSaved={gate.onSaved} onCancel={gate.onCancel} ... />
 */
export function useApplyLocationGate(userId: string | null | undefined) {
  const [visible, setVisible] = useState(false);
  const pendingRef = useRef<{ bountyId: string; proceed: () => void } | null>(null);
  // Once a point is known to be saved, later applies in this session skip the read.
  const hasSavedPointRef = useRef(false);

  const run = useCallback(
    async (bounty: { bountyId: string; workType?: string | null }, proceed: () => void) => {
      if (bounty.workType !== 'in_person' || !userId || hasSavedPointRef.current) {
        proceed();
        return;
      }
      const result = await getMyCoordinates(userId);
      if (!result.ok || result.coords) {
        if (result.ok) hasSavedPointRef.current = true;
        proceed();
        return;
      }
      pendingRef.current = { bountyId: bounty.bountyId, proceed };
      analyticsService.trackEvent('apply_location_prompt_shown', { bounty_id: bounty.bountyId });
      setVisible(true);
    },
    [userId]
  );

  const onSaved = useCallback(({ geocoded }: { geocoded: boolean }) => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (geocoded) hasSavedPointRef.current = true;
    setVisible(false);
    analyticsService.trackEvent('apply_location_saved', {
      bounty_id: pending?.bountyId,
      geocoded,
    });
    pending?.proceed();
  }, []);

  const onCancel = useCallback(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    setVisible(false);
    analyticsService.trackEvent('apply_location_prompt_cancelled', { bounty_id: pending?.bountyId });
  }, []);

  return { visible, run, onSaved, onCancel };
}

export default useApplyLocationGate;
