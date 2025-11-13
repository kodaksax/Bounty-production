// services/api/src/services/analytics.ts - Backend analytics service
import Mixpanel from 'mixpanel';
import * as Sentry from '@sentry/node';
import { logger, analyticsLogger } from './logger';

const MIXPANEL_TOKEN = process.env.MIXPANEL_TOKEN;
const SENTRY_DSN = process.env.SENTRY_DSN;

class BackendAnalyticsService {
  private mixpanel: any = null;
  private initialized = false;

  /**
   * Initialize analytics services
   */
  initialize(): void {
    if (this.initialized) {
      logger.info('[Analytics] Already initialized');
      return;
    }

    try {
      // Initialize Mixpanel
      if (MIXPANEL_TOKEN && MIXPANEL_TOKEN !== 'YOUR_MIXPANEL_TOKEN') {
        this.mixpanel = Mixpanel.init(MIXPANEL_TOKEN);
        analyticsLogger.info('[Analytics] Mixpanel initialized');
      } else {
        analyticsLogger.warn('[Analytics] Mixpanel token not configured');
      }

      // Initialize Sentry
      if (SENTRY_DSN && SENTRY_DSN !== 'YOUR_SENTRY_DSN') {
        Sentry.init({
          dsn: SENTRY_DSN,
          environment: process.env.NODE_ENV || 'development',
          tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
          beforeSend(event) {
            // Don't send in development unless explicitly enabled
            if (process.env.NODE_ENV === 'development' && !process.env.SENTRY_DEBUG) {
              return null;
            }
            return event;
          },
        });
        analyticsLogger.info('[Analytics] Sentry initialized');
      } else {
        analyticsLogger.warn('[Analytics] Sentry DSN not configured');
      }

      this.initialized = true;
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to initialize');
    }
  }

  /**
   * Track an event
   */
  trackEvent(userId: string, event: string, properties?: Record<string, any>): void {
    try {
      const enrichedProperties = {
        ...properties,
        timestamp: new Date().toISOString(),
        source: 'backend',
      };

      if (this.mixpanel) {
        this.mixpanel.track(event, {
          distinct_id: userId,
          ...enrichedProperties,
        });
      }

      // Add breadcrumb to Sentry
      Sentry.addBreadcrumb({
        category: 'analytics',
        message: event,
        level: 'info',
        data: enrichedProperties,
      });

      analyticsLogger.debug({ userId, event, properties: enrichedProperties }, 'Event tracked');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to track event');
    }
  }

  /**
   * Set user properties
   */
  setUserProperties(userId: string, properties: Record<string, any>): void {
    try {
      if (this.mixpanel) {
        this.mixpanel.people.set(userId, properties);
      }

      Sentry.setUser({ id: userId, ...properties });

      analyticsLogger.debug({ userId, properties }, 'User properties set');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to set user properties');
    }
  }

  /**
   * Increment a user property
   */
  incrementUserProperty(userId: string, property: string, value: number = 1): void {
    try {
      if (this.mixpanel) {
        this.mixpanel.people.increment(userId, property, value);
      }

      analyticsLogger.debug({ userId, property, value }, 'User property incremented');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to increment user property');
    }
  }

  /**
   * Track a revenue event (for payment tracking)
   */
  trackRevenue(userId: string, amount: number, properties?: Record<string, any>): void {
    try {
      if (this.mixpanel) {
        this.mixpanel.people.track_charge(userId, amount, properties);
      }

      this.trackEvent(userId, 'revenue', {
        amount,
        ...properties,
      });

      analyticsLogger.info({ userId, amount, properties }, 'Revenue tracked');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to track revenue');
    }
  }

  /**
   * Track an error
   */
  trackError(error: Error, context?: Record<string, any>): void {
    try {
      Sentry.captureException(error, {
        extra: context,
      });

      analyticsLogger.error({ err: error, context }, 'Error tracked');
    } catch (err) {
      analyticsLogger.error({ error: err }, '[Analytics] Failed to track error');
    }
  }

  /**
   * Set context for error tracking
   */
  setContext(key: string, context: Record<string, any>): void {
    try {
      Sentry.setContext(key, context);
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to set context');
    }
  }

  /**
   * Track performance
   */
  trackPerformance(name: string, duration: number, metadata?: Record<string, any>): void {
    try {
      this.trackEvent('system', 'performance_metric', {
        metric_name: name,
        duration_ms: duration,
        ...metadata,
      });

      analyticsLogger.debug({ name, duration, metadata }, 'Performance tracked');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to track performance');
    }
  }

  /**
   * Flush pending events (call before shutdown)
   */
  async flush(): Promise<void> {
    try {
      if (this.mixpanel) {
        // Mixpanel doesn't have an async flush, but we can wrap it
        await new Promise<void>((resolve) => {
          // Mixpanel auto-flushes, just give it a moment
          setTimeout(resolve, 100);
        });
      }

      await Sentry.close(2000);

      analyticsLogger.info('[Analytics] Events flushed');
    } catch (error) {
      analyticsLogger.error({ error }, '[Analytics] Failed to flush events');
    }
  }
}

// Export singleton instance
export const backendAnalytics = new BackendAnalyticsService();
