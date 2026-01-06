/**
 * Redis Cache Service
 * Provides caching functionality for profiles, bounties, and other frequently accessed data
 * 
 * Features:
 * - Connection management with automatic reconnection
 * - Type-safe cache operations
 * - TTL configuration per resource type
 * - Error handling with graceful fallbacks
 * - Cache invalidation utilities
 */

import Redis from 'ioredis';
import { config } from '../config';

/**
 * Redis client instance (singleton)
 */
let redisClient: Redis | null = null;

/**
 * Connection state tracking
 */
let isConnected = false;
let isConnecting = false;

/**
 * Cache key prefixes for different resource types
 */
export const CacheKeyPrefix = {
  PROFILE: 'profile:',
  BOUNTY: 'bounty:',
  BOUNTY_LIST: 'bounty:list:',
} as const;

/**
 * Initialize Redis connection
 * Called automatically on first use or can be called explicitly
 */
export async function initRedis(): Promise<Redis | null> {
  // Return early if Redis is disabled
  if (!config.redis.enabled) {
    console.log('[Redis] Redis caching is disabled in configuration');
    return null;
  }

  // Return existing client if already connected
  if (redisClient && isConnected) {
    return redisClient;
  }

  // Prevent multiple simultaneous connection attempts
  if (isConnecting) {
    console.log('[Redis] Connection already in progress, waiting...');
    // Wait for existing connection attempt
    await new Promise(resolve => setTimeout(resolve, 1000));
    return redisClient;
  }

  try {
    isConnecting = true;
    console.log('[Redis] Initializing Redis connection...', {
      host: config.redis.host,
      port: config.redis.port,
      db: config.redis.db,
      keyPrefix: config.redis.keyPrefix,
    });

    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      keyPrefix: config.redis.keyPrefix,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`[Redis] Retry attempt ${times}, waiting ${delay}ms`);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    // Handle connection events
    redisClient.on('connect', () => {
      console.log('[Redis] Connected to Redis server');
      isConnected = true;
      isConnecting = false;
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Redis client ready');
      isConnected = true;
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Redis client error:', err.message);
      isConnected = false;
    });

    redisClient.on('close', () => {
      console.log('[Redis] Redis connection closed');
      isConnected = false;
    });

    redisClient.on('reconnecting', () => {
      console.log('[Redis] Reconnecting to Redis...');
      isConnected = false;
    });

    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      redisClient!.once('ready', () => {
        clearTimeout(timeout);
        resolve(true);
      });

      redisClient!.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    console.log('[Redis] Redis connection initialized successfully');
    return redisClient;

  } catch (error) {
    console.error('[Redis] Failed to initialize Redis:', error);
    isConnecting = false;
    isConnected = false;
    redisClient = null;
    
    // Don't throw - allow application to continue without cache
    return null;
  }
}

/**
 * Get Redis client instance
 * Initializes connection if not already connected
 */
async function getRedisClient(): Promise<Redis | null> {
  if (!config.redis.enabled) {
    return null;
  }

  if (!redisClient || !isConnected) {
    return await initRedis();
  }

  return redisClient;
}

/**
 * Check if Redis is available and connected
 */
export function isRedisAvailable(): boolean {
  return config.redis.enabled && isConnected && redisClient !== null;
}

/**
 * Cache service interface
 */
