/**
 * Centralized utility for throttling log messages
 * Prevents console spam by ensuring logs only appear at most once per interval
 */

interface ThrottleEntry {
  lastLog: number;
  interval: number;
}

// Global registry of throttled log keys
const throttleRegistry = new Map<string, ThrottleEntry>();

/**
 * Check if a log message should be displayed based on throttling rules
 * 
 * @param key - Unique identifier for this log message type
 * @param intervalMs - Minimum time in milliseconds between log messages
 * @returns true if the message should be logged, false if it should be suppressed
 * 
 * @example
 * if (shouldLog('websocket-error', 60000)) {
 *   console.log('WebSocket error occurred');
 * }
 */
export function shouldLog(key: string, intervalMs: number): boolean {
  const now = Date.now();
  const entry = throttleRegistry.get(key);
  
  if (!entry) {
    // First time logging this message type
    throttleRegistry.set(key, { lastLog: now, interval: intervalMs });
    return true;
  }
  
  const timeSinceLastLog = now - entry.lastLog;
  
  if (timeSinceLastLog >= entry.interval) {
    // Enough time has passed, allow logging
    entry.lastLog = now;
    return true;
  }
  
  // Suppress this log
  return false;
}

/**
 * Reset throttle state for a specific log key
 * Useful for testing or when you want to force a log to appear
 * 
 * @param key - Unique identifier for the log message type
 */
export function resetThrottle(key: string): void {
  throttleRegistry.delete(key);
}

/**
 * Clear all throttle state
 * Useful for testing or cleanup
 */
export function clearAllThrottles(): void {
  throttleRegistry.clear();
}

/**
 * Get the time remaining until a log message can be displayed again
 * 
 * @param key - Unique identifier for the log message type
 * @returns milliseconds until next log is allowed, or 0 if logging is allowed now
 */
export function getTimeUntilNextLog(key: string): number {
  const entry = throttleRegistry.get(key);
  if (!entry) return 0;
  
  const now = Date.now();
  const timeSinceLastLog = now - entry.lastLog;
  const remaining = entry.interval - timeSinceLastLog;
  
  return Math.max(0, remaining);
}

// Predefined throttle intervals for common scenarios
export const THROTTLE_INTERVALS = {
  /** 1 minute - for frequent errors like network timeouts */
  FREQUENT: 60 * 1000,
  
  /** 5 minutes - for recurring issues that don't need frequent notification */
  MODERATE: 5 * 60 * 1000,
  
  /** 15 minutes - for rare or low-priority issues */
  RARE: 15 * 60 * 1000,
  
  /** 1 hour - for informational messages that shouldn't spam */
  INFORMATIONAL: 60 * 60 * 1000,
} as const;

// Predefined log keys for consistency across the codebase
export const LOG_KEYS = {
  WS_ERROR: 'websocket-error',
  WS_CONNECT_ERROR: 'websocket-connect-error',
  WS_MAX_ATTEMPTS: 'websocket-max-attempts',
  NOTIF_UNREAD_ERROR: 'notification-unread-count-error',
  NOTIF_FETCH_ERROR: 'notification-fetch-error',
  API_TIMEOUT: 'api-timeout-error',
} as const;
