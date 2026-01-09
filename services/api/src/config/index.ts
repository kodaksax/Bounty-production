/* eslint-disable expo/no-dynamic-env-var */
/**
 * Unified Configuration Management
 * Centralizes all environment variables and configuration for the consolidated backend service
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables with fallback strategy
function loadEnvironment() {
  // Try local .env first
  const local = dotenv.config();
  
  // If critical vars missing, try root .env
  if (!process.env.STRIPE_SECRET_KEY && !process.env.DATABASE_URL) {
    const rootEnv = path.resolve(__dirname, '../../../../.env');
    if (fs.existsSync(rootEnv)) {
      dotenv.config({ path: rootEnv });
      console.log(`[Config] Loaded environment from ${rootEnv}`);
    } else if (local.error) {
      console.warn('[Config] No .env found in service folder or repo root; using existing environment');
    }
  }
}

// Load environment on module import
loadEnvironment();

/**
 * Sanitize environment variable values
 * Removes quotes and trims whitespace
 */
function sanitizeEnv(value?: string | null): string | undefined {
  if (value === undefined || value === null) return undefined;
  let v = String(value).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1).trim();
  }
  return v === '' ? undefined : v;
}

// Sanitize critical DB environment variables
const dbEnvKeys = ['DATABASE_URL', 'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const k of dbEnvKeys) {
  if (process.env[k]) {
    const cleaned = sanitizeEnv(process.env[k]);
    if (cleaned !== undefined) process.env[k] = cleaned;
  }
}

/**
 * Get required environment variable or throw error
 */
