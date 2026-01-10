// services/api/src/monitoring/business-metrics.ts
// Business metrics tracking for operational insights

import { metrics, METRICS } from './metrics';
import { logger } from '../services/logger';
import { recordBusinessMetric } from './opentelemetry';

/**
 * Business Metrics Service
 * 
 * Tracks key business metrics for monitoring and alerting:
 * - Bounties created per hour
 * - Payment success rate
 * - User sign-ups
 * - Active users
 * - Completion rates
 */
class BusinessMetricsService {
  private readonly METRICS_NAMESPACE = 'business';

  /**
   * Track bounty creation
   */
  trackBountyCreated(bountyId: string, userId: string, amountCents?: number): void {
    try {
      metrics.incrementCounter(METRICS.BOUNTIES_CREATED, 1, {
        hasAmount: amountCents ? 'true' : 'false',
      });

      // Record in OpenTelemetry
      recordBusinessMetric('bounty.created', 1, {
        bountyId,
        userId,
        amountCents: amountCents || 0,
      });

      logger.debug({ bountyId, userId, amountCents }, '[business-metrics] Bounty created');
    } catch (error) {
      logger.error({ error, bountyId }, '[business-metrics] Failed to track bounty creation');
    }
  }

  /**
   * Track bounty acceptance
   */
  trackBountyAccepted(bountyId: string, hunterId: string, posterId: string): void {
    try {
      metrics.incrementCounter(METRICS.BOUNTIES_ACCEPTED, 1);

      recordBusinessMetric('bounty.accepted', 1, {
        bountyId,
        hunterId,
        posterId,
      });

      logger.debug({ bountyId, hunterId }, '[business-metrics] Bounty accepted');
    } catch (error) {
      logger.error({ error, bountyId }, '[business-metrics] Failed to track bounty acceptance');
    }
  }

  /**
   * Track bounty completion
   */
  trackBountyCompleted(bountyId: string, hunterId: string, posterId: string, amountCents?: number): void {
    try {
      metrics.incrementCounter(METRICS.BOUNTIES_COMPLETED, 1);

      recordBusinessMetric('bounty.completed', 1, {
        bountyId,
        hunterId,
        posterId,
        amountCents: amountCents || 0,
      });

      logger.debug({ bountyId, hunterId, amountCents }, '[business-metrics] Bounty completed');
    } catch (error) {
      logger.error({ error, bountyId }, '[business-metrics] Failed to track bounty completion');
    }
  }

  /**
   * Track bounty cancellation
   */
  trackBountyCancelled(bountyId: string, userId: string, reason?: string): void {
    try {
      metrics.incrementCounter(METRICS.BOUNTIES_CANCELLED, 1, {
        reason: reason || 'unspecified',
      });

      recordBusinessMetric('bounty.cancelled', 1, {
        bountyId,
        userId,
        reason: reason || 'unspecified',
      });

      logger.debug({ bountyId, userId, reason }, '[business-metrics] Bounty cancelled');
    } catch (error) {
      logger.error({ error, bountyId }, '[business-metrics] Failed to track bounty cancellation');
    }
  }

