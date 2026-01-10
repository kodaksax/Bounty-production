// services/api/src/routes/monitoring-dashboard.ts
// APM Monitoring Dashboard - comprehensive view of system health and performance

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { metrics, METRICS } from '../monitoring/metrics';
import { alerting } from '../monitoring/alerts';
import { tracing } from '../monitoring/tracing';
import { businessMetrics } from '../monitoring/business-metrics';
import { logger } from '../services/logger';

interface DashboardData {
  timestamp: string;
  service: string;
  version: string;
  environment: string;
  uptime: number;
  
  performance: {
    http: {
      requestsTotal: number;
      requestsPerSecond: number;
      errorRate: number;
      responseTime: {
        p50: number;
        p95: number;
        p99: number;
        avg: number;
      };
    };
    database: {
      queriesTotal: number;
      errorRate: number;
      responseTime: {
        p50: number;
        p95: number;
        p99: number;
        avg: number;
      };
      slowQueries: number;
    };
    websocket: {
      activeConnections: number;
      messagesSent: number;
      messagesReceived: number;
      errors: number;
    };
  };
  
  business: {
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
    rates: {
      bountiesPerHour: number;
      paymentsPerHour: number;
      signupsPerHour: number;
    };
  };
  
  alerts: {
    active: any[];
    recent: any[];
  };
  
  health: {
    status: 'healthy' | 'degraded' | 'critical';
    checks: string[];
  };
}

/**
 * Register monitoring dashboard routes
 */
