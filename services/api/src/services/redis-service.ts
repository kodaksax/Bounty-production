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
 * - Redis Cluster support for production high availability
 */

import Redis, { Cluster } from 'ioredis';
import { config } from '../config';

/**
 * Union type covering both standalone and cluster clients
 */
type RedisClient = InstanceType<typeof Redis> | InstanceType<typeof Cluster>;

/**
 * Redis client instance (singleton)
 */
let redisClient: RedisClient | null = null;

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
 * Initialize Redis connection (standalone or cluster)
 * Called automatically on first use or can be called explicitly
 */
export async function initRedis(): Promise<RedisClient | null> {
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
    // Wait for the ongoing connection attempt to either succeed or fail
    const maxWaitMs = 5000;
    const pollIntervalMs = 100;
    const start = Date.now();

    while (isConnecting && !isConnected && Date.now() - start < maxWaitMs) {
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    // If connection succeeded, return the client; otherwise return null
    if (isConnected && redisClient) {
      return redisClient;
    }

    return null;
  }

  try {
    isConnecting = true;

    if (config.redis.cluster.enabled && config.redis.cluster.nodes.length > 0) {
      redisClient = await initRedisCluster();
    } else {
      redisClient = await initRedisStandalone();
    }

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
 * Initialize a standalone Redis connection
 */
async function initRedisStandalone(): Promise<InstanceType<typeof Redis>> {
  console.log('[Redis] Initializing standalone Redis connection...', {
    host: config.redis.host,
    port: config.redis.port,
    db: config.redis.db,
    keyPrefix: config.redis.keyPrefix,
  });

  const client = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    keyPrefix: config.redis.keyPrefix,
    retryStrategy: (times: number) => {
      const delay = Math.min(times * 50, 2000);
      console.log(`[Redis] Retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });

  attachCommonEvents(client);

  await waitForReady(client);

  console.log('[Redis] Standalone Redis connection initialized successfully');
  return client;
}

/**
 * Initialize a Redis Cluster connection
 */
async function initRedisCluster(): Promise<InstanceType<typeof Cluster>> {
  console.log('[Redis] Initializing Redis Cluster connection...', {
    nodes: config.redis.cluster.nodes,
    keyPrefix: config.redis.keyPrefix,
  });

  const clusterOptions: ConstructorParameters<typeof Cluster>[1] = {
    redisOptions: {
      password: config.redis.password || undefined,
      keyPrefix: config.redis.keyPrefix,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    },
    clusterRetryStrategy: (times: number) => {
      const delay = Math.min(times * 100, 3000);
      console.log(`[Redis Cluster] Retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    },
    enableOfflineQueue: true,
  };

  const cluster = new Cluster(config.redis.cluster.nodes, clusterOptions);

  attachCommonEvents(cluster);

  await waitForReady(cluster);

  console.log('[Redis] Redis Cluster connection initialized successfully');
  return cluster;
}

/**
 * Attach shared event listeners to a Redis or Cluster client
 */
function attachCommonEvents(client: RedisClient): void {
  client.on('connect', () => {
    console.log('[Redis] Connected to Redis server');
    isConnected = true;
    isConnecting = false;
  });

  client.on('ready', () => {
    console.log('[Redis] Redis client ready');
    isConnected = true;
  });

  client.on('error', (err: Error) => {
    console.error('[Redis] Redis client error:', err.message);
    isConnected = false;
  });

  client.on('close', () => {
    console.log('[Redis] Redis connection closed');
    isConnected = false;
  });

  client.on('reconnecting', () => {
    console.log('[Redis] Reconnecting to Redis...');
    isConnected = false;
  });
}

/**
 * Wait for a Redis/Cluster client to become ready
 */
async function waitForReady(client: RedisClient): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Redis connection timeout'));
    }, 5000);

    client.once('ready', () => {
      clearTimeout(timeout);
      resolve();
    });

    client.once('error', (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

/**
 * Get Redis client instance
 * Initializes connection if not already connected
 */
async function getRedisClient(): Promise<RedisClient | null> {
  if (!config.redis.enabled) {
    return null;
  }

  if (!redisClient || !isConnected) {
    return await initRedis();
  }

  return redisClient;
}

/**
 * Simple metrics tracking for cache operations
 */
const cacheMetrics = {
  hits: 0,
  misses: 0,
  errors: 0,
  getHitRate: () => {
    const total = cacheMetrics.hits + cacheMetrics.misses;
    return total > 0 ? (cacheMetrics.hits / total) * 100 : 0;
  },
  reset: () => {
    cacheMetrics.hits = 0;
    cacheMetrics.misses = 0;
    cacheMetrics.errors = 0;
  },
};

/**
 * Check if Redis is available and connected
 */
export function isRedisAvailable(): boolean {
  return config.redis.enabled && isConnected && redisClient !== null;
}

/**
 * Get cache metrics
 */
export function getCacheMetrics() {
  return {
    hits: cacheMetrics.hits,
    misses: cacheMetrics.misses,
    errors: cacheMetrics.errors,
    hitRate: cacheMetrics.getHitRate(),
  };
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
        cacheMetrics.misses++;
        return null;
      }

      const fullKey = keyPrefix + key;
      const value = await client.get(fullKey);
      
      if (!value) {
        cacheMetrics.misses++;
        return null;
      }

      cacheMetrics.hits++;
      return JSON.parse(value) as T;
    } catch (error) {
      cacheMetrics.errors++;
      console.error('[Redis] Error getting cache value:', error);
      // Log error for monitoring but return null for graceful degradation
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
   * Delete multiple keys matching a pattern.
   * Uses SCAN for non-blocking iteration. In cluster mode, scans every master
   * node individually since SCAN is node-local in Redis Cluster.
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

      if (client instanceof Cluster) {
        return await delPatternCluster(client, fullPattern);
      }

      return await delPatternStandalone(client, fullPattern);
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
  async getStats(): Promise<{ keys: number; memory: string; clusterEnabled: boolean } | null> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return null;
      }

      if (client instanceof Cluster) {
        // Aggregate key count across all master nodes.
        // Note: `memory` reflects a single representative master node's usage,
        // not the cluster-wide total, since `used_memory_human` is not
        // straightforwardly summable (it is a human-readable byte string).
        //
        // Each task returns its own count so we avoid the concurrent-+=
        // read-modify-write hazard that arises when multiple async tasks
        // mutate a shared variable across `await` suspension points.
        const nodes = client.nodes('master');
        let memory = 'unknown (per-node)';

        const keyCounts = await Promise.all(
          nodes.map(async (node: InstanceType<typeof Redis>) => {
            try {
              const count = await node.dbsize();
              if (memory === 'unknown (per-node)') {
                const info = await node.info('memory');
                const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
                if (memoryMatch) memory = `${memoryMatch[1].trim()} (one node)`;
              }
              return count;
            } catch {
              // Skip unreachable nodes
              return 0;
            }
          })
        );

        const totalKeys = keyCounts.reduce((sum, n) => sum + n, 0);

        return { keys: totalKeys, memory, clusterEnabled: true };
      }

      const info = await (client as InstanceType<typeof Redis>).info('memory');
      const dbsize = await (client as InstanceType<typeof Redis>).dbsize();

      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const memory = memoryMatch ? memoryMatch[1] : 'unknown';

      return { keys: dbsize, memory, clusterEnabled: false };
    } catch (error) {
      console.error('[Redis] Error getting stats:', error);
      return null;
    }
  },

  /**
   * Flush all keys in the current database (use with caution!)
   * In cluster mode, flushes each master node.
   * @returns Success status
   */
  async flushAll(): Promise<boolean> {
    try {
      const client = await getRedisClient();
      if (!client) {
        return false;
      }

      if (client instanceof Cluster) {
        const nodes = client.nodes('master');
        await Promise.all(nodes.map((node: InstanceType<typeof Redis>) => node.flushdb()));
      } else {
        await (client as InstanceType<typeof Redis>).flushdb();
      }

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
 * Delete keys matching a pattern on a standalone Redis instance
 */
async function delPatternStandalone(
  client: InstanceType<typeof Redis>,
  fullPattern: string
): Promise<number> {
  let totalDeleted = 0;

  const stream = client.scanStream({ match: fullPattern, count: 100 });

  await new Promise<void>((resolve, reject) => {
    stream.on('data', (keys: string[]) => {
      if (!keys || keys.length === 0) return;

      // Apply backpressure: pause the stream while we process this batch so
      // that deletion promises don't accumulate unboundedly and totalDeleted
      // is incremented in the correct order.
      stream.pause();

      const keysWithoutGlobalPrefix = keys.map((k: string) =>
        k.startsWith(config.redis.keyPrefix) ? k.slice(config.redis.keyPrefix.length) : k
      );

      if (keysWithoutGlobalPrefix.length > 0) {
        client
          .del(...keysWithoutGlobalPrefix)
          .then(() => {
            totalDeleted += keys.length;
            stream.resume();
          })
          .catch((err: Error) => {
            // Destroying the stream will emit 'error' and reject the outer promise
            stream.destroy(err);
          });
      } else {
        // Nothing to delete after stripping prefixes; resume scanning
        stream.resume();
      }
    });

    stream.on('end', () => resolve());
    stream.on('error', (err: Error) => reject(err));
  });

  return totalDeleted;
}

/**
 * Delete keys matching a pattern across all master nodes in a Redis Cluster.
 * SCAN is node-local in cluster mode, so we must scan each master individually.
 * Uses Promise.allSettled so that a failure on one node does not prevent other
 * nodes from completing their scans and deletions.
 */
async function delPatternCluster(cluster: InstanceType<typeof Cluster>, fullPattern: string): Promise<number> {
  const nodes = cluster.nodes('master');
  let totalDeleted = 0;

  const results = await Promise.allSettled(
    nodes.map(async (node: InstanceType<typeof Redis>) => {
      const keysToDelete: string[] = [];
      const stream = node.scanStream({ match: fullPattern, count: 100 });

      await new Promise<void>((resolve, reject) => {
        stream.on('data', (keys: string[]) => {
          if (keys && keys.length > 0) keysToDelete.push(...keys);
        });
        stream.on('end', () => resolve());
        stream.on('error', (err: Error) => reject(err));
      });

      if (keysToDelete.length > 0) {
        const keysWithoutGlobalPrefix = keysToDelete.map((k: string) =>
          k.startsWith(config.redis.keyPrefix) ? k.slice(config.redis.keyPrefix.length) : k
        );
        try {
          await node.del(...keysWithoutGlobalPrefix);
          return keysToDelete.length;
        } catch (err) {
          console.error('[Redis Cluster] Failed to delete keys on node:', err);
          return 0;
        }
      }

      return 0;
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      totalDeleted += result.value;
    } else {
      console.error('[Redis Cluster] Node scan failed:', result.reason);
    }
  }

  return totalDeleted;
}

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

