/**
 * The region waitlist, opened from the Post tab. Same screen as the onboarding
 * step, outside the onboarding layout, whose tracker would otherwise count this
 * visit as onboarding_started.
 */

import { WaitlistContent } from './onboarding/waitlist';

export default function PostTabWaitlistRoute() {
  return <WaitlistContent intent="none" origin="post_tab" />;
}