export async function registerMonitoringDashboardRoutes(fastify: FastifyInstance) {
  /**
   * Main monitoring dashboard - comprehensive APM view
   */
  fastify.get('/monitoring/dashboard', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const startTime = process.uptime();
      
      // Gather all metrics
      const httpRequestsTotal = metrics.getCounter(METRICS.HTTP_REQUESTS_TOTAL);
      const httpErrorsTotal = metrics.getCounter(METRICS.HTTP_ERRORS_TOTAL);
      const httpHistogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
      
      const dbQueriesTotal = metrics.getCounter(METRICS.DB_QUERIES_TOTAL);
      const dbErrorsTotal = metrics.getCounter(METRICS.DB_ERRORS_TOTAL);
      const dbHistogram = metrics.getHistogram(METRICS.DB_QUERY_DURATION_MS);
      
      const wsConnections = metrics.getGauge(METRICS.WS_CONNECTIONS_ACTIVE);
      const wsMessagesSent = metrics.getCounter(METRICS.WS_MESSAGES_SENT);
      const wsMessagesReceived = metrics.getCounter(METRICS.WS_MESSAGES_RECEIVED);
      const wsErrors = metrics.getCounter(METRICS.WS_ERRORS_TOTAL);
      
      // Business metrics
      const businessSummary = businessMetrics.getSummary();
      const hourlyRates = businessMetrics.getHourlyRates();
      
      // Alerts
      const activeAlerts = alerting.getActiveAlerts();
      const recentAlerts = alerting.getAlertHistory(10);
      
      // Calculate health status
      const healthStatus = determineHealthStatus(activeAlerts, businessSummary);
      
      const dashboard: DashboardData = {
        timestamp: new Date().toISOString(),
        service: 'bountyexpo-api',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        uptime: Math.round(startTime),
        
        performance: {
          http: {
            requestsTotal: httpRequestsTotal,
            requestsPerSecond: calculateRPS(httpRequestsTotal, startTime),
            errorRate: calculateRate(httpErrorsTotal, httpRequestsTotal),
            responseTime: {
              p50: calculatePercentile(httpHistogram, 50),
              p95: calculatePercentile(httpHistogram, 95),
              p99: calculatePercentile(httpHistogram, 99),
              avg: calculateAverage(httpHistogram),
            },
          },
          database: {
            queriesTotal: dbQueriesTotal,
            errorRate: calculateRate(dbErrorsTotal, dbQueriesTotal),
            responseTime: {
              p50: calculatePercentile(dbHistogram, 50),
              p95: calculatePercentile(dbHistogram, 95),
              p99: calculatePercentile(dbHistogram, 99),
              avg: calculateAverage(dbHistogram),
            },
            slowQueries: countSlowQueries(dbHistogram),
          },
          websocket: {
            activeConnections: wsConnections,
            messagesSent: wsMessagesSent,
            messagesReceived: wsMessagesReceived,
            errors: wsErrors,
          },
        },
        
        business: {
          ...businessSummary,
          rates: hourlyRates,
        },
        
        alerts: {
          active: activeAlerts,
          recent: recentAlerts,
        },
        
        health: healthStatus,
      };
      
      return reply.send(dashboard);
    } catch (error) {
      logger.error({ error }, '[monitoring-dashboard] Failed to generate dashboard');
      return reply.code(500).send({
        error: 'Failed to generate monitoring dashboard',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
  
  /**
   * Real-time metrics stream (for live dashboard updates)
   */
  fastify.get('/monitoring/stream', async (request: FastifyRequest, reply: FastifyReply) => {
    // This endpoint would be better implemented with Server-Sent Events (SSE)
    // For now, return a message indicating WebSocket support
    return {
      message: 'Real-time metrics streaming',
      info: 'Use /monitoring/dashboard for current metrics snapshot',
      note: 'WebSocket streaming can be implemented separately if needed',
    };
  });
  
  /**
   * Performance summary endpoint
   */
  fastify.get('/monitoring/performance', async (request: FastifyRequest, reply: FastifyReply) => {
    const httpHistogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
    const dbHistogram = metrics.getHistogram(METRICS.DB_QUERY_DURATION_MS);
    
    return {
      timestamp: new Date().toISOString(),
      http: {
        p50: calculatePercentile(httpHistogram, 50),
        p95: calculatePercentile(httpHistogram, 95),
        p99: calculatePercentile(httpHistogram, 99),
        avg: calculateAverage(httpHistogram),
      },
      database: {
        p50: calculatePercentile(dbHistogram, 50),
        p95: calculatePercentile(dbHistogram, 95),
        p99: calculatePercentile(dbHistogram, 99),
        avg: calculateAverage(dbHistogram),
      },
    };
  });
  
  /**
   * Business metrics summary endpoint
   */
  fastify.get('/monitoring/business', async (request: FastifyRequest, reply: FastifyReply) => {
    const summary = businessMetrics.getSummary();
    const rates = businessMetrics.getHourlyRates();
    
    return {
      timestamp: new Date().toISOString(),
      summary,
      rates,
    };
  });
}

/**
 * Helper functions
 */

function calculatePercentile(histogram: any, percentile: number): number {
  if (!histogram || histogram.count === 0) return 0;
  
  const targetCount = histogram.count * (percentile / 100);
  let cumulativeCount = 0;
  
  for (const bucket of histogram.buckets) {
    cumulativeCount += bucket.count;
    if (cumulativeCount >= targetCount) {
      return Math.round(bucket.le);
    }
  }
  
  return Math.round(histogram.buckets[histogram.buckets.length - 1].le);
}

function calculateAverage(histogram: any): number {
  if (!histogram || histogram.count === 0) return 0;
  return Math.round(histogram.sum / histogram.count);
}

function calculateRate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 10000) / 100; // Percentage with 2 decimals
}

function calculateRPS(total: number, uptimeSeconds: number): number {
  if (uptimeSeconds === 0) return 0;
  return Math.round((total / uptimeSeconds) * 100) / 100;
}

function countSlowQueries(histogram: any, thresholdMs: number = 5000): number {
  if (!histogram) return 0;
  
  let slowCount = 0;
  for (const bucket of histogram.buckets) {
    if (bucket.le > thresholdMs) {
      slowCount += bucket.count;
    }
  }
  
  return slowCount;
}

function determineHealthStatus(
  activeAlerts: any[], 
  businessSummary: any
): { status: 'healthy' | 'degraded' | 'critical'; checks: string[] } {
  const checks: string[] = [];
  
  // Check for critical alerts
  const criticalAlerts = activeAlerts.filter(a => a.severity === 'critical');
  if (criticalAlerts.length > 0) {
    checks.push(`${criticalAlerts.length} critical alerts active`);
    return { status: 'critical', checks };
  }
  
  // Check payment success rate
  if (businessSummary.payments.successRate < 95) {
    checks.push(`Payment success rate below 95%: ${businessSummary.payments.successRate}%`);
    return { status: 'degraded', checks };
  }
  
  // Check for warning alerts
  const warningAlerts = activeAlerts.filter(a => a.severity === 'warning');
  if (warningAlerts.length > 0) {
    checks.push(`${warningAlerts.length} warning alerts active`);
    return { status: 'degraded', checks };
  }
  
  checks.push('All systems operational');
  return { status: 'healthy', checks };
}

logger.info('[monitoring-dashboard] Monitoring dashboard routes initialized');