function getRequired(name: string, fallbacks: string[] = []): string {
  // Try primary name first
  let value = process.env[name];
  
  // Try fallbacks
  if (!value) {
    for (const fallback of fallbacks) {
      value = process.env[fallback];
      if (value) {
        console.log(`[Config] Using ${fallback} for ${name}`);
        break;
      }
    }
  }
  
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (also tried: ${fallbacks.join(', ')})`);
  }
  
  return value;
}

/**
 * Get optional environment variable with default
 */
function getOptional(name: string, defaultValue: string, fallbacks: string[] = []): string {
  let value = process.env[name];
  
  if (!value) {
    for (const fallback of fallbacks) {
      value = process.env[fallback];
      if (value) break;
    }
  }
  
  return value || defaultValue;
}

/**
 * Get boolean environment variable
 */
function getBoolean(name: string, defaultValue: boolean = false): boolean {
  const value = process.env[name];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

/**
 * Get number environment variable
 */
function getNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Unified Configuration Object
 */
export const config = {
  // Service Configuration
  service: {
    name: 'bountyexpo-api',
    version: '2.0.0',
    env: getOptional('NODE_ENV', 'development'),
    port: getNumber('PORT', 3001),
    host: getOptional('HOST', '0.0.0.0'),
  },

  // Database Configuration
  database: {
    url: getOptional('DATABASE_URL', ''),
    host: getOptional('DB_HOST', 'localhost', ['PGHOST']),
    port: getNumber('DB_PORT', 5432),
    user: getOptional('DB_USER', 'postgres', ['PGUSER']),
    password: getOptional('DB_PASSWORD', '', ['PGPASSWORD']),
    name: getOptional('DB_NAME', 'bountyexpo', ['PGDATABASE']),
    pool: {
      min: getNumber('DB_POOL_MIN', 2),
      max: getNumber('DB_POOL_MAX', 10),
      idleTimeoutMillis: getNumber('DB_IDLE_TIMEOUT', 30000),
      connectionTimeoutMillis: getNumber('DB_CONNECTION_TIMEOUT', 2000),
    },
    ssl: getBoolean('DB_SSL', false),
  },

  // Redis Configuration
  redis: {
    host: getOptional('REDIS_HOST', 'localhost'),
    port: getNumber('REDIS_PORT', 6379),
    password: getOptional('REDIS_PASSWORD', ''),
    db: getNumber('REDIS_DB', 0),
    keyPrefix: getOptional('REDIS_KEY_PREFIX', 'bountyexpo:'),
    enabled: getBoolean('REDIS_ENABLED', true),
    ttl: {
      profile: getNumber('REDIS_TTL_PROFILE', 300), // 5 minutes
      bounty: getNumber('REDIS_TTL_BOUNTY', 180), // 3 minutes
      bountyList: getNumber('REDIS_TTL_BOUNTY_LIST', 60), // 1 minute
    },
  },

  // Supabase Configuration
  supabase: {
    url: getRequired('EXPO_PUBLIC_SUPABASE_URL', ['SUPABASE_URL', 'PUBLIC_SUPABASE_URL']),
    anonKey: getRequired('EXPO_PUBLIC_SUPABASE_ANON_KEY', ['SUPABASE_ANON_KEY']),
    serviceRoleKey: getRequired('SUPABASE_SERVICE_ROLE_KEY', ['SUPABASE_SERVICE_KEY', 'SERVICE_ROLE_KEY']),
    jwtSecret: getOptional('SUPABASE_JWT_SECRET', ''),
  },

  // Stripe Configuration
  stripe: {
    secretKey: getRequired('STRIPE_SECRET_KEY'),
    webhookSecret: getOptional('STRIPE_WEBHOOK_SECRET', ''),
    connectClientId: getOptional('STRIPE_CONNECT_CLIENT_ID', ''),
    platformFeePercent: getNumber('STRIPE_PLATFORM_FEE_PERCENT', 5),
  },

  // External Services
  external: {
    mixpanel: {
      token: getOptional('MIXPANEL_TOKEN', ''),
      enabled: getBoolean('ENABLE_MIXPANEL', false),
    },
    sentry: {
      dsn: getOptional('SENTRY_DSN', ''),
      enabled: getBoolean('ENABLE_SENTRY', false),
      tracesSampleRate: getNumber('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    },
  },

  // Security Configuration
  security: {
    secretKey: getOptional('SECRET_KEY', 'dev-fallback-secret'),
    allowedOrigins: getOptional('ALLOWED_ORIGINS', 'http://localhost:8081,http://localhost:19000,http://localhost:19006').split(','),
    sessionSecret: getOptional('SESSION_SECRET', 'dev-session-secret'),
    // Flag to track if using insecure defaults
    usingDefaultSecretKey: !process.env.SECRET_KEY,
    usingDefaultSessionSecret: !process.env.SESSION_SECRET,
  },

  // Rate Limiting Configuration
  rateLimit: {
    global: {
      windowMs: getNumber('RATE_LIMIT_WINDOW_MS', 60000), // 1 minute
      max: getNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    },
    payment: {
      windowMs: getNumber('PAYMENT_RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
      max: getNumber('PAYMENT_RATE_LIMIT_MAX', 10),
    },
    auth: {
      windowMs: getNumber('AUTH_RATE_LIMIT_WINDOW_MS', 900000), // 15 minutes
      max: getNumber('AUTH_RATE_LIMIT_MAX', 5),
    },
  },

  // Feature Flags
  features: {
    analytics: getBoolean('ENABLE_ANALYTICS', true),
    riskManagement: getBoolean('ENABLE_RISK_MANAGEMENT', true),
    notifications: getBoolean('ENABLE_NOTIFICATIONS', true),
    messaging: getBoolean('ENABLE_MESSAGING', true),
    admin: getBoolean('ENABLE_ADMIN', true),
  },

  // Logging Configuration
  logging: {
    level: getOptional('LOG_LEVEL', 'info'),
    prettyPrint: getBoolean('LOG_PRETTY_PRINT', process.env.NODE_ENV === 'development'),
  },

  // Application URLs
  urls: {
    app: getOptional('APP_URL', 'http://localhost:8081'),
    api: getOptional('API_URL', 'http://localhost:3001'),
  },

  // Background Jobs Configuration
  jobs: {
    outboxWorker: {
      enabled: getBoolean('ENABLE_OUTBOX_WORKER', true),
      intervalMs: getNumber('OUTBOX_WORKER_INTERVAL_MS', 5000),
    },
    riskAssessment: {
      enabled: getBoolean('ENABLE_RISK_ASSESSMENT_CRON', true),
      schedule: getOptional('RISK_ASSESSMENT_CRON_SCHEDULE', '0 */6 * * *'), // Every 6 hours
    },
    staleBounty: {
      enabled: getBoolean('ENABLE_STALE_BOUNTY_DETECTION', true),
      schedule: getOptional('STALE_BOUNTY_CRON_SCHEDULE', '0 0 * * *'), // Daily at midnight
    },
  },
} as const;

/**
 * Validate configuration
 * Throws error if critical configuration is missing
 */
export function validateConfig(): void {
  const errors: string[] = [];

  // Validate database configuration
  if (!config.database.url && !config.database.host) {
    errors.push('Database configuration missing: need DATABASE_URL or DB_HOST');
  }

  // Validate Supabase configuration
  if (!config.supabase.url) {
    errors.push('Supabase URL missing');
  }
  if (!config.supabase.serviceRoleKey) {
    errors.push('Supabase service role key missing');
  }

  // Validate Stripe configuration
  if (!config.stripe.secretKey) {
    errors.push('Stripe secret key missing');
  }
  
  // Validate security configuration in production
  if (config.service.env === 'production') {
    if (config.security.usingDefaultSecretKey || config.security.secretKey === 'dev-fallback-secret') {
      errors.push('SECRET_KEY must be set to a secure value in production (not using default dev-fallback-secret)');
    }
    if (config.security.usingDefaultSessionSecret || config.security.sessionSecret === 'dev-session-secret') {
      errors.push('SESSION_SECRET must be set to a secure value in production (not using default dev-session-secret)');
    }
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }

  console.log('[Config] Configuration validated successfully');
}

/**
 * Get configuration summary for logging
 * Excludes sensitive values
 */
export function getConfigSummary() {
  return {
    service: config.service,
    database: {
      host: config.database.host,
      port: config.database.port,
      name: config.database.name,
      hasUrl: !!config.database.url,
      pool: config.database.pool,
    },
    redis: {
      host: config.redis.host,
      port: config.redis.port,
      enabled: config.redis.enabled,
      hasPassword: !!config.redis.password,
      ttl: config.redis.ttl,
    },
    supabase: {
      url: config.supabase.url,
      hasAnonKey: !!config.supabase.anonKey,
      hasServiceKey: !!config.supabase.serviceRoleKey,
    },
    stripe: {
      hasSecretKey: !!config.stripe.secretKey,
      hasWebhookSecret: !!config.stripe.webhookSecret,
      platformFeePercent: config.stripe.platformFeePercent,
    },
    features: config.features,
    rateLimit: config.rateLimit,
  };
}

// Validate configuration on import
try {
  validateConfig();
} catch (error) {
  console.error('[Config] Configuration validation error:', error);
  if (config.service.env === 'production') {
    throw error; // Fail fast in production
  }
}
