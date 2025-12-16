/**
 * Network configuration constants
 * Centralized configuration for timeouts, retry strategies, and connection settings
 */

/**
 * API request timeout configurations
 */
export const API_TIMEOUTS = {
  /** Standard timeout for API requests (15 seconds) */
  DEFAULT: 15000,
  
  /** Shorter timeout for quick operations (5 seconds) */
  QUICK: 5000,
  
  /** Longer timeout for file uploads or heavy operations (30 seconds) */
  LONG: 30000,
  
  /** Very long timeout for background sync operations (60 seconds) */
  BACKGROUND: 60000,
} as const;

/**
 * WebSocket connection configuration
 */
export const WEBSOCKET_CONFIG = {
  /** Maximum number of reconnection attempts before giving up */
  MAX_RECONNECT_ATTEMPTS: __DEV__ ? 5 : 10,
  
  /** Initial delay between reconnection attempts (milliseconds) */
  INITIAL_RECONNECT_DELAY: __DEV__ ? 2000 : 1000,
  
  /** Minimum time a connection must be stable to reset retry counter (milliseconds) */
  MIN_STABLE_CONNECTION_MS: 5000,
  
  /** Interval for sending heartbeat pings (milliseconds) */
  PING_INTERVAL_MS: 20000,
  
  /** Maximum time without a pong before considering connection stale (milliseconds) */
  MAX_PONG_DELAY_MS: 40000, // 2x ping interval
} as const;

/**
 * Error logging throttle intervals
 */
export const ERROR_LOG_THROTTLE = {
  /** Frequent errors (e.g., connection failures) - 1 minute */
  FREQUENT: 60 * 1000,
  
  /** Moderate errors (e.g., API timeouts) - 5 minutes */
  MODERATE: 5 * 60 * 1000,
  
  /** Rare errors (e.g., max attempts reached) - 5 minutes */
  RARE: 5 * 60 * 1000,
} as const;

/**
 * Cache expiration times
 */
export const CACHE_EXPIRATION = {
  /** Notifications cache - 1 hour */
  NOTIFICATIONS: 60 * 60 * 1000,
  
  /** User profile cache - 30 minutes */
  PROFILE: 30 * 60 * 1000,
  
  /** Unread count cache - 5 minutes */
  UNREAD_COUNT: 5 * 60 * 1000,
} as const;

/**
 * Network retry strategies
 */
export const RETRY_STRATEGY = {
  /** Exponential backoff multiplier */
  BACKOFF_MULTIPLIER: 2,
  
  /** Maximum delay between retries (30 seconds) */
  MAX_DELAY_MS: 30000,
  
  /** Whether to use jitter in retry delays */
  USE_JITTER: true,
} as const;

/**
 * Calculate the next retry delay using exponential backoff
 * 
 * @param attemptNumber - Current attempt number (0-indexed)
 * @param baseDelay - Base delay in milliseconds
 * @returns Next retry delay in milliseconds
 */
export function calculateRetryDelay(
  attemptNumber: number,
  baseDelay: number = WEBSOCKET_CONFIG.INITIAL_RECONNECT_DELAY
): number {
  const exponentialDelay = baseDelay * Math.pow(RETRY_STRATEGY.BACKOFF_MULTIPLIER, attemptNumber);
  
  // Apply jitter if enabled (±25% random variation)
  if (RETRY_STRATEGY.USE_JITTER) {
    const jitter = exponentialDelay * 0.25 * (Math.random() - 0.5) * 2;
    return Math.min(exponentialDelay + jitter, RETRY_STRATEGY.MAX_DELAY_MS);
  }
  
  return Math.min(exponentialDelay, RETRY_STRATEGY.MAX_DELAY_MS);
}

/**
 * Check if we should use verbose logging based on environment
 */
export function isVerboseLogging(): boolean {
  return process.env.EXPO_PUBLIC_WS_VERBOSE === '1' || 
         process.env.EXPO_PUBLIC_LOG_CLIENT_VERBOSE === '1';
}
