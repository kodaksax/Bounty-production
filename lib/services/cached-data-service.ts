/**
 * Cached Data Service
 * Provides offline-first data access with automatic cache management
 * Enhanced to support bounties, messages, profiles, and other app data
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { logger } from '../utils/error-logger';

const CACHE_PREFIX = 'cache_v1_';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Cache keys for common data types
export const CACHE_KEYS = {
  BOUNTIES_LIST: 'bounties_list',
  BOUNTY_DETAIL: (id: string | number) => `bounty_${id}`,
  CONVERSATIONS_LIST: 'conversations_list',
  CONVERSATION_MESSAGES: (id: string) => `conversation_${id}_messages`,
  USER_PROFILE: (id: string) => `user_profile_${id}`,
  MY_BOUNTIES: 'my_bounties',
  MY_REQUESTS: 'my_requests',
} as const;

export interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export interface CacheOptions {
  ttl?: number; // Time to live in milliseconds
  forceRefresh?: boolean;
}

class CachedDataService {
  private isOnline = true;
  private memoryCache = new Map<string, CacheEntry<any>>();

  constructor() {
    // Listen for network state changes
    NetInfo.addEventListener(state => {
      this.isOnline = !!state.isConnected;
    });
  }

  /**
   * Get cache key for a resource
   */
  private getCacheKey(key: string): string {
    return `${CACHE_PREFIX}${key}`;
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry<any>): boolean {
    return Date.now() > entry.expiresAt;
  }

  /**
   * Get data from cache (memory first, then AsyncStorage)
   */
  async getFromCache<T>(key: string): Promise<T | null> {
    try {
      // Check memory cache first
      const memEntry = this.memoryCache.get(key);
      if (memEntry && !this.isExpired(memEntry)) {
        logger.info(`Cache hit (memory): ${key}`);
        return memEntry.data;
      }

      // Check AsyncStorage
      const cacheKey = this.getCacheKey(key);
      const stored = await AsyncStorage.getItem(cacheKey);
      
      if (stored) {
        const entry: CacheEntry<T> = JSON.parse(stored);
        
        if (!this.isExpired(entry)) {
          // Update memory cache
          this.memoryCache.set(key, entry);
          logger.info(`Cache hit (storage): ${key}`);
          return entry.data;
        } else {
          // Remove expired entry
          await AsyncStorage.removeItem(cacheKey);
          this.memoryCache.delete(key);
          logger.info(`Cache expired: ${key}`);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error reading from cache', { key, error });
      return null;
    }
  }

  /**
   * Store data in cache
   */
  async setCache<T>(
    key: string,
    data: T,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const ttl = options.ttl || CACHE_EXPIRY_MS;
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttl,
      };

      // Update memory cache
      this.memoryCache.set(key, entry);

      // Update AsyncStorage
      const cacheKey = this.getCacheKey(key);
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));
      
      logger.info(`Cache updated: ${key}`);
    } catch (error) {
      logger.error('Error writing to cache', { key, error });
    }
  }

  /**
   * Fetch data with automatic caching
   * Returns cached data if offline or if cache is fresh
   */
  async fetchWithCache<T>(
    key: string,
    fetchFn: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const { forceRefresh = false } = options;

    // If offline, return cached data
    if (!this.isOnline && !forceRefresh) {
      const cached = await this.getFromCache<T>(key);
      if (cached !== null) {
        logger.info(`Using cached data (offline): ${key}`);
        return cached;
      }
      throw new Error('No cached data available and device is offline');
    }

    // If online, try to fetch fresh data
    try {
      // If not forcing refresh, check cache first
      if (!forceRefresh) {
        const cached = await this.getFromCache<T>(key);
        if (cached !== null) {
          // Return cached data but fetch in background to update cache
          fetchFn()
            .then(data => this.setCache(key, data, options))
            .catch(err => logger.error('Background cache update failed', { key, error: err }));
          
          logger.info(`Using cached data (stale-while-revalidate): ${key}`);
          return cached;
        }
      }

      // Fetch fresh data
      const data = await fetchFn();
      await this.setCache(key, data, options);
      return data;
    } catch (error) {
      // If fetch fails, try to return cached data as fallback
      const cached = await this.getFromCache<T>(key);
      if (cached !== null) {
        logger.warning(`Fetch failed, using cached data: ${key}`, { error });
        return cached;
      }
      
      throw error;
    }
  }

  /**
   * Invalidate cache entry
   */
  async invalidate(key: string): Promise<void> {
    try {
      this.memoryCache.delete(key);
      const cacheKey = this.getCacheKey(key);
      await AsyncStorage.removeItem(cacheKey);
      logger.info(`Cache invalidated: ${key}`);
    } catch (error) {
      logger.error('Error invalidating cache', { key, error });
    }
  }

  /**
   * Clear all cached data
   */
  async clearAll(): Promise<void> {
    try {
      this.memoryCache.clear();
      
      // Get all keys and remove cache entries
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(k => k.startsWith(CACHE_PREFIX));
      await AsyncStorage.multiRemove(cacheKeys);
      
      logger.info(`Cleared ${cacheKeys.length} cache entries`);
    } catch (error) {
      logger.error('Error clearing cache', { error });
    }
  }

  /**
   * Clear cache for specific patterns (e.g., all bounties)
   */
  async clearPattern(pattern: string): Promise<void> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const matchingKeys = allKeys.filter(k => 
        k.startsWith(CACHE_PREFIX) && k.includes(pattern)
      );
      
      // Clear from memory cache
      for (const key of this.memoryCache.keys()) {
        if (key.includes(pattern)) {
          this.memoryCache.delete(key);
        }
      }
      
      // Clear from storage
      await AsyncStorage.multiRemove(matchingKeys);
      
      logger.info(`Cleared ${matchingKeys.length} cache entries matching pattern: ${pattern}`);
    } catch (error) {
      logger.error('Error clearing cache pattern', { pattern, error });
    }
  }

  /**
   * Preload critical data for offline use
   */
  async preloadData<T>(
    items: Array<{ key: string; fetchFn: () => Promise<T>; ttl?: number }>
  ): Promise<void> {
    try {
      const results = await Promise.allSettled(
        items.map(({ key, fetchFn, ttl }) => 
          this.fetchWithCache(key, fetchFn, { ttl })
        )
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      logger.info(`Preloaded ${successful}/${items.length} cache items`);
    } catch (error) {
      logger.error('Error preloading data', { error });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    memoryCacheSize: number;
    storageCacheSize: number;
    isOnline: boolean;
  }> {
    try {
      const allKeys = await AsyncStorage.getAllKeys();
      const cacheKeys = allKeys.filter(k => k.startsWith(CACHE_PREFIX));
      
      return {
        memoryCacheSize: this.memoryCache.size,
        storageCacheSize: cacheKeys.length,
        isOnline: this.isOnline,
      };
    } catch (error) {
      logger.error('Error getting cache stats', { error });
      return {
        memoryCacheSize: this.memoryCache.size,
        storageCacheSize: 0,
        isOnline: this.isOnline,
      };
    }
  }

  /**
   * Check if device is online
   */
  getOnlineStatus(): boolean {
    return this.isOnline;
  }
}

// Export singleton instance
export const cachedDataService = new CachedDataService();
