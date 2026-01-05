/**
 * Idempotency Service
 * 
 * Provides idempotency key management with Redis backend and in-memory fallback.
 * Used to prevent duplicate payment processing in multi-instance deployments.
 * 
 * Features:
 * - Redis-based storage for distributed systems
 * - In-memory fallback for development/single-instance
 * - Automatic TTL management (24 hours)
 * - Graceful degradation if Redis unavailable
 */

import { logger } from './logger';

// Redis client (optional, lazy-loaded)
let Redis: any = null;
let redisClient: any = null;
let redisEnabled = false;

// Fallback in-memory storage
const inMemoryStore = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Initialize Redis client if configured
 */
export async function initializeIdempotencyService(): Promise<void> {
  // Check if Redis is enabled via environment variable
  const redisUrl = process.env.REDIS_URL;
  const redisEnabledEnv = process.env.REDIS_ENABLED?.toLowerCase();
  
  if (!redisUrl || redisEnabledEnv === 'false') {
    logger.info('[IdempotencyService] Redis not configured, using in-memory fallback');
    return;
  }

  try {
    // Dynamically import ioredis (optional dependency)
    Redis = ((await import('ioredis')) as any).default;
    
    redisClient = new Redis(redisUrl, {
      retryStrategy: (times: number) => {
        // Retry with exponential backoff up to 3 times
        if (times > 3) {
          logger.error('[IdempotencyService] Redis connection failed after 3 retries, FALLING BACK TO IN-MEMORY - Multi-instance deployments may experience issues');
          // Explicitly disable Redis to trigger fallback
          redisEnabled = false;
          return null; // Stop retrying
        }
        const delay = Math.min(times * 1000, 3000); // Max 3s delay
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    // Wait for connection
    await redisClient.ping();
    
    redisEnabled = true;
    logger.info('[IdempotencyService] Redis connected successfully');
    
    // Handle connection errors
    redisClient.on('error', (err: Error) => {
      logger.error({ err }, '[IdempotencyService] Redis error');
      // Don't disable Redis on transient errors, let retry logic handle it
    });
    
    redisClient.on('close', () => {
      logger.warn('[IdempotencyService] Redis connection closed');
    });
    
  } catch (error) {
    logger.warn({ error }, '[IdempotencyService] Failed to initialize Redis, using in-memory fallback');
    redisEnabled = false;
    redisClient = null;
  }
}

/**
 * Check if an idempotency key is already in use
 * @param key - The idempotency key to check
 * @returns true if key exists (duplicate), false if available
 */
export async function checkIdempotencyKey(key: string): Promise<boolean> {
  if (redisEnabled && redisClient) {
    try {
      const exists = await redisClient.exists(key);
      return exists === 1;
    } catch (error) {
      logger.error({ error }, '[IdempotencyService] CRITICAL: Redis check failed, falling back to in-memory - Multi-instance safety compromised');
      // Fallback to in-memory check
      return checkInMemory(key);
    }
  }
  
  return checkInMemory(key);
}

/**
 * Store an idempotency key
 * @param key - The idempotency key to store
 * @param ttlSeconds - Time to live in seconds (default: 24 hours)
 */
export async function storeIdempotencyKey(key: string, ttlSeconds: number = 86400): Promise<void> {
  if (redisEnabled && redisClient) {
    try {
      // Store with TTL
      await redisClient.setex(key, ttlSeconds, Date.now().toString());
      return;
    } catch (error) {
      logger.error({ error }, '[IdempotencyService] CRITICAL: Redis store failed, falling back to in-memory - Multi-instance safety compromised');
      // Fallback to in-memory
      storeInMemory(key);
    }
  }
  
  storeInMemory(key);
}

/**
 * Remove an idempotency key (e.g., after operation fails)
 * @param key - The idempotency key to remove
 */
export async function removeIdempotencyKey(key: string): Promise<void> {
  if (redisEnabled && redisClient) {
    try {
      await redisClient.del(key);
      return;
    } catch (error) {
      logger.error({ error }, '[IdempotencyService] Redis delete failed, falling back to in-memory');
      // Fallback to in-memory
      inMemoryStore.delete(key);
    }
  }
  
  inMemoryStore.delete(key);
}

/**
 * Clean up expired keys from in-memory store
 */
function cleanupExpiredKeys(): void {
  const now = Date.now();
  for (const [key, timestamp] of inMemoryStore.entries()) {
    if (now - timestamp >= IDEMPOTENCY_TTL_MS) {
      inMemoryStore.delete(key);
    }
  }
}

/**
 * Check in-memory store
 */
function checkInMemory(key: string): boolean {
  const timestamp = inMemoryStore.get(key);
  if (timestamp) {
    // Check if expired
    if (Date.now() - timestamp < IDEMPOTENCY_TTL_MS) {
      return true; // Key exists and not expired
    }
    // Remove expired key
    inMemoryStore.delete(key);
  }
  return false;
}

/**
 * Store in in-memory store
 */
function storeInMemory(key: string): void {
  inMemoryStore.set(key, Date.now());
  
  // Cleanup expired keys periodically (every 10 inserts to prevent memory accumulation)
  if (inMemoryStore.size % 10 === 0) {
    cleanupExpiredKeys();
  }
}

/**
 * Check if Redis is enabled
 */
export function isRedisEnabled(): boolean {
  return redisEnabled;
}

/**
 * Get service status for health checks
 */
export function getServiceStatus(): { backend: 'redis' | 'in-memory'; connected: boolean } {
  if (redisEnabled && redisClient) {
    return {
      backend: 'redis',
      connected: redisClient.status === 'ready',
    };
  }
  return {
    backend: 'in-memory',
    connected: true,
  };
}

/**
 * Gracefully close Redis connection
 */
export async function closeIdempotencyService(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
      logger.info('[IdempotencyService] Redis connection closed');
    } catch (error) {
      logger.error({ error }, '[IdempotencyService] Error closing Redis connection');
    }
  }
}
