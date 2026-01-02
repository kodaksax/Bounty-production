// services/api/src/routes/health.ts
// Enhanced health check endpoint with comprehensive system status

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../services/logger';
import { metrics, METRICS } from '../monitoring/metrics';
import { alerting } from '../monitoring/alerts';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  service: string;
  checks: {
    database?: HealthCheck;
    supabase?: HealthCheck;
    stripe?: HealthCheck;
    websocket?: HealthCheck;
    worker?: HealthCheck;
    redis?: HealthCheck;
  };
  metrics?: {
    requests: {
      total: number;
      errors: number;
      errorRate: number;
    };
    responseTime: {
      p50: number;
      p95: number;
      p99: number;
    };
    connections: {
      websocket: number;
      database: number;
    };
  };
  alerts?: any[];
}

interface HealthCheck {
  status: 'up' | 'down' | 'degraded';
  latencyMs?: number;
  error?: string;
  details?: any;
}

/**
 * Register enhanced health check routes
 */
export async function registerHealthRoutes(fastify: FastifyInstance) {
  /**
   * Basic health check - fast, no dependencies
   */
  fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api'
    };
  });

  /**
   * Detailed health check - includes all subsystems
   */
  fastify.get('/health/detailed', async (request: FastifyRequest, reply: FastifyReply) => {
    const checks: HealthCheckResult['checks'] = {};
    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check database
    try {
      const dbCheck = await checkDatabase();
      checks.database = dbCheck;
      if (dbCheck.status === 'down') overallStatus = 'unhealthy';
      else if (dbCheck.status === 'degraded') overallStatus = 'degraded';
    } catch (error) {
      checks.database = {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      overallStatus = 'unhealthy';
    }

    // Check Supabase
    try {
      const supabaseCheck = await checkSupabase();
      checks.supabase = supabaseCheck;
      if (supabaseCheck.status === 'down' && overallStatus === 'healthy') overallStatus = 'degraded';
    } catch (error) {
      checks.supabase = {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Check Stripe
    try {
      const stripeCheck = await checkStripe();
      checks.stripe = stripeCheck;
      if (stripeCheck.status === 'down' && overallStatus === 'healthy') overallStatus = 'degraded';
    } catch (error) {
      checks.stripe = {
        status: 'down',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Check WebSocket server
    checks.websocket = checkWebSocket();
    
    // Check background worker
    checks.worker = checkWorker();

    // Get metrics summary
    const metricsSummary = getMetricsSummary();
    
    // Get active alerts
    const activeAlerts = alerting.getActiveAlerts();

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      service: 'bountyexpo-api',
      checks,
      metrics: metricsSummary,
      alerts: activeAlerts.length > 0 ? activeAlerts : undefined
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    return reply.code(statusCode).send(result);
  });

  /**
   * Readiness check - for Kubernetes/load balancers
   */
  fastify.get('/health/ready', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Quick database check using existing pool
      const { pool } = require('../db/connection');
      await pool.query('SELECT 1');
      
      return reply.code(200).send({ ready: true });
    } catch (error) {
      return reply.code(503).send({
        ready: false,
        error: error instanceof Error ? error.message : 'Service not ready'
      });
    }
  });

  /**
   * Liveness check - for Kubernetes
   */
  fastify.get('/health/live', async (request: FastifyRequest, reply: FastifyReply) => {
    // Simple check that the process is running
    return reply.code(200).send({ alive: true });
  });
}

/**
 * Check database connectivity and performance
 */
async function checkDatabase(): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    // Import the existing pool from db/connection instead of creating a new one
    const { pool } = require('../db/connection');
    
    await pool.query('SELECT 1');
    
    const latencyMs = Date.now() - startTime;
    
    return {
      status: latencyMs < 100 ? 'up' : 'degraded',
      latencyMs,
      details: {
        connectionString: process.env.DATABASE_URL ? 'configured' : 'missing'
      }
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check Supabase connectivity
 */
async function checkSupabase(): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return {
        status: 'down',
        error: 'Supabase credentials not configured'
      };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Simple query to check connectivity
    const { error } = await supabase.from('profiles').select('id').limit(1);
    
    const latencyMs = Date.now() - startTime;

    if (error) {
      return {
        status: 'degraded',
        latencyMs,
        error: error.message
      };
    }

    return {
      status: latencyMs < 200 ? 'up' : 'degraded',
      latencyMs
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check Stripe API reachability
 */
async function checkStripe(): Promise<HealthCheck> {
  const startTime = Date.now();
  
  try {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    
    if (!stripeKey) {
      return {
        status: 'down',
        error: 'Stripe API key not configured'
      };
    }

    // We don't want to make actual Stripe API calls on health checks
    // Just verify the key is configured
    return {
      status: 'up',
      latencyMs: Date.now() - startTime,
      details: {
        configured: true
      }
    };
  } catch (error) {
    return {
      status: 'down',
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Check WebSocket server status
 */
function checkWebSocket(): HealthCheck {
  const activeConnections = metrics.getGauge(METRICS.WS_CONNECTIONS_ACTIVE);
  
  return {
    status: 'up',
    details: {
      activeConnections,
      messagesSent: metrics.getCounter(METRICS.WS_MESSAGES_SENT),
      messagesReceived: metrics.getCounter(METRICS.WS_MESSAGES_RECEIVED),
      errors: metrics.getCounter(METRICS.WS_ERRORS_TOTAL)
    }
  };
}

/**
 * Check background worker status
 */
function checkWorker(): HealthCheck {
  const jobsProcessed = metrics.getCounter(METRICS.WORKER_JOBS_PROCESSED);
  const jobsFailed = metrics.getCounter(METRICS.WORKER_JOBS_FAILED);
  
  return {
    status: 'up',
    details: {
      jobsProcessed,
      jobsFailed,
      outboxEventsProcessed: metrics.getCounter(METRICS.OUTBOX_EVENTS_PROCESSED)
    }
  };
}

/**
 * Get metrics summary
 */
function getMetricsSummary() {
  const totalRequests = metrics.getCounter(METRICS.HTTP_REQUESTS_TOTAL);
  const totalErrors = metrics.getCounter(METRICS.HTTP_ERRORS_TOTAL);
  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;

  const histogram = metrics.getHistogram(METRICS.HTTP_REQUEST_DURATION_MS);
  const p50 = histogram ? calculatePercentile(histogram, 50) : 0;
  const p95 = histogram ? calculatePercentile(histogram, 95) : 0;
  const p99 = histogram ? calculatePercentile(histogram, 99) : 0;

  return {
    requests: {
      total: totalRequests,
      errors: totalErrors,
      errorRate: Math.round(errorRate * 10000) / 100 // Convert to percentage with 2 decimals
    },
    responseTime: {
      p50: Math.round(p50),
      p95: Math.round(p95),
      p99: Math.round(p99)
    },
    connections: {
      websocket: metrics.getGauge(METRICS.WS_CONNECTIONS_ACTIVE),
      database: metrics.getGauge(METRICS.DB_CONNECTIONS_ACTIVE)
    }
  };
}

/**
 * Calculate percentile from histogram
 */
function calculatePercentile(histogram: any, percentile: number): number {
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

logger.info('[health] Health check routes initialized');
