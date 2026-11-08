// lib/analytics/trust-content.ts
//
// `trust_content_viewed`: someone opened an explainer about how Bounty handles
// money, identity or problems. Topics match content that exists in the app;
// there is no 'review' topic because no explainer covers reviews.

import { analyticsService } from 'lib/services/analytics-service';

export type TrustContentTopic =
  | 'how_it_works'
  | 'escrow'
  | 'verification'
  | 'fees'
  | 'cancellation'
  | 'hunter_payment'
  | 'cash_out'
  | 'dispute';

let pendingSurface: string | null = null;

/**
 * Names where the next explainer screen is being opened from. Called right
 * before navigating, like markPendingNavigationSource, so routes and deep links
 * stay exactly as they were.
 */
export function markTrustContentSurface(surface: string): void {
  pendingSurface = surface;
}

/** Consumed once, by the explainer screen when it opens. */
export function consumeTrustContentSurface(): string {
  const surface = pendingSurface ?? 'unknown';
  pendingSurface = null;
  return surface;
}

export function trackTrustContentViewed(
  topic: TrustContentTopic,
  surface: string,
  properties?: Record<string, string>
): void {
  analyticsService.trackEvent('trust_content_viewed', { topic, surface, ...properties });
}
