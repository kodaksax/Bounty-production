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
    // Construct REDIS_URL from config if not explicitly set
    const redisUrl = process.env.REDIS_URL || 
                     `redis://${config.redis.password ? `:${config.redis.password}@` : ''}${config.redis.host}:${config.redis.port}/${config.redis.db}`;
    
    rateLimitRedis = new Redis(redisUrl, {
      // Rate limiting should be fast - use shorter timeouts
      connectTimeout: 1000,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false, // Don't queue commands if disconnected
      lazyConnect: false,
    });

    rateLimitRedis.on('error', (err: Error) => {
      console.error('[RateLimit] Redis error:', err.message);
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

  constructor(namespace: string) {
    this.redis = getRedisClient();
    this.namespace = namespace;
  }

  /**
   * Increment the request count for a key
   * @param key - The rate limit key (IP, IP+email, etc.)
   * @param callback - Callback with current count and TTL
   */
  async incr(key: string, callback: (err: Error | null, result?: { current: number; ttl: number }) => void): Promise<void> {
    try {
      const redisKey = `${this.namespace}${key}`;
      const ttl = 900; // 15 minutes in seconds for auth endpoints
      
      // Use MULTI/EXEC for atomic operations
      const multi = this.redis.multi();
      multi.incr(redisKey);
      multi.pttl(redisKey);
      
      const results = await multi.exec();
      
      if (!results || results.length < 2) {
        return callback(new Error('Redis multi command failed'));
      }
      
      const [incrErr, incrResult] = results[0];
      const [ttlErr, ttlResult] = results[1];
      
      if (incrErr || ttlErr) {
        return callback((incrErr || ttlErr) as Error);
      }
      
      const current = incrResult as number;
      let ttlMs = ttlResult as number;
      
      // If key is new (no TTL set), set expiration
      if (ttlMs === -1 || ttlMs === -2) {
        await this.redis.expire(redisKey, ttl);
        ttlMs = ttl * 1000;
      }
      
      callback(null, {
        current,
        ttl: ttlMs > 0 ? Math.ceil(ttlMs / 1000) : ttl,
      });
    } catch (error) {
      callback(error as Error);
    }
  }

  /**
   * Create a child store with a new namespace
   * Used by @fastify/rate-limit for per-route stores
   */
  child(routeOptions: { routeInfo: { method: string; url: string } }): RedisRateLimitStore {
    const childNamespace = `${this.namespace}${routeOptions.routeInfo.method}:${routeOptions.routeInfo.url}:`;
    return new RedisRateLimitStore(childNamespace);
  }
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
  
  // Use custom Redis store
  redis: new RedisRateLimitStore('rl:auth:'),
  
  // Key generator: IP + email for targeted limiting
  keyGenerator: (request: FastifyRequest) => {
    const body = request.body as { email?: string } | undefined;
    const email = body?.email || 'unknown';
    const ip = request.ip || 'unknown';
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
  
  // Use custom Redis store
  redis: new RedisRateLimitStore('rl:api:'),
  
  keyGenerator: (request: FastifyRequest) => {
    return request.ip || 'unknown';
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
