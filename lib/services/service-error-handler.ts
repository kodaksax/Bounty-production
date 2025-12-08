/**
 * Service Error Handler
 * Provides consistent error handling for all service layer operations
 * Wraps async operations with try/catch and returns UserFriendlyError
 */

import { getUserFriendlyError, type UserFriendlyError } from '../utils/error-messages';
import { logger } from '../utils/error-logger';

/**
 * Result type for service operations
 * Either successful with data, or failed with user-friendly error
 */
export type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; error: UserFriendlyError };

/**
 * Options for service error handler
 */
export interface ServiceErrorHandlerOptions {
  /**
   * Operation name for logging (e.g., 'fetchBounties', 'createPayment')
   */
  operation: string;
  
  /**
   * Additional context for error logging
   */
  context?: Record<string, any>;
  
  /**
   * Whether this operation should be retried on failure
   */
  retryable?: boolean;
  
  /**
   * Custom error handler - called before returning error
   */
  onError?: (error: Error) => void;
}

/**
 * Wraps an async service operation with error handling
 * Automatically converts errors to user-friendly format
 * 
 * @example
 * ```ts
 * const result = await handleServiceError(
 *   async () => {
 *     const response = await fetch('/api/bounties');
 *     return await response.json();
 *   },
 *   { operation: 'fetchBounties', retryable: true }
 * );
 * 
 * if (result.success) {
 *   // Use result.data
 * } else {
 *   // Show result.error to user
 * }
 * ```
 */
export async function handleServiceError<T>(
  operation: () => Promise<T>,
  options: ServiceErrorHandlerOptions
): Promise<ServiceResult<T>> {
  try {
    const data = await operation();
    return { success: true, data };
  } catch (error) {
    // Log the error
    logger.error(`Service error in ${options.operation}`, {
      error: error instanceof Error ? error.message : String(error),
      ...options.context,
    });

    // Call custom error handler if provided
    if (options.onError && error instanceof Error) {
      try {
        options.onError(error);
      } catch (handlerError) {
        logger.error('Error in custom error handler', {
          operation: options.operation,
          error: handlerError,
        });
      }
    }

    // Convert to user-friendly error
    const userFriendlyError = getUserFriendlyError(error);
    
    // Override retryable if specified
    if (options.retryable !== undefined) {
      userFriendlyError.retryable = options.retryable;
    }

    return {
      success: false,
      error: userFriendlyError,
    };
  }
}

/**
 * Wraps a sync operation with error handling
 * For operations that don't return promises
 */
export function handleServiceErrorSync<T>(
  operation: () => T,
  options: ServiceErrorHandlerOptions
): ServiceResult<T> {
  try {
    const data = operation();
    return { success: true, data };
  } catch (error) {
    // Log the error
    logger.error(`Service error in ${options.operation}`, {
      error: error instanceof Error ? error.message : String(error),
      ...options.context,
    });

    // Call custom error handler if provided
    if (options.onError && error instanceof Error) {
      try {
        options.onError(error);
      } catch (handlerError) {
        logger.error('Error in custom error handler', {
          operation: options.operation,
          error: handlerError,
        });
      }
    }

    // Convert to user-friendly error
    const userFriendlyError = getUserFriendlyError(error);
    
    // Override retryable if specified
    if (options.retryable !== undefined) {
      userFriendlyError.retryable = options.retryable;
    }

    return {
      success: false,
      error: userFriendlyError,
    };
  }
}

/**
 * Retry an operation with exponential backoff
 * 
 * @param operation - The operation to retry
 * @param options - Retry options
 * @returns Result of the operation
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
    backoffMultiplier?: number;
    onRetry?: (attempt: number, error: Error) => void;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    backoffMultiplier = 2,
    onRetry,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Call retry callback
      if (onRetry) {
        onRetry(attempt, lastError);
      }

      // Calculate backoff delay
      const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All attempts failed
  throw lastError || new Error('Operation failed after retries');
}

/**
 * Check if an error is retryable based on its type
 */
export function isRetryableError(error: any): boolean {
  // Network errors are retryable
  if (
    error?.message?.includes('Network request failed') ||
    error?.message?.includes('Failed to fetch') ||
    error?.message?.includes('timeout') ||
    error?.code === 'ECONNREFUSED' ||
    error?.code === 'ENOTFOUND' ||
    error?.code === 'ETIMEDOUT'
  ) {
    return true;
  }

  // Rate limit errors are retryable (after delay)
  if (error?.status === 429) {
    return true;
  }

  // Server errors might be transient
  if (error?.status >= 500) {
    return true;
  }

  // Default to not retryable
  return false;
}
