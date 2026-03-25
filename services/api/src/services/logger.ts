// services/api/src/services/logger.ts - Structured logging with Pino
// Make logger safe to import in `test` environment by using a lightweight
// console-based shim to avoid pino/diagnostics_channel initialization during
// unit tests.

const isDevelopment = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

function createConsoleLogger(moduleName?: string) {
  const base = moduleName ? { module: moduleName } : {};
  const wrap = (fn: (...args: any[]) => void) => (...args: any[]) => fn(...args);
  const loggerShim: any = {
    info: wrap(console.info),
    warn: wrap(console.warn),
    error: wrap(console.error),
    debug: wrap(console.debug),
    child: (_opts: any) => loggerShim,
  };
  return loggerShim;
}

let logger: any;
let createModuleLogger: (module: string) => any;

if (process.env.NODE_ENV === 'test') {
  logger = createConsoleLogger();
  createModuleLogger = (m: string) => createConsoleLogger(m);
} else {
  // Defer importing pino to runtime (non-test) to avoid diagnostic issues in tests
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pino = require('pino');

  // Create Pino logger with configuration
  logger = pino({
    level: logLevel,
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
    base: {
      env: process.env.NODE_ENV,
      service: 'bountyexpo-api',
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      req: pino.stdSerializers.req,
      res: pino.stdSerializers.res,
      err: pino.stdSerializers.err,
    },
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

  createModuleLogger = (module: string) => logger.child({ module });
}

// Create child loggers for different modules
const analyticsLogger = createModuleLogger('analytics');
const authLogger = createModuleLogger('auth');
const paymentLogger = createModuleLogger('payment');
const bountyLogger = createModuleLogger('bounty');
const messagingLogger = createModuleLogger('messaging');
const performanceLogger = createModuleLogger('performance');
const adminLogger = createModuleLogger('admin');

// Helper functions for common log patterns
const loggers = {
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

export {
    adminLogger, analyticsLogger,
    authLogger, bountyLogger, createModuleLogger, logger, loggers, messagingLogger, paymentLogger, performanceLogger
};

export default logger;
