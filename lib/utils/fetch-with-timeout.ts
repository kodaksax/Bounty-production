/**
 * Fetch utility with timeout and retry support
 * 
 * Provides configurable timeout and exponential backoff retry logic
 * for network requests to handle poor connectivity gracefully.
 */

import { API_TIMEOUTS } from '../config/network';

export interface FetchWithTimeoutOptions extends RequestInit {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  retryOn?: (response: Response | null, error: Error | null) => boolean;
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds max
  backoffMultiplier: 2,
};

/**
 * Calculate exponential backoff delay with jitter
 */
function calculateBackoff(attempt: number, config: RetryConfig): number {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  const delay = Math.min(exponentialDelay, config.maxDelay);
  // Add jitter (±25% random variation)
  const jitter = delay * 0.25 * (Math.random() - 0.5) * 2;
  return Math.max(0, delay + jitter);
}

/**
 * Default retry logic: retry on network errors and 5xx server errors
 */
function shouldRetryDefault(response: Response | null, error: Error | null): boolean {
  // Retry on network errors (no response)
  if (error) {
    // Retry on timeout, network, and abort errors
    if (error.name === 'AbortError' || 
        error.message.includes('timeout') ||
        error.message.includes('network') ||
        error.message.includes('fetch')) {
      return true;
    }
  }
  
  // Retry on 5xx server errors and 429 (rate limit)
  if (response && (response.status >= 500 || response.status === 429)) {
    return true;
  }
  
  return false;
}

/**
 * Fetch with configurable timeout and automatic retries
 * 
 * @param url - URL to fetch
 * @param options - Fetch options with timeout and retry configuration
 * @returns Promise resolving to Response
 * @throws Error if all retries fail or timeout occurs
 */
export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const {
    timeout = API_TIMEOUTS.DEFAULT,
    retries = DEFAULT_RETRY_CONFIG.maxRetries,
    retryDelay = DEFAULT_RETRY_CONFIG.baseDelay,
    retryOn = shouldRetryDefault,
    ...fetchOptions
  } = options;

  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: retries,
    baseDelay: retryDelay,
  };

  let lastError: Error | null = null;
  let lastResponse: Response | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastResponse = response;
        lastError = null;

        // Check if we should retry based on response
        if (attempt < retryConfig.maxRetries && retryOn(response, null)) {
          const delay = calculateBackoff(attempt, retryConfig);
          console.log(`[fetchWithTimeout] Retrying request to ${url} after ${delay}ms (attempt ${attempt + 1}/${retryConfig.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        return response;
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    } catch (error: any) {
      lastError = error;
      lastResponse = null;

      // Convert AbortError to timeout error for clarity
      if (error.name === 'AbortError') {
        lastError = new Error(`Network request timed out after ${timeout}ms`);
        lastError.name = 'TimeoutError';
      }

      // Check if we should retry based on error
      if (attempt < retryConfig.maxRetries && retryOn(null, lastError)) {
        const delay = calculateBackoff(attempt, retryConfig);
        console.log(`[fetchWithTimeout] Retrying request to ${url} after ${delay}ms due to error: ${lastError.message} (attempt ${attempt + 1}/${retryConfig.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // No more retries, throw the error
      throw lastError;
    }
  }

  // Should not reach here, but handle edge case
  throw lastError || new Error('Request failed after all retries');
}

/**
 * Fetch with timeout (no retries)
 * Useful when you want timeout protection but not retry logic
 */
export async function fetchWithTimeoutOnly(
  url: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<Response> {
  const { timeout = API_TIMEOUTS.DEFAULT, ...fetchOptions } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    
    // Convert AbortError to timeout error for clarity
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Network request timed out after ${timeout}ms`);
      timeoutError.name = 'TimeoutError';
      throw timeoutError;
    }
    
    throw error;
  }
}
