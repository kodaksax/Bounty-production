import { useFeatureFlag } from '../posthog';

export const MOMENTS_ELIGIBILITY_FIX_FLAG = 'moments-eligibility-fix';

/**
 * Whether a presented moment stays up until the user answers it. Only an
 * explicit `true` turns it on: a flag that is missing or hasn't resolved yet
 * keeps today's behaviour.
 */
export function useMomentsEligibilityFixEnabled(): boolean {
  return useFeatureFlag(MOMENTS_ELIGIBILITY_FIX_FLAG) === true;
}
