// services/api/src/__tests__/monitoring.test.ts
// Tests for APM monitoring setup

import { metrics, METRICS, recordHttpRequest, recordDatabaseQuery, recordPayment } from '../monitoring/metrics';
import { alerting } from '../monitoring/alerts';
import { businessMetrics } from '../monitoring/business-metrics';

describe('APM Monitoring', () => {
  beforeEach(() => {
    // Reset metrics before each test
    metrics.reset();
  });

  describe('Metrics Collection', () => {
    it('should record HTTP requests', () => {
      recordHttpRequest('GET', '/health', 200, 50);
      
      const total = metrics.getCounter(METRICS.HTTP_REQUESTS_TOTAL);
      expect(total).toBeGreaterThan(0);
    });

    it('should record HTTP errors', () => {
      recordHttpRequest('GET', '/api/test', 500, 100);
      
      const errors = metrics.getCounter(METRICS.HTTP_ERRORS_TOTAL);
      expect(errors).toBeGreaterThan(0);
    });

    it('should calculate response time percentiles', () => {
      // Record multiple requests with different durations
      for (let i = 0; i < 100; i++) {
        recordHttpRequest('GET', '/api/test', 200, i * 10);
      }
      
      const histogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
      expect(histogram).toBeDefined();
      expect(histogram?.count).toBe(100);
      expect(histogram?.sum).toBeGreaterThan(0);
    });

    it('should record database queries', () => {
      recordDatabaseQuery('SELECT', 25, true);
      
      const total = metrics.getCounter(METRICS.DB_QUERIES_TOTAL);
      expect(total).toBeGreaterThan(0);
    });

    it('should record failed database queries', () => {
      recordDatabaseQuery('SELECT', 50, false);
      
      const errors = metrics.getCounter(METRICS.DB_ERRORS_TOTAL);
      expect(errors).toBeGreaterThan(0);
    });

    it('should record payment transactions', () => {
      recordPayment(true, 10000, 'bounty_escrow');
      
      const total = metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL);
      const successful = metrics.getCounter(METRICS.PAYMENT_SUCCESS_TOTAL);
      
      expect(total).toBe(1);
      expect(successful).toBe(1);
    });

    it('should record failed payment transactions', () => {
      recordPayment(false, 10000, 'bounty_release');
      
      const total = metrics.getCounter(METRICS.PAYMENT_TRANSACTIONS_TOTAL);
      const failed = metrics.getCounter(METRICS.PAYMENT_FAILURES_TOTAL);
      
      expect(total).toBe(1);
      expect(failed).toBe(1);
    });
  });

  describe('Business Metrics', () => {
    it('should track bounty creation', () => {
      businessMetrics.trackBountyCreated('bounty-1', 'user-1', 10000);
      
      const summary = businessMetrics.getSummary();
      expect(summary.bounties.created).toBe(1);
    });

    it('should track bounty acceptance', () => {
      businessMetrics.trackBountyAccepted('bounty-1', 'hunter-1', 'poster-1');
      
      const summary = businessMetrics.getSummary();
      expect(summary.bounties.accepted).toBe(1);
    });

    it('should track bounty completion', () => {
      businessMetrics.trackBountyCompleted('bounty-1', 'hunter-1', 'poster-1', 10000);
      
      const summary = businessMetrics.getSummary();
      expect(summary.bounties.completed).toBe(1);
    });

    it('should calculate completion rate', () => {
      businessMetrics.trackBountyCreated('bounty-1', 'user-1', 10000);
      businessMetrics.trackBountyCreated('bounty-2', 'user-1', 20000);
      businessMetrics.trackBountyCompleted('bounty-1', 'hunter-1', 'user-1', 10000);
      
      const summary = businessMetrics.getSummary();
      expect(summary.bounties.completionRate).toBe(50);
    });

    it('should track payment success rate', () => {
      businessMetrics.trackPayment(true, 10000, 'escrow', 'user-1', 'bounty-1');
      businessMetrics.trackPayment(true, 15000, 'release', 'user-2', 'bounty-2');
      businessMetrics.trackPayment(false, 5000, 'escrow', 'user-3', 'bounty-3');
      
      const summary = businessMetrics.getSummary();
      expect(summary.payments.total).toBe(3);
      expect(summary.payments.successful).toBe(2);
      expect(summary.payments.failed).toBe(1);
      expect(summary.payments.successRate).toBeCloseTo(66.67, 1);
    });

    it('should track user signups', () => {
      businessMetrics.trackUserSignup('user-1', 'email');
      businessMetrics.trackUserSignup('user-2', 'social');
      
      const summary = businessMetrics.getSummary();
      expect(summary.users.signups).toBe(2);
    });
  });

  describe('Alerting', () => {
    it('should trigger high error rate alert', () => {
      // Generate requests with > 1% error rate
      for (let i = 0; i < 100; i++) {
        recordHttpRequest('GET', '/api/test', 200, 50);
      }
      for (let i = 0; i < 5; i++) {
        recordHttpRequest('GET', '/api/test', 500, 100);
      }
      
      alerting.checkAlerts();
      
      const activeAlerts = alerting.getActiveAlerts();
      const errorRateAlert = activeAlerts.find(a => a.rule === 'high_error_rate');
      
      expect(errorRateAlert).toBeDefined();
      expect(errorRateAlert?.severity).toBe('critical');
    });

    it('should trigger slow API response alert', () => {
      // Generate requests with > 1s p95
      for (let i = 0; i < 100; i++) {
        const duration = i < 95 ? 500 : 1500; // Last 5 are > 1s
        recordHttpRequest('GET', '/api/test', 200, duration);
      }
      
      alerting.checkAlerts();
      
      const activeAlerts = alerting.getActiveAlerts();
      const slowApiAlert = activeAlerts.find(a => a.rule === 'slow_api_response_time');
      
      expect(slowApiAlert).toBeDefined();
      expect(slowApiAlert?.severity).toBe('critical');
    });

    it('should trigger payment failure rate alert', () => {
      // Generate > 5% payment failure rate
      for (let i = 0; i < 20; i++) {
        recordPayment(i < 18, 10000, 'test'); // 2 failures out of 20 = 10%
      }
      
      alerting.checkAlerts();
      
      const activeAlerts = alerting.getActiveAlerts();
      const paymentAlert = activeAlerts.find(a => a.rule === 'payment_failure_rate');
      
      expect(paymentAlert).toBeDefined();
      expect(paymentAlert?.severity).toBe('critical');
    });

    it('should not trigger alerts when thresholds are not exceeded', () => {
      // Generate normal traffic
      for (let i = 0; i < 100; i++) {
        recordHttpRequest('GET', '/api/test', 200, 100);
        recordPayment(true, 10000, 'test');
      }
      
      alerting.checkAlerts();
      
      const activeAlerts = alerting.getActiveAlerts();
      expect(activeAlerts.length).toBe(0);
    });
  });

  describe('Prometheus Metrics Format', () => {
    it('should export metrics in Prometheus format', () => {
      recordHttpRequest('GET', '/health', 200, 50);
      recordPayment(true, 10000, 'test');
      
      const prometheusMetrics = metrics.getPrometheusMetrics();
      
      expect(prometheusMetrics).toContain('# TYPE');
      expect(prometheusMetrics).toContain('http_requests_total');
      expect(prometheusMetrics).toContain('payment_transactions_total');
    });
  });

  describe('JSON Metrics Format', () => {
    it('should export metrics as JSON', () => {
      recordHttpRequest('GET', '/health', 200, 50);
      
      const jsonMetrics = metrics.getAllMetrics();
      
      expect(jsonMetrics).toHaveProperty('counters');
      expect(jsonMetrics).toHaveProperty('gauges');
      expect(jsonMetrics).toHaveProperty('histograms');
    });
  });
});
