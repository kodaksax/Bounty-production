// lib/services/analytics-service.ts - Analytics tracking service backed by PostHog
//
// PostHog is the single source of truth for product analytics. This service
// provides a typed, app-wide facade over the shared PostHog client defined in
// `lib/posthog.ts`, so non-React surfaces (services, hooks, startup) emit the
// exact same events into the exact same PostHog project as the React
// `usePostHog()` hook and autocapture.
import { analytics as heycatch } from '@heycatch/sdk';
import { Platform } from 'react-native';
import {
    isPostHogReady,
    capture as posthogCapture,
    flush as posthogFlush,
    identify as posthogIdentify,
    reset as posthogReset,
    screen as posthogScreen,
    setPersonProperties as posthogSetPersonProperties,
} from '../posthog';

// Track key user events according to requirements
export type AnalyticsEvent =
  // App lifecycle / acquisition funnel
  | 'app_opened'
  // Auth events
  | 'user_signed_up'
  | 'user_logged_in'
  | 'user_logged_out'
  | 'email_verified'
  // Onboarding funnel — see app/onboarding/*. Fired in order for a fresh
  // signup: welcome_viewed -> role_selected -> auth_started -> auth_completed
  // -> style_step_viewed -> (style_selected)* -> profile_step_viewed ->
  // (profile_submitted | step_skipped)* -> completed
  | 'onboarding_welcome_viewed'
  | 'onboarding_role_selected'
  // first_screen_variant A/B (lib/experiments/first-screen-variant.ts):
  // control vs poster_first arm of app/onboarding/welcome.tsx. Fired
  // identically by both arms (in addition to the funnel events above, which
  // both arms also still fire) so poster-tap-rate can be compared cleanly:
  // poster taps ÷ total first_screen_cta_tapped where side != 'login'.
  // first_screen_proof_impression only applies to the poster_first arm
  // (control has no proof card).
  | 'first_screen_viewed'
  | 'first_screen_proof_impression'
  | 'first_screen_cta_tapped'
  // 'onboarding-skip-role-selection' PostHog experiment, test arm only: fired
  // from the single "Get started" CTA that replaces the two intent buttons.
  // Role is deferred to CombinedActivationPrompt (or inferred later from a
  // real first action) instead of being picked here.
  | 'onboarding_role_selection_skipped'
  | 'onboarding_intent_switched'
  | 'onboarding_login_tapped'
  | 'onboarding_auth_started'
  | 'onboarding_auth_completed'
  | 'onboarding_style_step_viewed'
  | 'onboarding_style_selected'
  | 'onboarding_profile_step_viewed'
  | 'onboarding_profile_submitted'
  | 'onboarding_step_skipped'
  | 'onboarding_bounty_posted'
  | 'onboarding_bounty_posted_screen_shown'
  // RENAMED from 'onboarding_bounty_accepted' (2026-08). It fires when the
  // HUNTER's sample application is submitted — nothing "accepts" anything
  // here (no poster action occurred). The old name collided with the
  // genuinely poster-side `bounty_accepted`/`bounty_claimed` fired from
  // hooks/useAcceptRequest.ts, which measure a completely different funnel
  // step. Flagging in case a dashboard still queries the old name.
  | 'onboarding_bounty_applied'
  | 'onboarding_application_submitted_screen_shown'
  | 'onboarding_completed'
  // Settings — fired when a user changes a display/layout preference after
  // onboarding, so it can be compared against the onboarding-time choice.
  | 'settings_bounty_format_changed'
  // Hunter discovery step (part of onboarding_profile_step_viewed with
  // intent=hunter) — see HunterLocationPrompt.tsx / HunterSampleBountyScreen.tsx.
  // One of granted/denied fires per "Use my location" tap; zip_searched fires
  // per ZIP submission; exactly one of nearby_bounties_shown/no_nearby_bounties
  // fires once a search resolves; online_bounties_viewed fires whenever the
  // online/remote fallback is shown (skip, denial, or the "Browse Online
  // Bounties" CTA).
  | 'onboarding_location_permission_granted'
  | 'onboarding_location_permission_denied'
  | 'onboarding_zip_searched'
  | 'onboarding_nearby_bounties_shown'
  | 'onboarding_no_nearby_bounties'
  | 'onboarding_online_bounties_viewed'
  | 'onboarding_notify_me_requested'
  | 'unserviceable_region_shown'
  // Moments Queue — post-onboarding contextual activation prompts, see lib/moments/*
  // Funnel order for one moment instance: moment_event_enqueued (the real
  // business event that made it eligible) -> moment_shown (presented) ->
  // exactly one
  // of moment_accepted/moment_dismissed/moment_snoozed/moment_skipped ->
  // (accepted only) moment_completed, or moment_expired if it was shown
  // maxShownCount times without ever being resolved.
  | 'moment_event_enqueued'
  | 'moment_shown'
  | 'moment_dismissed'
  | 'moment_snoozed'
  | 'moment_accepted'
  | 'moment_completed'
  | 'moment_skipped'
  | 'moment_expired'
  // Identity verification (Stripe Connect KYC)
  | 'identity_submitted'
  | 'identity_verified'
  // Posting funnel — the canonical drop-off funnel for "does a published
  // bounty actually have money escrowed at publish". Fired from BOTH posting
  // surfaces (app/screens/CreateBounty/* and the onboarding poster branch in
  // app/onboarding/details.tsx) so the two can be analysed as one funnel;
  // every event carries `surface: 'create_flow' | 'onboarding'`.
  //
  // Happy path, in order:
  //   post_started -> category_selected -> amount_set -> payment_attached
  //   -> post_published -> first_submission_received
  //
  // `category_selected` is genuinely optional (the category step allows skip),
  // so treat it as an informational step rather than a required funnel stage.
  //
  // NOTE ON `payment_attached`: under payment architecture v1 (the only one
  // that has ever run in production) money is reserved from the poster's
  // pre-loaded custodial wallet balance by the `fn_reserve_bounty_escrow` DB
  // trigger at INSERT time. So this event means "funds are confirmed
  // available to cover this amount" — either the existing balance already
  // covered it (`source: 'existing_balance'`) or a deposit just succeeded
  // (`source: 'deposit'`). It is NOT a card authorization.
  //
  // `first_submission_received` is emitted by the HUNTER's client when their
  // application is the first one on that bounty, so its distinct_id is the
  // hunter, not the poster. Join it to `post_published` on `bountyId` rather
  // than treating it as a person-level funnel step.
  | 'post_started'
  | 'post_step_viewed'
  | 'category_selected'
  | 'amount_set'
  | 'payment_attached'
  | 'post_published'
  | 'first_submission_received'
  | 'post_abandoned'
  // Post-flow "graveyard" funnel (2026-08 Part C spec) — a finer-grained,
  // per-step drop-off funnel layered ON TOP OF (not replacing) the posting
  // funnel above: post_flow_started/post_step_completed/post_step_abandoned/
  // bounty_published add step timing (seconds_on_step/seconds_total) and an
  // exit_method breakdown that post_started/post_abandoned/post_published
  // don't carry. `post_step_viewed` is shared — this spec's step_index/
  // step_name/variant properties are added onto the SAME event above rather
  // than duplicated under a new name.
  //
  // Currently wired for the control arm only (the existing 6-step flow in
  // app/screens/CreateBounty/index.tsx) — `variant` is hardcoded 'control'
  // until a second arm exists to compare against. The key ratio this funnel
  // exists to expose: bounty_published ÷ post_flow_started.
  | 'post_flow_started'
  | 'post_step_completed'
  | 'post_step_abandoned'
  | 'post_title_typed'
  | 'bounty_published'
  // NOT YET WIRED — no UI exists for these today. The redesigned fast-path
  // flow they belong to (category chips on the title step, a price-anchor
  // display sourced from historical bounty amounts per category, and a
  // post-publish "add detail" surface for photos/time/address/notes deferred
  // off the critical path) hasn't been built. Wire these up alongside that
  // work rather than faking them now.
  | 'post_chip_tapped'
  | 'post_price_anchor_shown'
  | 'post_publish_detail_added'
  // Posting funnel — the two ways a priced bounty becomes a $0 one. These
  // exist to size the single biggest known leak: posters who choose an amount
  // and then publish for free instead. Both carry `previousAmount` so
  // "set a price, then bailed" is separable from "never wanted to pay".
  | 'post_switched_to_honor'
  | 'post_funding_skipped_to_honor'
  // Fired when a poster taps a preset amount that exceeds their wallet
  // balance and the UI refuses to apply it — a dead end with no in-flow way
  // to add funds. Sizes how often the amount step is unusable.
  | 'post_amount_blocked_by_balance'
  // Bounty events
  | 'bounty_created'
  | 'bounty_queued'
  | 'bounty_viewed'
  // NOTE ON NAMING COLLISION: `bounty_accepted`/`bounty_claimed` below are
  // fired from hooks/useAcceptRequest.ts when the POSTER accepts a hunter's
  // request (open -> in_progress). The `bounty_claim_*` funnel further down
  // is unrelated and fires from the HUNTER's apply action instead. Same verb
  // ("claim"/"accept"), two different actors and funnel stages — don't
  // conflate them when querying.
  | 'bounty_accepted'
  | 'bounty_claimed'
  // `bounty_completed` fires from 3 real completion paths (payout release,
  // manual mark-complete, and poster approving a submitted-work review) plus
  // the hunter-claim funnel below carries `is_onboarding_demo` on every
  // event so tutorial completions (there is no fixed demo bounty — see
  // `bounty_claim_started` below) never contaminate a real liquidity metric.
  | 'bounty_completed'
  | 'bounty_cancelled'
  // Bounty browse/discovery events — see docs on the supply-vs-plumbing
  // question these resolve. `bounty_list_viewed` fires whenever a
  // list/feed/map of bounties renders with results (including zero — the
  // empty case is the most informative outcome, so it is NOT filtered out).
  // `bounty_search` fires when a bounty search query resolves; it carries
  // `query_length`, never the raw query text (PII risk).
  | 'bounty_list_viewed'
  | 'bounty_search'
  // Hunter claim funnel — bounty_claim_started (Apply tapped) ->
  // bounty_claim_submitted (insert succeeded) or bounty_claim_failed.
  // `is_onboarding_demo` is MANDATORY on all three and on `bounty_completed`.
  //
  // There is no fixed "demo bounty" — the onboarding hunter tutorial applies
  // to a real, live, randomly-selected open bounty (see
  // app/onboarding/details.tsx:handleApplyToSample), so `is_onboarding_demo`
  // cannot be derived from the bounty ID. It is instead set by the calling
  // surface: `false` from the two real apply screens
  // (components/bountydetailmodal.tsx, app/bounty/[id]/public.tsx), `true`
  // from the onboarding tutorial. Same convention as the posting funnel's
  // `surface: 'create_flow' | 'onboarding'` property above.
  | 'bounty_claim_started'
  | 'bounty_claim_submitted'
  | 'bounty_claim_failed'
  // Payment events
  | 'payment_initiated'
  | 'payment_completed'
  | 'payment_failed'
  | 'payment_error'
  | 'payment_security_warning'
  | 'payment_sca_required'
  | 'payment_method_removed'
  | 'payment_method_saved'
  // Fired when the Apple Pay button is tapped but isApplePaySupported()/the
  // native SDK reports Apple Pay as unusable, so the tap dead-ends before any
  // backend call — otherwise invisible in analytics (see hooks/use-wallet-deposit.ts).
  | 'apple_pay_unavailable'
  | 'escrow_funded'
  | 'escrow_released'
  | 'escrow_refunded'
  // Stripe Phase 2 (payment_architecture_version=2) bounty escrow routing —
  // see lib/utils/payment-architecture.ts. escrow_funded/escrow_released/
  // escrow_refunded above are reused for both architectures (properties
  // carry `architecture: 'v1' | 'v2'`); this event is v2-routing-specific.
  | 'payment_architecture_routed'
  // Payout (withdrawal) events
  | 'payout_initiated'
  | 'payout_success'
  | 'payout_failed'
  // SetupIntent events
  | 'setup_intent_created'
  | 'setup_intent_confirmed'
  | 'setup_intent_failed'
  // ACH / Financial Connections events
  | 'ach_link_started'
  | 'ach_link_completed'
  | 'ach_link_failed'
  | 'ach_link_cancelled'
  | 'ach_deposit_started'
  | 'ach_deposit_failed'
  // Messaging events
  | 'message_sent'
  | 'conversation_started'
  | 'conversation_viewed'
  // Profile events
  | 'profile_viewed'
  | 'profile_updated'
  // Sharing events (bounty + profile) — see lib/utils/share-utils.ts.
  // Funnel per share attempt: {bounty,profile}_shared (share sheet opened)
  // -> exactly one of share_completed/share_cancelled/share_link_copied.
  // deep_link_opened fires app-side when a bountyfinder.app/bounty|profile
  // link (or its custom-scheme equivalent) opens the app, independent of
  // whether that open originated from a share.
  | 'bounty_shared'
  | 'profile_shared'
  | 'share_completed'
  | 'share_cancelled'
  | 'share_link_copied'
  | 'deep_link_opened'
  // Dispute events
  | 'dispute_opened'
  | 'dispute_resolved'
  // Search events
  | 'search_performed'
  | 'filter_applied';

