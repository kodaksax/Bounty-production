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
  // Add jitter (±25% random variation) - simplified calculation
  const jitter = delay * (Math.random() - 0.5) * 0.5;
  return Math.max(0, delay + jitter);
}

/**
 * Default retry logic: retry on network errors and 5xx server errors
 */
function shouldRetryDefault(response: Response | null, error: Error | null): boolean {
  // Retry on network errors (no response)
  if (error) {
    // Normalize message for case-insensitive matching (catches "Network request failed", etc.)
    const message = error.message.toLowerCase();
    
    // Retry on timeout, network, and abort errors
    if (error.name === 'AbortError' || 
        message.includes('timeout') ||
        message.includes('network') ||
        message.includes('fetch')) {
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
 * 
 * Note: retries parameter is the number of ADDITIONAL attempts after the initial request.
 * For example, retries: 2 means 3 total attempts (1 initial + 2 retries).
 * 
 * If options.signal is provided, the request can be cancelled externally in addition
 * to the internal timeout. Both signals will trigger cancellation.
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
    signal: externalSignal,
    ...fetchOptions
  } = options;

  const retryConfig: RetryConfig = {
    ...DEFAULT_RETRY_CONFIG,
    maxRetries: retries,
    baseDelay: retryDelay,
  };

  let lastError: Error | null = null;

  // Total attempts = initial + retries (e.g., retries: 2 means 3 total attempts)
  const totalAttempts = retryConfig.maxRetries + 1;
  
  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    try {
      // Create abort controller for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, timeout);

      // If external signal provided, wire it to abort internal controller
      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      try {
        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        lastError = null;

        // Check if we should retry based on response
        const isLastAttempt = attempt === totalAttempts - 1;
        if (!isLastAttempt && retryOn(response, null)) {
          const delay = calculateBackoff(attempt, retryConfig);
          // Only log retry attempts in development to avoid noise and potential URL leakage
          if (__DEV__) {
            // Redact query params to avoid leaking sensitive data
            const redactedUrl = url.split('?')[0];
            console.log(`[fetchWithTimeout] Retrying request to ${redactedUrl} after ${delay}ms (attempt ${attempt + 1}/${totalAttempts - 1} retries)`);
          }
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

      // Convert AbortError to timeout error for clarity, preserving original error
      if (error.name === 'AbortError') {
        const timeoutError: Error & { cause?: unknown } = new Error(
          `Network request timed out after ${timeout}ms`
        );
        timeoutError.name = 'TimeoutError';
        timeoutError.cause = error; // Preserve original error for debugging
        lastError = timeoutError;
      }

      // Check if we should retry based on error
      const isLastAttempt = attempt === totalAttempts - 1;
      if (!isLastAttempt && retryOn(null, lastError)) {
        const delay = calculateBackoff(attempt, retryConfig);
        // Only log retry attempts in development
        if (__DEV__) {
          const redactedUrl = url.split('?')[0];
          console.log(`[fetchWithTimeout] Retrying request to ${redactedUrl} after ${delay}ms due to error: ${lastError.message} (attempt ${attempt + 1}/${totalAttempts - 1} retries)`);
        }
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
