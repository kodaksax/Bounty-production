// services/api/src/monitoring/metrics.ts
// Prometheus-style metrics for monitoring service health and performance

import { logger } from '../services/logger';

interface MetricValue {
  value: number;
  timestamp: number;
  labels?: Record<string, string>;
}

interface HistogramBucket {
  le: number; // Less than or equal
  count: number;
}

interface Histogram {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
}

class MetricsCollector {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, Histogram> = new Map();
  private labeledMetrics: Map<string, Map<string, MetricValue>> = new Map();

  // Default histogram buckets (in milliseconds for response time)
  private readonly defaultBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  /**
   * Increment a counter metric
   */
  incrementCounter(name: string, value: number = 1, labels?: Record<string, string>): void {
    // Always increment the base counter for aggregation
    const baseCurrent = this.counters.get(name) || 0;
    this.counters.set(name, baseCurrent + value);

    if (labels) {
      const key = this.getLabelKey(name, labels);
      const current = this.counters.get(key) || 0;
      this.counters.set(key, current + value);
    }
  }

  /**
   * Set a gauge metric (current value)
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    // Always set the base gauge
    this.gauges.set(name, value);

    if (labels) {
      const key = this.getLabelKey(name, labels);
      this.gauges.set(key, value);
    }
  }

  /**
   * Observe a value in a histogram (for latency/duration tracking)
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    // Always observe in the base histogram for aggregation
    this.updateHistogram(name, value);

    if (labels) {
      const key = this.getLabelKey(name, labels);
      this.updateHistogram(key, value);
    }
  }

  private updateHistogram(key: string, value: number): void {
    let histogram = this.histograms.get(key);
    if (!histogram) {
      histogram = {
        buckets: this.defaultBuckets.map(le => ({ le, count: 0 })),
        sum: 0,
        count: 0
      };
      this.histograms.set(key, histogram);
    }

    // Update histogram
    histogram.sum += value;
    histogram.count += 1;

    // Update buckets
    for (const bucket of histogram.buckets) {
      if (value <= bucket.le) {
        bucket.count += 1;
      }
    }
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = labels ? this.getLabelKey(name, labels) : name;
    return this.counters.get(key) || 0;
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, labels?: Record<string, string>): number {
    const key = labels ? this.getLabelKey(name, labels) : name;
    return this.gauges.get(key) || 0;
  }

  /**
   * Get histogram data
   */
  getHistogram(name: string, labels?: Record<string, string>): Histogram | undefined {
    const key = labels ? this.getLabelKey(name, labels) : name;
    return this.histograms.get(key);
  }

  /**
   * Calculate percentile from histogram
   */
  calculatePercentile(name: string, percentile: number, labels?: Record<string, string>): number {
    const histogram = this.getHistogram(name, labels);
    if (!histogram || histogram.count === 0) return 0;

    const targetCount = histogram.count * (percentile / 100);
    let cumulativeCount = 0;

    for (const bucket of histogram.buckets) {
      cumulativeCount += bucket.count;
      if (cumulativeCount >= targetCount) {
        return bucket.le;
      }
    }

    return histogram.buckets[histogram.buckets.length - 1].le;
  }

