// lib/services/analytics-service.ts - Analytics tracking service with Mixpanel
// Lazily require native modules to avoid top-level native imports that break
// when running inside Expo Go (which may not include those native modules).
import { Platform } from 'react-native';

// When running inside Expo Go some native packages (Mixpanel/Sentry) may not be
// present. Use a loose alias for Mixpanel to avoid TypeScript errors when the
// package isn't available at compile/runtime in lightweight dev environments.
type Mixpanel = any;

// Track key user events according to requirements
export type AnalyticsEvent = 
  // Auth events
  | 'user_signed_up'
  | 'user_logged_in'
  | 'user_logged_out'
  | 'email_verified'
  // Bounty events
  | 'bounty_created'
  | 'bounty_viewed'
  | 'bounty_accepted'
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
  // SetupIntent events
  | 'setup_intent_created'
  | 'setup_intent_confirmed'
  | 'setup_intent_failed'
  // Messaging events
  | 'message_sent'
  | 'conversation_started'
  | 'conversation_viewed'
  // Profile events
  | 'profile_viewed'
  | 'profile_updated'
  // Search events
  | 'search_performed'
  | 'filter_applied';

export interface AnalyticsProperties {
  [key: string]: string | number | boolean | undefined;
}

class AnalyticsService {
  private mixpanel: Mixpanel | null = null;
  private initialized = false;
  private userId: string | null = null;

  /**
   * Initialize analytics services
   * @param mixpanelToken - Mixpanel project token
   * @param sentryDsn - Sentry DSN (optional, handled by Sentry.init)
   */
  async initialize(mixpanelToken: string): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Initialize Mixpanel lazily to avoid requiring native module at import time
      if (mixpanelToken && mixpanelToken !== 'YOUR_MIXPANEL_TOKEN') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
          const { Mixpanel } = require('mixpanel-react-native');
          const trackAutomaticEvents = Platform.OS === 'web' ? false : true;
          this.mixpanel = await Mixpanel.init(mixpanelToken, trackAutomaticEvents);
        } catch (e: any) {
            // If mixpanel native package isn't installed or available in this runtime
            // (e.g., Expo Go), just warn and continue — analytics remains optional.
            // eslint-disable-next-line no-console
            console.warn('[Analytics] mixpanel-react-native not available:', e?.message || e);
            this.mixpanel = null;
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
      // Set user in Mixpanel
      if (this.mixpanel) {
        await this.mixpanel.identify(userId);
        if (properties) {
          await this.mixpanel.getPeople().set(properties);
        }
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

      // Track in Mixpanel
      if (this.mixpanel) {
        await this.mixpanel.track(event, enrichedProperties);
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
      if (this.mixpanel) {
        await this.mixpanel.getPeople().set(properties);
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
      if (this.mixpanel) {
        await this.mixpanel.getPeople().increment(property, value);
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

      if (this.mixpanel) {
        await this.mixpanel.track('screen_view', screenProperties);
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

      if (this.mixpanel) {
        await this.mixpanel.track(eventName, timingProperties);
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

      if (this.mixpanel) {
        await this.mixpanel.reset();
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
      if (this.mixpanel) {
        await this.mixpanel.flush();
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
