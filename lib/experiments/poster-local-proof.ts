/**
 * Whether the local-proof UI is on: the Post tab's one-line note and the empty
 * feed's "Post a task" button. Anything other than an enabled flag, including a
 * flag that hasn't loaded or doesn't exist yet, means today's UI.
 */

import { useFeatureFlag } from '../posthog';

export const POSTER_LOCAL_PROOF_FLAG = 'poster-local-proof';

export function usePosterLocalProof(): boolean {
  const value = useFeatureFlag(POSTER_LOCAL_PROOF_FLAG);
  return value === true || value === 'test';
}