  /**
   * Get all metrics in Prometheus exposition format
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];

    // Counters
    for (const [name, value] of Array.from(this.counters.entries())) {
      const { metricName, labels } = this.parseKey(name);
      const labelStr = labels ? `{${labels}}` : '';
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName}${labelStr} ${value}`);
    }

    // Gauges
    for (const [name, value] of Array.from(this.gauges.entries())) {
      const { metricName, labels } = this.parseKey(name);
      const labelStr = labels ? `{${labels}}` : '';
      lines.push(`# TYPE ${metricName} gauge`);
      lines.push(`${metricName}${labelStr} ${value}`);
    }

    // Histograms
    for (const [name, histogram] of Array.from(this.histograms.entries())) {
      const { metricName, labels } = this.parseKey(name);

      lines.push(`# TYPE ${metricName} histogram`);

      // Buckets
      for (const bucket of histogram.buckets) {
        const bucketLabelStr = labels
          ? `{${labels},le="${bucket.le}"}`
          : `{le="${bucket.le}"}`;
        lines.push(`${metricName}_bucket${bucketLabelStr} ${bucket.count}`);
      }

      // +Inf bucket
      const infLabelStr = labels
        ? `{${labels},le="+Inf"}`
        : `{le="+Inf"}`;
      lines.push(`${metricName}_bucket${infLabelStr} ${histogram.count}`);

      // Sum and count
      const labelStr = labels ? `{${labels}}` : '';
      lines.push(`${metricName}_sum${labelStr} ${histogram.sum}`);
      lines.push(`${metricName}_count${labelStr} ${histogram.count}`);
    }

    return lines.join('\n');
  }

  /**
   * Get all metrics as JSON
   */
  getAllMetrics(): {
    counters: Record<string, number>;
    gauges: Record<string, number>;
    histograms: Record<string, any>;
  } {
    return {
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([name, hist]) => [
          name,
          {
            ...hist,
            p50: this.calculatePercentile(name, 50),
            p95: this.calculatePercentile(name, 95),
            p99: this.calculatePercentile(name, 99),
            avg: hist.count > 0 ? hist.sum / hist.count : 0
          }
        ])
      )
    };
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.labeledMetrics.clear();
  }

  private getLabelKey(name: string, labels: Record<string, string>): string {
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  private parseKey(key: string): { metricName: string; labels?: string } {
    const match = key.match(/^([^{]+)(?:\{(.+)\})?$/);
    if (!match) return { metricName: key };

    return {
      metricName: match[1],
      labels: match[2]
    };
  }
}

// Global metrics instance
export const metrics = new MetricsCollector();

// Metric names (for consistency)
export const METRICS = {
  // HTTP Request metrics
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_REQUEST_DURATION_MS: 'http_request_duration_milliseconds',
  HTTP_ERRORS_TOTAL: 'http_errors_total',

  // Database metrics
  DB_QUERY_DURATION_MS: 'db_query_duration_milliseconds',
  DB_QUERIES_TOTAL: 'db_queries_total',
  DB_ERRORS_TOTAL: 'db_errors_total',
  DB_CONNECTIONS_ACTIVE: 'db_connections_active',

  // WebSocket metrics
  WS_CONNECTIONS_ACTIVE: 'websocket_connections_active',
  WS_MESSAGES_SENT: 'websocket_messages_sent',
  WS_MESSAGES_RECEIVED: 'websocket_messages_received',
  WS_ERRORS_TOTAL: 'websocket_errors_total',

  // Payment metrics
  PAYMENT_TRANSACTIONS_TOTAL: 'payment_transactions_total',
  PAYMENT_SUCCESS_TOTAL: 'payment_success_total',
  PAYMENT_FAILURES_TOTAL: 'payment_failures_total',
  PAYMENT_AMOUNT_CENTS: 'payment_amount_cents_total',

  // Business metrics
  BOUNTIES_CREATED: 'bounties_created_total',
  BOUNTIES_ACCEPTED: 'bounties_accepted_total',
  BOUNTIES_COMPLETED: 'bounties_completed_total',
  BOUNTIES_CANCELLED: 'bounties_cancelled_total',

  // Worker metrics
  WORKER_JOBS_PROCESSED: 'worker_jobs_processed_total',
  WORKER_JOBS_FAILED: 'worker_jobs_failed_total',
  OUTBOX_EVENTS_PROCESSED: 'outbox_events_processed_total',

  // Cache metrics (if Redis is used)
  CACHE_HITS: 'cache_hits_total',
  CACHE_MISSES: 'cache_misses_total',
};

// Helper functions for common metrics

export function recordHttpRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  // Validate inputs
  if (durationMs < 0) {
    logger.warn({ durationMs }, '[metrics] Negative duration recorded, setting to 0');
    durationMs = 0;
  }

  if (statusCode < 100 || statusCode > 599) {
    logger.warn({ statusCode }, '[metrics] Invalid status code recorded');
    return;
  }

  metrics.incrementCounter(METRICS.HTTP_REQUESTS_TOTAL, 1, {
    method,
    path,
    status: String(statusCode)
  });

  metrics.observeHistogram(METRICS.HTTP_REQUEST_DURATION_MS, durationMs, {
    method,
    path
  });

  if (statusCode >= 400) {
    metrics.incrementCounter(METRICS.HTTP_ERRORS_TOTAL, 1, {
      method,
      path,
      status: String(statusCode)
    });
  }
}

export function recordDatabaseQuery(operation: string, durationMs: number, success: boolean): void {
  metrics.incrementCounter(METRICS.DB_QUERIES_TOTAL, 1, { operation });
  metrics.observeHistogram(METRICS.DB_QUERY_DURATION_MS, durationMs, { operation });

  if (!success) {
    metrics.incrementCounter(METRICS.DB_ERRORS_TOTAL, 1, { operation });
  }
}

export function recordPayment(success: boolean, amountCents: number, paymentType: string): void {
  metrics.incrementCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL, 1, { type: paymentType });

  if (success) {
    metrics.incrementCounter(METRICS.PAYMENT_SUCCESS_TOTAL, 1, { type: paymentType });
    metrics.incrementCounter(METRICS.PAYMENT_AMOUNT_CENTS, amountCents, { type: paymentType });
  } else {
    metrics.incrementCounter(METRICS.PAYMENT_FAILURES_TOTAL, 1, { type: paymentType });
  }
}

export function setActiveConnections(type: 'websocket' | 'database', count: number): void {
  const metric = type === 'websocket' ? METRICS.WS_CONNECTIONS_ACTIVE : METRICS.DB_CONNECTIONS_ACTIVE;
  metrics.setGauge(metric, count);
}

logger.info('[metrics] Metrics collector initialized');
