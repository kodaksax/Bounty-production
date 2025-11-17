// lib/services/performance-service.ts - Performance monitoring with Expo and Sentry
import * as Sentry from '@sentry/react-native';
import { analyticsService } from './analytics-service';

export type PerformanceMetric = 
  | 'api_call'
  | 'screen_load'
  | 'image_load'
  | 'bounty_create'
  | 'payment_process'
  | 'message_send';

type SentryTransaction = {
  setData?: (key: string, value: unknown) => void;
  finish?: () => void;
};

interface PerformanceTimer {
  name: string;
  startTime: number;
  transaction?: SentryTransaction;
}

class PerformanceService {
  private timers: Map<string, PerformanceTimer> = new Map();

  /**
   * Start a performance measurement
   * @param name - Unique identifier for this measurement
   * @param metric - Type of metric being measured
   * @param metadata - Additional metadata
   */
  startMeasurement(name: string, metric: PerformanceMetric, metadata?: Record<string, any>): void {
    try {
      const startTime = Date.now();

      // Start Sentry transaction for distributed tracing
      const sentryStartTransaction = (Sentry as { startTransaction?: (context: {
        name: string;
        op?: string;
        data?: Record<string, unknown>;
      }) => SentryTransaction | undefined }).startTransaction;

      const transaction = sentryStartTransaction?.({
        name: `${metric}:${name}`,
        op: metric,
        data: metadata,
      });

      this.timers.set(name, {
        name,
        startTime,
        transaction,
      });

      console.log(`[Performance] Started measurement: ${name}`);
    } catch (error) {
      console.error('[Performance] Failed to start measurement:', error);
      Sentry.captureException(error);
    }
  }

  /**
   * End a performance measurement
   * @param name - Unique identifier for the measurement
   * @param metadata - Additional metadata to include
   */
  async endMeasurement(name: string, metadata?: Record<string, any>): Promise<number | null> {
    try {
      const timer = this.timers.get(name);
      if (!timer) {
        console.warn(`[Performance] No measurement found for: ${name}`);
        return null;
      }

      const duration = Date.now() - timer.startTime;

      // Finish Sentry transaction
      if (timer.transaction) {
        timer.transaction.setData?.('duration_ms', duration);
        if (metadata) {
          Object.entries(metadata).forEach(([key, value]) => {
            timer.transaction?.setData?.(key, value);
          });
        }
        timer.transaction.finish?.();
      }

      // Track timing in analytics
      await analyticsService.trackTiming(timer.name, duration, metadata);

      // Log slow operations (> 1 second)
      if (duration > 1000) {
        console.warn(`[Performance] Slow operation detected: ${name} took ${duration}ms`);
        Sentry.captureMessage(`Slow operation: ${name}`, {
          level: 'warning',
          extra: {
            duration_ms: duration,
            ...metadata,
          },
        });
      }

      this.timers.delete(name);
      console.log(`[Performance] Ended measurement: ${name} (${duration}ms)`);

      return duration;
    } catch (error) {
      console.error('[Performance] Failed to end measurement:', error);
      Sentry.captureException(error);
      return null;
    }
  }

  /**
   * Measure the duration of an async function
   * @param name - Unique identifier for this measurement
   * @param metric - Type of metric
   * @param fn - Function to measure
   * @param metadata - Additional metadata
   */
  async measureAsync<T>(
    name: string,
    metric: PerformanceMetric,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    this.startMeasurement(name, metric, metadata);
    try {
      const result = await fn();
      await this.endMeasurement(name, { success: true, ...metadata });
      return result;
    } catch (error) {
      await this.endMeasurement(name, { success: false, error: String(error), ...metadata });
      throw error;
    }
  }

  /**
   * Record API call performance
   * @param endpoint - API endpoint
   * @param method - HTTP method
   * @param statusCode - Response status code
   * @param duration - Duration in milliseconds
   */
  async recordApiCall(
    endpoint: string,
    method: string,
    statusCode: number,
    duration: number
  ): Promise<void> {
    try {
      const properties = {
        endpoint,
        method,
        status_code: statusCode,
        duration_ms: duration,
        success: statusCode >= 200 && statusCode < 300,
      };

      await analyticsService.trackEvent('api_call' as any, properties);

      // Log slow API calls
      if (duration > 3000) {
        console.warn(`[Performance] Slow API call: ${method} ${endpoint} took ${duration}ms`);
        Sentry.captureMessage(`Slow API call: ${method} ${endpoint}`, {
          level: 'warning',
          extra: properties,
        });
      }
    } catch (error) {
      console.error('[Performance] Failed to record API call:', error);
    }
  }

  /**
   * Record screen load time
   * @param screenName - Name of the screen
   * @param duration - Duration in milliseconds
   */
  async recordScreenLoad(screenName: string, duration: number): Promise<void> {
    try {
      await analyticsService.trackTiming('screen_load', duration, {
        screen_name: screenName,
      });

      console.log(`[Performance] Screen load: ${screenName} (${duration}ms)`);
    } catch (error) {
      console.error('[Performance] Failed to record screen load:', error);
    }
  }

  /**
   * Record a custom metric
   * @param name - Metric name
   * @param value - Metric value
   * @param unit - Unit of measurement
   * @param metadata - Additional metadata
   */
  async recordMetric(
    name: string,
    value: number,
    unit: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    try {
      const properties = {
        value,
        unit,
        ...metadata,
      };

      await analyticsService.trackEvent(name as any, properties);

      console.log(`[Performance] Metric recorded: ${name} = ${value}${unit}`);
    } catch (error) {
      console.error('[Performance] Failed to record metric:', error);
    }
  }

  /**
   * Clear all active timers (useful for cleanup)
   */
  clearAllTimers(): void {
    this.timers.forEach((timer) => {
      if (timer.transaction) {
        timer.transaction.finish?.();
      }
    });
    this.timers.clear();
    console.log('[Performance] All timers cleared');
  }
}

// Export singleton instance
export const performanceService = new PerformanceService();
