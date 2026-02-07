// services/api/src/monitoring/alerts.ts
// Alerting system for critical conditions

import { logger } from '../services/logger';
import { metrics, METRICS } from './metrics';

interface AlertRule {
  name: string;
  condition: () => boolean;
  threshold: number;
  currentValue: () => number;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  cooldownMs: number;
}

interface AlertInstance {
  rule: string;
  severity: string;
  message: string;
  value: number;
  threshold: number;
  timestamp: number;
  resolved: boolean;
}

class AlertingService {
  private rules: Map<string, AlertRule> = new Map();
  private activeAlerts: Map<string, AlertInstance> = new Map();
  private lastAlertTime: Map<string, number> = new Map();
  private alertHistory: AlertInstance[] = [];
  private maxHistorySize = 1000;

  constructor() {
    this.setupDefaultRules();
  }

  /**
   * Setup default alerting rules based on production requirements
   */
  private setupDefaultRules(): void {
    // High error rate alert - triggers when error rate > 1%
    this.addRule({
      name: 'high_error_rate',
      condition: () => {
        const totalRequests = metrics.getCounter(METRICS.HTTP_REQUESTS_TOTAL);
        const totalErrors = metrics.getCounter(METRICS.HTTP_ERRORS_TOTAL);
        if (totalRequests < 100) return false; // Not enough data
        return (totalErrors / totalRequests) > 0.01; // > 1% error rate
      },
      threshold: 0.01,
      currentValue: () => {
        const totalRequests = metrics.getCounter(METRICS.HTTP_REQUESTS_TOTAL);
        const totalErrors = metrics.getCounter(METRICS.HTTP_ERRORS_TOTAL);
        return totalRequests > 0 ? totalErrors / totalRequests : 0;
      },
      severity: 'critical',
      message: 'Error rate exceeded 1%',
      cooldownMs: 300000 // 5 minutes
    });

    // Slow API response time alert - triggers when p95 > 1000ms (1s)
    this.addRule({
      name: 'slow_api_response_time',
      condition: () => {
        const histogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
        if (!histogram || histogram.count < 100) return false;

        // Calculate p95
        const p95 = this.calculateP95(histogram);
        return p95 > 1000; // > 1000ms (1s) p95
      },
      threshold: 1000,
      currentValue: () => {
        const histogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
        return histogram ? this.calculateP95(histogram) : 0;
      },
      severity: 'critical',
      message: 'API response time p95 exceeded 1 second',
      cooldownMs: 300000 // 5 minutes
    });

    // Slow database query alert - triggers when p95 > 5000ms (5s)
    this.addRule({
      name: 'slow_database_query',
      condition: () => {
        const histogram = metrics.getHistogram(METRICS.DB_QUERY_DURATION_MS);
        if (!histogram || histogram.count < 50) return false;

        // Calculate p95
        const p95 = this.calculateP95(histogram);
        return p95 > 5000; // > 5000ms (5s) p95
      },
      threshold: 5000,
      currentValue: () => {
        const histogram = metrics.getHistogram(METRICS.DB_QUERY_DURATION_MS);
        return histogram ? this.calculateP95(histogram) : 0;
      },
      severity: 'critical',
      message: 'Database query p95 exceeded 5 seconds',
      cooldownMs: 600000 // 10 minutes
    });

    // Database connection failures
    this.addRule({
      name: 'db_connection_failures',
      condition: () => {
        const dbErrors = metrics.getCounter(METRICS.DB_ERRORS_TOTAL);
        return dbErrors > 10;
      },
      threshold: 10,
      currentValue: () => metrics.getCounter(METRICS.DB_ERRORS_TOTAL),
      severity: 'critical',
      message: 'Database connection failures detected',
      cooldownMs: 600000 // 10 minutes
    });

    // Payment failure rate alert - triggers when failure rate > 5%
    this.addRule({
      name: 'payment_failure_rate',
      condition: () => {
        const total = metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL);
        const failures = metrics.getCounter(METRICS.PAYMENT_FAILURES_TOTAL);
        if (total < 10) return false;
        return (failures / total) > 0.05; // > 5% failure rate
      },
      threshold: 0.05,
      currentValue: () => {
        const total = metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL);
        const failures = metrics.getCounter(METRICS.PAYMENT_FAILURES_TOTAL);
        return total > 0 ? failures / total : 0;
      },
      severity: 'critical',
      message: 'Payment failure rate exceeded 5%',
      cooldownMs: 300000 // 5 minutes
    });

    // WebSocket connection surge
    this.addRule({
      name: 'websocket_surge',
      condition: () => {
        const active = metrics.getGauge(METRICS.WS_CONNECTIONS_ACTIVE);
        return active > 1000; // > 1000 concurrent connections
      },
      threshold: 1000,
      currentValue: () => metrics.getGauge(METRICS.WS_CONNECTIONS_ACTIVE),
      severity: 'warning',
      message: 'WebSocket connections exceeded threshold',
      cooldownMs: 600000 // 10 minutes
    });
  }

  /**
   * Add a custom alert rule
   */
  addRule(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
    logger.info({ name: rule.name, severity: rule.severity }, '[alerts] Added alert rule');
  }

  /**
   * Remove an alert rule
   */
  removeRule(name: string): void {
    this.rules.delete(name);
  }

  /**
   * Check all rules and trigger alerts
   */
  checkAlerts(): void {
    for (const [name, rule] of Array.from(this.rules.entries())) {
      try {
        // Check cooldown period
        const lastAlert = this.lastAlertTime.get(name);
        if (lastAlert && Date.now() - lastAlert < rule.cooldownMs) {
          continue;
        }

        // Evaluate condition
        if (rule.condition()) {
          this.triggerAlert(name, rule);
        } else {
          // Resolve alert if it was active
          this.resolveAlert(name);
        }
      } catch (error) {
        logger.error({ name, error }, '[alerts] Error checking rule');
      }
    }
  }

  /**
   * Trigger an alert
   */
  private triggerAlert(name: string, rule: AlertRule): void {
    const value = rule.currentValue();

    const alert: AlertInstance = {
      rule: name,
      severity: rule.severity,
      message: rule.message,
      value,
      threshold: rule.threshold,
      timestamp: Date.now(),
      resolved: false
    };

    this.activeAlerts.set(name, alert);
    this.lastAlertTime.set(name, Date.now());

    // Add to history
    this.addToHistory(alert);

    // Log alert
    logger.warn({
      rule: name,
      severity: rule.severity,
      message: rule.message,
      value,
      threshold: rule.threshold
    }, '[alerts] Alert triggered');

    // In production, this would send to external alerting service
    // (PagerDuty, Slack, email, etc.)
  }

  /**
   * Resolve an alert
   */
  private resolveAlert(name: string): void {
    const alert = this.activeAlerts.get(name);
    if (alert && !alert.resolved) {
      alert.resolved = true;
      this.activeAlerts.delete(name);

      logger.info({ rule: name }, '[alerts] Alert resolved');
    }
  }

  /**
   * Get all active alerts
   */
  getActiveAlerts(): AlertInstance[] {
    return Array.from(this.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  getAlertHistory(limit: number = 100): AlertInstance[] {
    return this.alertHistory.slice(-limit);
  }

  /**
   * Add alert to history
   */
  private addToHistory(alert: AlertInstance): void {
    this.alertHistory.push(alert);

    // Limit history size
    if (this.alertHistory.length > this.maxHistorySize) {
      this.alertHistory = this.alertHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Reset the alerting service (useful for testing)
   */
  reset(): void {
    this.activeAlerts.clear();
    this.lastAlertTime.clear();
    this.alertHistory = [];
  }

  /**
   * Calculate p95 from histogram
   */
  private calculateP95(histogram: any): number {
    if (!histogram || histogram.count === 0) return 0;

    const targetCount = histogram.count * 0.95;
    for (const bucket of histogram.buckets) {
      if (bucket.count >= targetCount) {
        return bucket.le;
      }
    }


    return histogram.buckets[histogram.buckets.length - 1].le;
  }

  /**
   * Start periodic alert checking
   */
  start(intervalMs: number = 60000): void {
    setInterval(() => {
      this.checkAlerts();
    }, intervalMs);

    logger.info({ intervalMs }, '[alerts] Alert checking started');
  }
}

// Global alerting instance
export const alerting = new AlertingService();

// Auto-start alert checking in production
if (process.env.NODE_ENV === 'production') {
  alerting.start(60000); // Check every minute
}

logger.info('[alerts] Alerting service initialized');