export const redisService = {
  /**
   * Get value from cache
   * @param key - Cache key (without prefix)
   * @param keyPrefix - Key prefix (e.g., CacheKeyPrefix.PROFILE)
   * @returns Parsed value or null if not found/error
   */
  async get<T>(key: string, keyPrefix: string = ''): Promise<T | null> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return null;
      }

      const fullKey = keyPrefix + key;
      const value = await client.get(fullKey);
      
      if (!value) {
        return null;
      }

      return JSON.parse(value) as T;
    } catch (error) {
      console.error('[Redis] Error getting cache value:', error);
      return null;
    }
  },

  /**
   * Set value in cache with TTL
   * @param key - Cache key (without prefix)
   * @param value - Value to cache
   * @param keyPrefix - Key prefix (e.g., CacheKeyPrefix.PROFILE)
   * @param ttl - Time to live in seconds (optional, uses default if not provided)
   * @returns Success status
   */
  async set(
    key: string,
    value: any,
    keyPrefix: string = '',
    ttl?: number
  ): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      const fullKey = keyPrefix + key;
      const serialized = JSON.stringify(value);

      if (ttl) {
        await client.setex(fullKey, ttl, serialized);
      } else {
        // Default TTL based on key prefix
        const defaultTtl = getDefaultTTL(keyPrefix);
        await client.setex(fullKey, defaultTtl, serialized);
      }

      return true;
    } catch (error) {
      console.error('[Redis] Error setting cache value:', error);
      return false;
    }
  },

  /**
   * Delete value from cache
   * @param key - Cache key (without prefix)
   * @param keyPrefix - Key prefix (e.g., CacheKeyPrefix.PROFILE)
   * @returns Success status
   */
  async del(key: string, keyPrefix: string = ''): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      const fullKey = keyPrefix + key;
      await client.del(fullKey);
      return true;
    } catch (error) {
      console.error('[Redis] Error deleting cache value:', error);
      return false;
    }
  },

  /**
   * Delete multiple keys matching a pattern
   * @param pattern - Pattern to match (without prefix)
   * @param keyPrefix - Key prefix (e.g., CacheKeyPrefix.BOUNTY_LIST)
   * @returns Number of keys deleted
   */
  async delPattern(pattern: string, keyPrefix: string = ''): Promise<number> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return 0;
      }

      const fullPattern = config.redis.keyPrefix + keyPrefix + pattern;
      const keys = await client.keys(fullPattern);
      
      if (keys.length === 0) {
        return 0;
      }

      // Remove the global prefix from keys before deletion
      // since ioredis client already includes it
      const keysWithoutGlobalPrefix = keys.map(k => 
        k.startsWith(config.redis.keyPrefix) 
          ? k.slice(config.redis.keyPrefix.length) 
          : k
      );

      await client.del(...keysWithoutGlobalPrefix);
      return keys.length;
    } catch (error) {
      console.error('[Redis] Error deleting pattern:', error);
      return 0;
    }
  },

  /**
   * Check if key exists in cache
   * @param key - Cache key (without prefix)
   * @param keyPrefix - Key prefix (e.g., CacheKeyPrefix.PROFILE)
   * @returns True if key exists
   */
  async exists(key: string, keyPrefix: string = ''): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      const fullKey = keyPrefix + key;
      const result = await client.exists(fullKey);
      return result === 1;
    } catch (error) {
      console.error('[Redis] Error checking key existence:', error);
      return false;
    }
  },

  /**
   * Set expiration time for a key
   * @param key - Cache key (without prefix)
   * @param keyPrefix - Key prefix
   * @param seconds - TTL in seconds
   * @returns Success status
   */
  async expire(key: string, keyPrefix: string = '', seconds: number): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      const fullKey = keyPrefix + key;
      await client.expire(fullKey, seconds);
      return true;
    } catch (error) {
      console.error('[Redis] Error setting expiration:', error);
      return false;
    }
  },

  /**
   * Get cache statistics
   * @returns Cache stats or null if unavailable
   */
  async getStats(): Promise<{ keys: number; memory: string } | null> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return null;
      }

      const info = await client.info('memory');
      const dbsize = await client.dbsize();
      
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memory = memoryMatch ? memoryMatch[1] : 'unknown';

      return {
        keys: dbsize,
        memory,
      };
    } catch (error) {
      console.error('[Redis] Error getting stats:', error);
      return null;
    }
  },

  /**
   * Flush all keys in the current database (use with caution!)
   * @returns Success status
   */
  async flushAll(): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      await client.flushdb();
      console.log('[Redis] Cache flushed successfully');
      return true;
    } catch (error) {
      console.error('[Redis] Error flushing cache:', error);
      return false;
    }
  },

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    try {
      if (redisClient) {
        await redisClient.quit();
        redisClient = null;
        isConnected = false;
        console.log('[Redis] Connection closed');
      }
    } catch (error) {
      console.error('[Redis] Error closing connection:', error);
    }
  },
};

/**
 * Get default TTL based on key prefix
 */
function getDefaultTTL(keyPrefix: string): number {
  switch (keyPrefix) {
    case CacheKeyPrefix.PROFILE:
      return config.redis.ttl.profile;
    case CacheKeyPrefix.BOUNTY:
      return config.redis.ttl.bounty;
    case CacheKeyPrefix.BOUNTY_LIST:
      return config.redis.ttl.bountyList;
    default:
      return 300; // 5 minutes default
  }
}

/**
 * Cache invalidation helpers for specific resources
 */
export const cacheInvalidation = {
  /**
   * Invalidate profile cache
   */
  async invalidateProfile(profileId: string): Promise<void> {
    await redisService.del(profileId, CacheKeyPrefix.PROFILE);
    console.log(`[Redis] Invalidated profile cache: ${profileId}`);
  },

  /**
   * Invalidate bounty cache
   */
  async invalidateBounty(bountyId: string): Promise<void> {
    await redisService.del(bountyId, CacheKeyPrefix.BOUNTY);
    console.log(`[Redis] Invalidated bounty cache: ${bountyId}`);
  },

  /**
   * Invalidate all bounty list caches
   * Should be called when a bounty is created, updated, or status changes
   */
  async invalidateBountyLists(): Promise<void> {
    const deleted = await redisService.delPattern('*', CacheKeyPrefix.BOUNTY_LIST);
    console.log(`[Redis] Invalidated ${deleted} bounty list cache entries`);
  },

  /**
   * Invalidate all caches related to a user's bounties
   */
  async invalidateUserBounties(userId: string): Promise<void> {
    await redisService.delPattern(`*user:${userId}*`, CacheKeyPrefix.BOUNTY_LIST);
    console.log(`[Redis] Invalidated bounty list caches for user: ${userId}`);
  },
};

// Initialize Redis on module load
if (config.redis.enabled) {
  initRedis().catch(err => {
    console.error('[Redis] Failed to initialize on startup:', err.message);
  });
}

export default redisService;
