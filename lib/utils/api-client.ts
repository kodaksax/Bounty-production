/**
 * API Client with error handling and rate limit support
 */

import { getUserFriendlyError, type UserFriendlyError } from './error-messages';
import { logger } from './error-logger';

export interface ApiResponse<T> {
  data?: T;
  error?: UserFriendlyError;
  status: number;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: any;
  timeout?: number;
}

/**
 * Make an API request with automatic error handling
 */
export async function apiRequest<T>(
  url: string,
  options: ApiRequestOptions = {}
): Promise<ApiResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 30000,
  } = options;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // Check for rate limiting
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 60;
      
      logger.warning('Rate limit exceeded', { url, retryAfter: retrySeconds });
      
      return {
        status: 429,
        error: {
          type: 'rate_limit',
          title: 'Too Many Requests',
          message: `You've made too many requests. Please wait ${retrySeconds} seconds and try again.`,
          action: 'Try Later',
          retryable: true,
        },
      };
    }

    // Parse response body
    let data: T | undefined;
    let errorData: any;
    
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      const json = await response.json();
      if (response.ok) {
        data = json;
      } else {
        errorData = json;
      }
    }

    // Handle error responses
    if (!response.ok) {
      const error = getUserFriendlyError({
        status: response.status,
        message: errorData?.error || errorData?.message,
        ...errorData,
      });

      logger.error('API request failed', {
        url,
        status: response.status,
        error: errorData,
      });

      return {
        status: response.status,
        error,
      };
    }

    return {
      status: response.status,
      data,
    };
  } catch (error: any) {
    // Handle network errors, timeouts, etc.
    logger.error('API request exception', { url, error });

    const userError = getUserFriendlyError(error);

    return {
      status: 0,
      error: userError,
    };
  }
}

/**
 * GET request helper
 */
export function apiGet<T>(
  url: string,
  headers?: Record<string, string>
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'GET', headers });
}

/**
 * POST request helper
 */
export function apiPost<T>(
  url: string,
  body: any,
  headers?: Record<string, string>
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'POST', body, headers });
}

/**
 * PUT request helper
 */
export function apiPut<T>(
  url: string,
  body: any,
  headers?: Record<string, string>
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'PUT', body, headers });
}

/**
 * DELETE request helper
 */
export function apiDelete<T>(
  url: string,
  headers?: Record<string, string>
): Promise<ApiResponse<T>> {
  return apiRequest<T>(url, { method: 'DELETE', headers });
}
