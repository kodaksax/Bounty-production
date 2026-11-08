import { useFeatureFlag } from '../../../lib/posthog';

export const TEMPLATE_DETAILS_FLAG = 'composer-template-details';

/**
 * Whether step 1 treats "What exactly, and when?" as optional and helps a
 * poster past a blocked Next. Only an explicit `true` turns it on: a flag that
 * is missing or hasn't resolved yet keeps today's required field.
 */
export function useTemplateDetailsEnabled(): boolean {
  return useFeatureFlag(TEMPLATE_DETAILS_FLAG) === true;
}
