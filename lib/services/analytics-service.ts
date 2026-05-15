// lib/services/analytics-service.ts - Analytics tracking service with Mixpanel
// Lazily require native modules to avoid top-level native imports that break
// when running inside Expo Go (which may not include those native modules).
import { Platform } from 'react-native';
import getMixpanel, {
  identify as mixpanelIdentify,
  initMixpanel,
  track as mixpanelTrack,
} from '../mixpanel';

// Track key user events according to requirements
export type AnalyticsEvent =
  // App lifecycle / acquisition funnel
  | 'app_opened'
  // Auth events
  | 'user_signed_up'
  | 'user_logged_in'
  | 'user_logged_out'
  | 'email_verified'
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
   * Initialize analytics services. This delegates to the shared Mixpanel
   * singleton in `lib/mixpanel.ts` so every analytics surface (this service
   * + direct `track()` callers) shares a single SDK instance.
   *
   * @param mixpanelToken - Optional Mixpanel project token. Currently
   *   unused: the underlying native SDK reads its token from env
   *   (`EXPO_PUBLIC_MIXPANEL_TOKEN`). The parameter is kept for API
   *   compatibility with existing callers. Passing the literal
   *   placeholder `'YOUR_MIXPANEL_TOKEN'` skips initialization entirely.
   */
  async initialize(mixpanelToken?: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const isPlaceholderToken = mixpanelToken === 'YOUR_MIXPANEL_TOKEN';
      if (!isPlaceholderToken) {
        try {
          await initMixpanel();
        } catch (e: any) {
          // If mixpanel native package isn't installed or available in this runtime
          // (e.g., Expo Go), just warn and continue — analytics remains optional.
          // eslint-disable-next-line no-console
          console.warn('[Analytics] mixpanel-react-native not available:', e?.message || e);
        }
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
      // Identify in Mixpanel via the shared singleton.
      try {
        mixpanelIdentify(userId, properties);
      } catch {
        // ignore — mixpanel may not be ready
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

      // Track in Mixpanel via the shared singleton. The helper is a no-op when
      // the native SDK hasn't initialized yet (e.g. in Expo Go).
      try {
        mixpanelTrack(event, enrichedProperties);
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
        const mp = getMixpanel();
        if (mp) {
          const people = typeof mp.getPeople === 'function' ? mp.getPeople() : mp.people;
          if (people && typeof people.set === 'function') {
            await people.set(properties);
          }
        }
      } catch {
        // ignore — mixpanel may not be ready
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
   * Increment a user property
   * @param property - Property name
   * @param value - Value to increment by (default: 1)
   */
  async incrementUserProperty(property: string, value: number = 1): Promise<void> {
    try {
      const mp = getMixpanel();
      if (mp) {
        const people = typeof mp.getPeople === 'function' ? mp.getPeople() : mp.people;
        if (people && typeof people.increment === 'function') {
          await people.increment(property, value);
        }
      }
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
        mixpanelTrack('screen_view', screenProperties);
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
  async trackTiming(eventName: string, duration: number, properties?: AnalyticsProperties): Promise<void> {
    try {
      const timingProperties = {
        ...properties,
        duration_ms: duration,
      };

      try {
        mixpanelTrack(eventName, timingProperties);
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
        const mp = getMixpanel();
        if (mp && typeof mp.reset === 'function') {
          await mp.reset();
        }
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
      const mp = getMixpanel();
      if (mp && typeof mp.flush === 'function') {
        await mp.flush();
      }
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
