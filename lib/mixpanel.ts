// lib/mixpanel.ts
//
// DEPRECATED compatibility shim.
//
// PostHog is now the single source of truth for product analytics (see
// `lib/posthog.ts`). This module is retained only so any lingering or dynamic
// imports of the old Mixpanel helpers keep compiling and continue to funnel
// their events into PostHog instead of silently going nowhere.
//
// Prefer importing from `lib/posthog` (or `lib/services/analytics-service`)
// directly in new code.

import {
    getPostHog,
    isPostHogReady,
    capture as posthogCapture,
    identify as posthogIdentify,
} from './posthog';

/** @deprecated PostHog initializes itself in `lib/posthog`. No-op kept for compatibility. */
export async function initMixpanel(): Promise<void> {
  // PostHog client is constructed eagerly at import time; nothing to do here.
  return;
}

/** @deprecated Use `isPostHogReady` from `lib/posthog`. */
export const isMixpanelReady = (): boolean => isPostHogReady();

/** @deprecated Forwards to PostHog `identify`. */
export const identify = (id: string, props?: Record<string, any>): void => {
  posthogIdentify(id, props);
};

/** @deprecated Forwards to PostHog `capture`. */
export const track = (event: string, props?: Record<string, any>): void => {
  posthogCapture(event, props);
};

/** @deprecated Returns the shared PostHog client. */
export default function getMixpanel() {
  return getPostHog();
}
