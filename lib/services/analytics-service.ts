// lib/services/analytics-service.ts - Analytics tracking service backed by PostHog
//
// PostHog is the single source of truth for product analytics. This service
// provides a typed, app-wide facade over the shared PostHog client defined in
// `lib/posthog.ts`, so non-React surfaces (services, hooks, startup) emit the
// exact same events into the exact same PostHog project as the React
// `usePostHog()` hook and autocapture.
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
  // -> profile_step_viewed -> (profile_submitted | step_skipped)* -> completed
  | 'onboarding_welcome_viewed'
  | 'onboarding_role_selected'
  | 'onboarding_intent_switched'
  | 'onboarding_login_tapped'
  | 'onboarding_auth_started'
  | 'onboarding_auth_completed'
  | 'onboarding_profile_step_viewed'
  | 'onboarding_profile_submitted'
  | 'onboarding_step_skipped'
  | 'onboarding_bounty_posted'
  | 'onboarding_bounty_accepted'
  | 'onboarding_completed'
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
  // Moments Queue — post-onboarding contextual activation prompts, see lib/moments/*
  // Funnel order for one moment instance: moment_event_enqueued (the real
  // business event that made it eligible) -> moment_queued (became the
  // single next-in-line moment) -> moment_shown (presented) -> exactly one
  // of moment_accepted/moment_dismissed/moment_snoozed/moment_skipped ->
  // (accepted only) moment_completed, or moment_expired if it was shown
  // maxShownCount times without ever being resolved.
  | 'moment_event_enqueued'
  | 'moment_queued'
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
  // Bounty events
  | 'bounty_created'
  | 'bounty_queued'
  | 'bounty_viewed'
  | 'bounty_accepted'
  | 'bounty_claimed'
  | 'bounty_completed'
  | 'bounty_cancelled'
  // Payment events
  | 'payment_initiated'
  | 'payment_completed'
  | 'payment_failed'
  | 'payment_error'
  | 'payment_security_warning'
  | 'payment_sca_required'
  | 'payment_method_removed'
  | 'payment_method_saved'
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
  // Dispute events
  | 'dispute_opened'
  | 'dispute_resolved'
  // Search events
  | 'search_performed'
  | 'filter_applied';

export interface AnalyticsProperties {
  [key: string]: string | number | boolean | undefined;
}

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
      const enrichedProperties = {
        ...properties,
        platform: Platform.OS,
        timestamp: new Date().toISOString(),
        userId: this.userId,
      };

      // Track in PostHog via the shared client. The helper is a no-op when
      // the client hasn't initialized yet (e.g. missing key in Expo Go).
      try {
        posthogCapture(event, enrichedProperties);
      } catch {
        // ignore — never let analytics failures bubble up to the caller
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
      const timingProperties = {
        ...properties,
        duration_ms: duration,
      };

      try {
        posthogCapture(eventName, timingProperties);
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