export interface AnalyticsProperties {
  [key: string]: string | number | boolean | string[] | undefined;
}

// Historically this expanded every property key into both its snake_case and
// camelCase form (so a call site passing `stepTitle` would also emit
// `step_title` AND `steptitle` — the latter from lowercasing an
// already-camelCase key with no underscores to convert, which is not a real
// spelling anyone intended). That silently multiplied every event's property
// count and fragmented PostHog breakdowns across spurious spellings of the
// same field (see the `post_step_viewed` property audit). Call sites now emit
// exactly the property keys they mean; this stays as an identity pass so any
// future normalization need has one obvious place to live.
const normalizePropertyKeys = (properties?: AnalyticsProperties): AnalyticsProperties =>
  properties ? { ...properties } : {};

// HeyCatch's event-property type is Record<string, string | number | boolean | null> —
// narrower than AnalyticsProperties (which also allows string[] and undefined).
// Arrays are joined so the value still reaches the dashboard instead of being dropped.
// Takes Record<string, unknown> rather than AnalyticsProperties because callers
// (e.g. trackEvent's enrichedProperties) legitimately widen fields like `userId`
// to `string | null`, which AnalyticsProperties' index signature doesn't allow.
const toHeyCatchProperties = (
  properties: Record<string, unknown>
): Record<string, string | number | boolean | null> => {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      result[key] = value.join(',');
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[key] = value;
    } else {
      result[key] = String(value);
    }
  }
  return result;
};

