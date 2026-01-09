/**
 * Redis-backed Rate Limiting Middleware
 * Implements distributed rate limiting for authentication and API endpoints
 * 
 * Security Features:
 * - Redis-backed storage for distributed rate limiting across multiple instances
 * - Aggressive rate limiting on authentication endpoints (5 attempts per 15 minutes)
 * - IP + email keying for targeted brute force protection
 * - Moderate rate limiting on general API endpoints (100 requests per minute)
 * - Standard rate limit headers (RateLimit-*)
 * 
 * Note: Uses @fastify/rate-limit with Redis store integration
 */

import type { FastifyRequest } from 'fastify';
import Redis from 'ioredis';
import { config } from '../config';

/**
 * Redis client for rate limiting
 * Separate instance from cache to avoid interference
 */
let rateLimitRedis: InstanceType<typeof Redis> | null = null;

/**
 * Initialize Redis client for rate limiting
 */
function getRedisClient(): InstanceType<typeof Redis> {
  if (!rateLimitRedis) {
    // Use connection options object instead of URL to avoid password exposure in logs
    const redisOptions: any = {
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
      // Rate limiting should be fast - use shorter timeouts
      connectTimeout: 1000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // Don't queue commands if disconnected
      lazyConnect: false,
    };

    // Add password only if configured
    if (config.redis.password) {
      redisOptions.password = config.redis.password;
    }

    rateLimitRedis = new Redis(redisOptions);

    rateLimitRedis.on('error', (err: Error) => {
      // Log error without exposing connection details
      console.error('[RateLimit] Redis connection error occurred');
    });

    rateLimitRedis.on('connect', () => {
      console.log('[RateLimit] Connected to Redis for rate limiting');
    });
  }
  
  return rateLimitRedis;
}

/**
 * Redis Store implementation for @fastify/rate-limit
 * Implements the store interface required by the plugin
 */
class RedisRateLimitStore {
  private redis: InstanceType<typeof Redis>;
  private namespace: string;
  private ttlSeconds: number;

  constructor(namespace: string, ttlMs: number) {
    this.redis = getRedisClient();
    this.namespace = namespace;
    this.ttlSeconds = Math.ceil(ttlMs / 1000);
  }

