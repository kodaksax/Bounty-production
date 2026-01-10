// services/api/src/monitoring/opentelemetry.ts
// OpenTelemetry APM setup for comprehensive application monitoring

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { logger } from '../services/logger';

/**
 * Initialize OpenTelemetry SDK for distributed tracing and APM
 * 
 * Features:
 * - Automatic instrumentation for HTTP, PostgreSQL, Redis, etc.
 * - Distributed tracing with trace context propagation
 * - Performance monitoring and bottleneck detection
 * - Error tracking and stack traces
 */
export function initializeOpenTelemetry(): NodeSDK | null {
  // Skip initialization if OTEL is disabled or endpoint is not configured
  const otelEnabled = process.env.OTEL_ENABLED !== 'false';
  const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_ENDPOINT;
  
  if (!otelEnabled) {
    logger.info('[otel] OpenTelemetry is disabled via OTEL_ENABLED=false');
    return null;
  }

  try {
    // Service metadata
    const serviceName = process.env.OTEL_SERVICE_NAME || 'bountyexpo-api';
    const serviceVersion = process.env.npm_package_version || '1.0.0';
    const environment = process.env.NODE_ENV || 'development';

    // Import Resource at runtime
    const { Resource: ResourceClass } = require('@opentelemetry/resources');
    
    // Create resource with service metadata
    const resource = new ResourceClass({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
      [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
      [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
    });

    // Configure trace exporter
    const traceExporter = new OTLPTraceExporter({
      url: otelEndpoint || 'http://localhost:4318/v1/traces',
      headers: {
        // Add authentication headers if needed
        ...(process.env.OTEL_EXPORTER_OTLP_HEADERS && 
          (() => {
            try {
              return JSON.parse(process.env.OTEL_EXPORTER_OTLP_HEADERS);
            } catch (error) {
              logger.warn({ error }, '[otel] Failed to parse OTEL_EXPORTER_OTLP_HEADERS, ignoring');
              return {};
            }
          })())
      },
    });

    // Configure auto-instrumentation
    const instrumentations = getNodeAutoInstrumentations({
      // Disable filesystem instrumentation (too noisy)
      '@opentelemetry/instrumentation-fs': {
        enabled: false,
      },
      // Enable PostgreSQL query monitoring
      '@opentelemetry/instrumentation-pg': {
        enabled: true,
        enhancedDatabaseReporting: true,
      },
      // Enable Redis monitoring if available
      '@opentelemetry/instrumentation-redis': {
        enabled: true,
      },
      // Enable HTTP/HTTPS monitoring
      '@opentelemetry/instrumentation-http': {
        enabled: true,
        ignoreIncomingRequestHook: (request: any) => {
          // Ignore health check endpoints to reduce noise
          const ignoredPaths = ['/health', '/health/live', '/health/ready'];
          return ignoredPaths.some(path => request.url?.startsWith(path));
        },
      },
      // Enable Fastify monitoring
      '@opentelemetry/instrumentation-fastify': {
        enabled: true,
      },
      // Disable Winston (we use Pino)
      '@opentelemetry/instrumentation-winston': {
        enabled: false,
      },
      // Enable Pino logging instrumentation
      '@opentelemetry/instrumentation-pino': {
        enabled: true,
      },
    });

    // Initialize SDK
    const sdk = new NodeSDK({
      resource,
      traceExporter,
      instrumentations,
    });

    // Start SDK
    sdk.start();

    logger.info({
      serviceName,
      serviceVersion,
      environment,
      endpoint: otelEndpoint || 'http://localhost:4318/v1/traces',
    }, '[otel] OpenTelemetry SDK initialized successfully');

    // Graceful shutdown handler
    const shutdownHandler = async () => {
      try {
        await sdk.shutdown();
        logger.info('[otel] OpenTelemetry SDK shut down successfully');
      } catch (error) {
        logger.error({ error }, '[otel] Error shutting down OpenTelemetry SDK');
      }
    };

    // Register shutdown handlers
    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);

    return sdk;
  } catch (error) {
    logger.error({ error }, '[otel] Failed to initialize OpenTelemetry SDK');
    // Don't throw - monitoring should not prevent app from starting
    return null;
  }
}

/**
 * Helper to create custom spans for business operations
 * Use this to trace business-critical operations not covered by auto-instrumentation
 */
export function createCustomSpan(name: string, attributes?: Record<string, string | number | boolean>): any {
  try {
    const { trace, context } = require('@opentelemetry/api');
    const tracer = trace.getTracer('bountyexpo-business');
    
    return tracer.startActiveSpan(name, (span: any) => {
      if (attributes) {
        Object.entries(attributes).forEach(([key, value]) => {
          span.setAttribute(key, value);
        });
      }
      return span;
    });
  } catch (error) {
    logger.warn({ error, name }, '[otel] Failed to create custom span');
    return null;
  }
}

/**
 * Helper to record business metrics as span events
 */
export function recordBusinessMetric(
  metricName: string, 
  value: number, 
  attributes?: Record<string, string | number | boolean>
) {
  try {
    const { trace } = require('@opentelemetry/api');
    const span = trace.getActiveSpan();
    
    if (span) {
      span.addEvent(metricName, {
        value,
        ...attributes,
      });
    }
  } catch (error) {
    logger.warn({ error, metricName }, '[otel] Failed to record business metric');
  }
}
