// services/api/src/routes/metrics.ts
// Metrics exposition endpoints for Prometheus and monitoring

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { metrics } from '../monitoring/metrics';
import { alerting } from '../monitoring/alerts';
import { tracing } from '../monitoring/tracing';
import { logger } from '../services/logger';

/**
 * Register metrics routes
 */
export async function registerMetricsRoutes(fastify: FastifyInstance) {
  /**
   * Prometheus metrics endpoint
   */
  fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const prometheusMetrics = metrics.getPrometheusMetrics();
    
    reply.header('Content-Type', 'text/plain; version=0.0.4');
    return prometheusMetrics;
  });

  /**
   * JSON metrics endpoint
   */
  fastify.get('/metrics/json', async (request: FastifyRequest, reply: FastifyReply) => {
    const allMetrics = metrics.getAllMetrics();
    
    return {
      timestamp: new Date().toISOString(),
      metrics: allMetrics
    };
  });

  /**
   * Active alerts endpoint
   */
  fastify.get('/metrics/alerts', async (request: FastifyRequest, reply: FastifyReply) => {
    const activeAlerts = alerting.getActiveAlerts();
    const alertHistory = alerting.getAlertHistory(20);
    
    return {
      timestamp: new Date().toISOString(),
      active: activeAlerts,
      recent: alertHistory
    };
  });

  /**
   * Traces endpoint - get recent traces
   */
  fastify.get('/metrics/traces', async (request: FastifyRequest, reply: FastifyReply) => {
    // This would return recent traces
    // For now, return basic info
    return {
      timestamp: new Date().toISOString(),
      message: 'Tracing enabled',
      info: 'Traces are collected but not exported in this endpoint yet'
    };
  });
}

logger.info('[metrics-routes] Metrics exposition routes initialized');