  /**
   * Track payment transaction
   */
  trackPayment(
    success: boolean, 
    amountCents: number, 
    paymentType: string,
    userId?: string,
    bountyId?: string
  ): void {
    try {
      metrics.incrementCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL, 1, { type: paymentType });

      if (success) {
        metrics.incrementCounter(METRICS.PAYMENT_SUCCESS_TOTAL, 1, { type: paymentType });
        metrics.incrementCounter(METRICS.PAYMENT_AMOUNT_CENTS, amountCents, { type: paymentType });
      } else {
        metrics.incrementCounter(METRICS.PAYMENT_FAILURES_TOTAL, 1, { type: paymentType });
      }

      recordBusinessMetric(
        success ? 'payment.success' : 'payment.failure', 
        amountCents,
        {
          paymentType,
          userId: userId || 'unknown',
          bountyId: bountyId || 'none',
        }
      );

      logger.debug({ 
        success, 
        amountCents, 
        paymentType, 
        userId, 
        bountyId 
      }, '[business-metrics] Payment tracked');
    } catch (error) {
      logger.error({ error, paymentType }, '[business-metrics] Failed to track payment');
    }
  }

  /**
   * Track user signup
   */
  trackUserSignup(userId: string, method: 'email' | 'social' = 'email'): void {
    try {
      const metricName = 'user_signups_total';
      metrics.incrementCounter(metricName, 1, { method });

      recordBusinessMetric('user.signup', 1, {
        userId,
        method,
      });

      logger.debug({ userId, method }, '[business-metrics] User signup tracked');
    } catch (error) {
      logger.error({ error, userId }, '[business-metrics] Failed to track user signup');
    }
  }

  /**
   * Track active user session
   */
  trackActiveUser(userId: string): void {
    try {
      const metricName = 'active_users_gauge';
      
      // Use a gauge to track currently active users
      // In production, this would be tracked with a time-windowed approach
      metrics.setGauge(metricName, 1);

      recordBusinessMetric('user.active', 1, { userId });

      logger.debug({ userId }, '[business-metrics] Active user tracked');
    } catch (error) {
      logger.error({ error, userId }, '[business-metrics] Failed to track active user');
    }
  }

  /**
   * Get business metrics summary
   */
  getSummary(): {
    bounties: {
      created: number;
      accepted: number;
      completed: number;
      cancelled: number;
      completionRate: number;
    };
    payments: {
      total: number;
      successful: number;
      failed: number;
      successRate: number;
      totalAmountCents: number;
    };
    users: {
      signups: number;
      active: number;
    };
  } {
    const bountiesCreated = metrics.getCounter(METRICS.BOUNTIES_CREATED);
    const bountiesAccepted = metrics.getCounter(METRICS.BOUNTIES_ACCEPTED);
    const bountiesCompleted = metrics.getCounter(METRICS.BOUNTIES_COMPLETED);
    const bountiesCancelled = metrics.getCounter(METRICS.BOUNTIES_CANCELLED);

    const paymentsTotal = metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL);
    const paymentsSuccessful = metrics.getCounter(METRICS.PAYMENT_SUCCESS_TOTAL);
    const paymentsFailed = metrics.getCounter(METRICS.PAYMENT_FAILURES_TOTAL);
    const paymentAmount = metrics.getCounter(METRICS.PAYMENT_AMOUNT_CENTS);

    const completionRate = bountiesCreated > 0 
      ? (bountiesCompleted / bountiesCreated) * 100 
      : 0;

    const successRate = paymentsTotal > 0 
      ? (paymentsSuccessful / paymentsTotal) * 100 
      : 0;

    return {
      bounties: {
        created: bountiesCreated,
        accepted: bountiesAccepted,
        completed: bountiesCompleted,
        cancelled: bountiesCancelled,
        completionRate: Math.round(completionRate * 100) / 100,
      },
      payments: {
        total: paymentsTotal,
        successful: paymentsSuccessful,
        failed: paymentsFailed,
        successRate: Math.round(successRate * 100) / 100,
        totalAmountCents: paymentAmount,
      },
      users: {
        signups: metrics.getCounter('user_signups_total'),
        active: metrics.getGauge('active_users_gauge'),
      },
    };
  }

  /**
   * Get hourly metrics (for rate calculations)
   */
  getHourlyRates(): {
    bountiesPerHour: number;
    paymentsPerHour: number;
    signupsPerHour: number;
  } {
    // In production, this would track metrics over a time window
    // For now, return cumulative counts
    // TODO: Implement time-windowed metrics
    
    return {
      bountiesPerHour: metrics.getCounter(METRICS.BOUNTIES_CREATED),
      paymentsPerHour: metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL),
      signupsPerHour: metrics.getCounter('user_signups_total'),
    };
  }
}

// Export singleton instance
export const businessMetrics = new BusinessMetricsService();

logger.info('[business-metrics] Business metrics service initialized');