  /**
   * Increment the request count for a key using atomic Lua script
   * @param key - The rate limit key (IP, IP+email, etc.)
   * @param callback - Callback with current count and TTL
   */
  async incr(key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void): Promise<void> {
    try {
      const redisKey = `${this.namespace}${key}`;
      
      // Use Lua script for atomic INCR + EXPIRE + PTTL operations
      // This ensures the key always has a TTL set atomically
      const script = `
        local key = KEYS[1]
        local ttlSeconds = tonumber(ARGV[1])
        local current = redis.call("INCR", key)
        local ttlMs = redis.call("PTTL", key)
        if ttlMs == -1 or ttlMs == -2 then
          redis.call("EXPIRE", key, ttlSeconds)
          ttlMs = ttlSeconds * 1000
        end
        return {current, ttlMs}
      `;

      const result = await this.redis.eval(script, 1, redisKey, this.ttlSeconds) as [number, number];

      if (!Array.isArray(result) || result.length < 2) {
        return callback(new Error('Redis eval script returned invalid result'));
      }

      const current = result[0];
      const ttlMs = result[1];

      callback(null, {
        current,
        ttl: ttlMs > 0 ? Math.ceil(ttlMs / 1000) : this.ttlSeconds,
      });
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * Create a child store with a new namespace
   * Used by @fastify/rate-limit for per-route stores
   * Sanitizes route info to prevent extremely long keys
   */
  child(routeOptions: { routeInfo: { method: string; url: string } }): RedisRateLimitStore {
    const { method, url } = routeOptions.routeInfo;
    // Sanitize and limit URL length to prevent extremely long Redis keys
    const sanitizedUrl = url.slice(0, 100).replace(/[^a-zA-Z0-9\-_/]/g, '_');
    const childNamespace = `${this.namespace}${method}:${sanitizedUrl}:`;
    return new RedisRateLimitStore(childNamespace, this.ttlSeconds * 1000);
  }
}

/**
 * Sanitize email for use in Redis key
 * Prevents key collision attacks and Redis injection
 */
function sanitizeEmail(email: string): string {
  // Convert to lowercase and trim
  const normalized = email.toLowerCase().trim();
  
  // Only allow valid email characters: alphanumeric, @, ., -, _, +
  // Replace any other characters with empty string
  const sanitized = normalized.replace(/[^a-z0-9@.\-_+]/g, '');
  
  // Limit length to prevent extremely long keys
  return sanitized.slice(0, 254); // RFC 5321 max email length
}

/**
 * Get client IP, respecting X-Forwarded-For header if trustProxy is enabled
 * Note: Fastify's trustProxy setting must be configured for this to work correctly
 */
function getClientIp(request: FastifyRequest): string {
  // Fastify automatically handles X-Forwarded-For when trustProxy is enabled
  // request.ip will contain the correct client IP
  return request.ip || 'unknown';
}

/**
 * Lazy initialization functions to avoid module-level instantiation errors
 */
let authStoreInstance: RedisRateLimitStore | null = null;
let apiStoreInstance: RedisRateLimitStore | null = null;

function getAuthStore(): RedisRateLimitStore {
  if (!authStoreInstance) {
    authStoreInstance = new RedisRateLimitStore('rl:auth:', config.rateLimit.auth.windowMs);
  }
  return authStoreInstance;
}

function getApiStore(): RedisRateLimitStore {
  if (!apiStoreInstance) {
    apiStoreInstance = new RedisRateLimitStore('rl:api:', config.rateLimit.global.windowMs);
  }
  return apiStoreInstance;
}

/**
 * Aggressive rate limiter for authentication endpoints
 * - 5 attempts per 15 minutes
 * - Keys by IP + email to prevent brute force attacks
 * - Includes retry-after header
 */
export const authLimiterConfig = {
  max: config.rateLimit.auth.max, // 5 attempts
  timeWindow: config.rateLimit.auth.windowMs, // 15 minutes
  cache: 10000, // Keep 10k keys in memory cache for performance
  skipOnError: true, // Graceful degradation if Redis is unavailable
  
  // Use custom Redis store (lazy initialization)
  get store() {
    return getAuthStore();
  },
  
  // Key generator: IP + email for targeted limiting
  keyGenerator: (request: FastifyRequest) => {
    const body = request.body as { email?: string } | undefined;
    const rawEmail = body?.email || 'unknown';
    // Sanitize email to prevent key collision attacks
    const email = sanitizeEmail(rawEmail);
    const ip = getClientIp(request);
    return `${ip}-${email}`;
  },
  
  // Error response with retry-after
  errorResponseBuilder: (request: FastifyRequest, context: any) => {
    return {
      error: 'Too many authentication attempts. Please try again in 15 minutes.',
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      retryAfter: context.ttl,
    };
  },
  
  // Enable standard headers
  enableDraftSpec: true, // Use draft-7 standard headers
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true,
  },
  
  // Hooks for logging
  onExceeding: (request: FastifyRequest, key: string) => {
    request.log.warn(
      { ip: request.ip, key },
      'Authentication rate limit approaching'
    );
  },
  
  onExceeded: (request: FastifyRequest, key: string) => {
    request.log.warn(
      { ip: request.ip, key },
      'Authentication rate limit exceeded'
    );
  },
};

/**
 * Moderate rate limiter for general API endpoints
 * - 100 requests per minute
 * - Keys by IP address
 */
export const apiLimiterConfig = {
  max: config.rateLimit.global.max, // 100 requests
  timeWindow: config.rateLimit.global.windowMs, // 1 minute
  cache: 10000,
  skipOnError: true, // Graceful degradation if Redis is unavailable
  
  // Use custom Redis store (lazy initialization)
  get store() {
    return getApiStore();
  },
  
  keyGenerator: (request: FastifyRequest) => {
    return getClientIp(request);
  },
  
  errorResponseBuilder: (request: FastifyRequest, context: any) => {
    return {
      error: 'Too many requests. Please slow down.',
      code: 'RATE_LIMIT_EXCEEDED',
      statusCode: 429,
      retryAfter: context.ttl,
    };
  },
  
  enableDraftSpec: true,
  addHeadersOnExceeding: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
  },
  addHeaders: {
    'x-ratelimit-limit': true,
    'x-ratelimit-remaining': true,
    'x-ratelimit-reset': true,
    'retry-after': true,
  },
};

/**
 * Cleanup function for graceful shutdown
 */
export async function closeRateLimitRedis(): Promise<void> {
  if (rateLimitRedis) {
    await rateLimitRedis.quit();
    rateLimitRedis = null;
    console.log('[RateLimit] Redis connection closed');
  }
}

/**
 * Register process-level shutdown hooks to ensure the rate limit Redis client
 * is closed properly. Using `once` prevents multiple invocations.
 */
function registerRateLimitShutdownHooks(): void {
  const shutdown = (signal: string) => {
    try {
      // Fire-and-forget async cleanup
      void closeRateLimitRedis();
      console.log(`[RateLimit] Shutdown hook triggered by ${signal}`);
    } catch (err) {
      console.error('[RateLimit] Error during Redis shutdown', err);
    }
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('beforeExit', () => shutdown('beforeExit'));
}

// Register shutdown hooks when this module is loaded
registerRateLimitShutdownHooks();
