// services/api/src/services/logger.ts - Structured logging with Pino
import pino from 'pino';

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Create Pino logger with configuration
export const logger = pino({
  level: logLevel,
  // In development, use pretty printing. In production, use JSON
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  // Base fields to include in all logs
  base: {
    env: process.env.NODE_ENV,
    service: 'bountyexpo-api',
  },
  // Timestamp configuration
  timestamp: pino.stdTimeFunctions.isoTime,
  // Serializers for common objects
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
  // Redact sensitive fields
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
      'secret',
      'apiKey',
      '*.password',
      '*.token',
      '*.secret',
      '*.apiKey',
    ],
    censor: '[REDACTED]',
  },
});

// Create child loggers for different modules
export const createModuleLogger = (module: string) => {
  return logger.child({ module });
};

// Analytics logger
export const analyticsLogger = createModuleLogger('analytics');

// Auth logger
export const authLogger = createModuleLogger('auth');

// Payment logger
export const paymentLogger = createModuleLogger('payment');

// Bounty logger
export const bountyLogger = createModuleLogger('bounty');

// Messaging logger
export const messagingLogger = createModuleLogger('messaging');

// Performance logger
export const performanceLogger = createModuleLogger('performance');

// Admin logger
export const adminLogger = createModuleLogger('admin');

// Helper functions for common log patterns
export const loggers = {
  /**
   * Log a user action
   */
  userAction: (userId: string, action: string, metadata?: Record<string, any>) => {
    analyticsLogger.info({
      userId,
      action,
      ...metadata,
    }, `User action: ${action}`);
  },

  /**
   * Log an API request
   */
  apiRequest: (method: string, path: string, userId?: string, metadata?: Record<string, any>) => {
    logger.info({
      method,
      path,
      userId,
      ...metadata,
    }, `API Request: ${method} ${path}`);
  },

  /**
   * Log an API response
   */
  apiResponse: (method: string, path: string, statusCode: number, duration: number, metadata?: Record<string, any>) => {
    const level = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
    logger[level]({
      method,
      path,
      statusCode,
      duration,
      ...metadata,
    }, `API Response: ${method} ${path} ${statusCode} (${duration}ms)`);
  },

  /**
   * Log a payment event
   */
  paymentEvent: (event: string, userId: string, amount: number, metadata?: Record<string, any>) => {
    paymentLogger.info({
      event,
      userId,
      amount,
      ...metadata,
    }, `Payment event: ${event}`);
  },

  /**
   * Log a bounty event
   */
  bountyEvent: (event: string, bountyId: string, userId: string, metadata?: Record<string, any>) => {
    bountyLogger.info({
      event,
      bountyId,
      userId,
      ...metadata,
    }, `Bounty event: ${event}`);
  },

  /**
   * Log a messaging event
   */
  messagingEvent: (event: string, userId: string, metadata?: Record<string, any>) => {
    messagingLogger.info({
      event,
      userId,
      ...metadata,
    }, `Messaging event: ${event}`);
  },

  /**
   * Log an authentication event
   */
  authEvent: (event: string, userId?: string, metadata?: Record<string, any>) => {
    authLogger.info({
      event,
      userId,
      ...metadata,
    }, `Auth event: ${event}`);
  },

  /**
   * Log a performance metric
   */
  performanceMetric: (metric: string, value: number, unit: string, metadata?: Record<string, any>) => {
    performanceLogger.info({
      metric,
      value,
      unit,
      ...metadata,
    }, `Performance: ${metric} = ${value}${unit}`);
  },

  /**
   * Log an error with context
   */
  error: (error: Error, context?: Record<string, any>) => {
    logger.error({
      err: error,
      ...context,
    }, error.message);
  },

  /**
   * Log a security event
   */
  securityEvent: (event: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: Record<string, any>) => {
    logger.warn({
      event,
      severity,
      type: 'security',
      ...metadata,
    }, `Security event: ${event}`);
  },
};

export default logger;