class AnalyticsService {
  private initialized = false;
  private userId: string | null = null;

  /**
   * Initialize analytics services. The shared PostHog client in `lib/posthog.ts`
   * is constructed eagerly at import time, so initialization here is mostly a
   * readiness check kept for API compatibility with existing callers.
   *
   * @param _legacyToken - Ignored. Retained so existing callers that pass a
   *   Mixpanel-style token continue to compile. Passing the literal
   *   placeholder `'YOUR_MIXPANEL_TOKEN'` still skips initialization.
   */
  async initialize(_legacyToken?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      if (_legacyToken !== 'YOUR_MIXPANEL_TOKEN' && !isPostHogReady()) {
        // eslint-disable-next-line no-console
        console.warn(
          '[Analytics] PostHog client not ready — events will be dropped until configured'
        );
      }

      this.initialized = true;
    } catch (error) {
      console.error('[Analytics] Failed to initialize:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Identify a user for analytics
   * @param userId - Unique user identifier
   * @param properties - Additional user properties
   */
  async identifyUser(userId: string, properties?: AnalyticsProperties): Promise<void> {
    this.userId = userId;

    try {
      // Identify in PostHog via the shared client.
      try {
        posthogIdentify(userId, properties);
      } catch {
        // ignore — PostHog may not be ready
      }

      try {
        heycatch.setIdentity(userId, properties);
      } catch {
        // ignore — HeyCatch may not be ready
      }

      // Set user in Sentry
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser({ id: userId, ...properties });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to identify user:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track an analytics event
   * @param event - Event name
   * @param properties - Event properties
   */
  async trackEvent(event: AnalyticsEvent, properties?: AnalyticsProperties): Promise<void> {
    try {
      const normalizedProperties = normalizePropertyKeys(properties);
      const enrichedProperties = {
        ...normalizedProperties,
        platform: Platform.OS,
        timestamp: new Date().toISOString(),
        userId: this.userId,
        user_id: this.userId,
      };

      // Track in PostHog via the shared client. The helper is a no-op when
      // the client hasn't initialized yet (e.g. missing key in Expo Go).
      try {
        posthogCapture(event, enrichedProperties);
      } catch {
        // ignore — never let analytics failures bubble up to the caller
      }

      try {
        heycatch.trackEvent(event, toHeyCatchProperties(enrichedProperties));
      } catch {
        // ignore — HeyCatch may not be ready
      }

      // Add breadcrumb to Sentry for context (if available)
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.addBreadcrumb({
          category: 'analytics',
          message: event,
          level: 'info',
          data: enrichedProperties,
        });
      } catch {
        // ignore when Sentry is not installed in this runtime
      }
    } catch (error) {
      console.error('[Analytics] Failed to track event:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Update user properties
   * @param properties - User properties to update
   */
  async updateUserProperties(properties: AnalyticsProperties): Promise<void> {
    try {
      try {
        posthogSetPersonProperties(properties);
      } catch {
        // ignore — PostHog may not be ready
      }

      try {
        heycatch.setPersonProperties(properties);
      } catch {
        // ignore — HeyCatch may not be ready
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser({ id: this.userId || undefined, ...properties });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to update user properties:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Increment a user property.
   *
   * PostHog does not support atomic client-side increments of person
   * properties (that is a server-side operation). To preserve the analytics
   * signal we capture a dedicated event carrying the property name and delta,
   * which can be aggregated in PostHog insights.
   *
   * @param property - Property name
   * @param value - Value to increment by (default: 1)
   */
  async incrementUserProperty(property: string, value: number = 1): Promise<void> {
    try {
      posthogCapture('user_property_incremented', {
        property,
        increment: value,
        userId: this.userId,
      });
    } catch (error) {
      console.error('[Analytics] Failed to increment user property:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track screen view
   * @param screenName - Name of the screen
   * @param properties - Additional properties
   */
  async trackScreenView(screenName: string, properties?: AnalyticsProperties): Promise<void> {
    try {
      const screenProperties = {
        screen_name: screenName,
        ...properties,
      };

      try {
        posthogScreen(screenName, screenProperties);
      } catch {
        // ignore
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.addBreadcrumb({
          category: 'navigation',
          message: `Screen: ${screenName}`,
          level: 'info',
          data: screenProperties,
        });
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to track screen view:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Track timing (performance monitoring)
   * @param eventName - Event name
   * @param duration - Duration in milliseconds
   * @param properties - Additional properties
   */
  async trackTiming(
    eventName: string,
    duration: number,
    properties?: AnalyticsProperties
  ): Promise<void> {
    try {
      const normalizedProperties = normalizePropertyKeys(properties);
      const timingProperties = {
        ...normalizedProperties,
        timing_name: eventName,
        timingName: eventName,
        duration_ms: duration,
      };

      try {
        posthogCapture('performance_timing', timingProperties);
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to track timing:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Reset analytics (on logout)
   */
  async reset(): Promise<void> {
    try {
      this.userId = null;

      try {
        posthogReset();
      } catch {
        // ignore
      }

      try {
        heycatch.resetIdentity();
      } catch {
        // ignore — HeyCatch may not be ready
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.setUser(null);
      } catch {
        // ignore
      }
    } catch (error) {
      console.error('[Analytics] Failed to reset analytics:', error);
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
        const Sentry = require('@sentry/react-native');
        Sentry.captureException(error);
      } catch (_e) {
        // ignore
      }
    }
  }

  /**
   * Flush pending events (useful before app exit)
   */
  async flush(): Promise<void> {
    try {
      await posthogFlush();
    } catch (error) {
      console.error('[Analytics] Failed to flush events:', error);
    }
  }

  /**
   * Get the current user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Check if analytics is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();
