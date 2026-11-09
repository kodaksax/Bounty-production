/**
 * Whether first-time posters see the "how and when you pay" copy.
 *
 * Copy only: this changes no amount, charge or payment path. Anything other
 * than an enabled flag, including a flag that hasn't loaded or doesn't exist
 * yet, means today's wording.
 */

import { useFeatureFlag } from '../posthog';

export const PAYMENT_PROMISE_COPY_FLAG = 'payment-promise-copy';

export function usePaymentPromiseCopy(): boolean {
  const value = useFeatureFlag(PAYMENT_PROMISE_COPY_FLAG);
  return value === true || value === 'test';
}
