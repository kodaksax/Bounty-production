/**
 * Shared utility functions for auth error handling
 * Provides consistent error detection and messaging across auth flows
 */

/**
 * Check if an error is a network timeout error
 * Uses structured error indicators for more reliable detection
 */
export function isTimeoutError(error: any): boolean {
  if (!error) return false

  // Prefer structured indicators over fragile message matching
  const err = error as any

  // Common timeout/abort indicators from fetch/DOM/React Native
  if (err.name === 'AbortError') {
    return true
  }

  // Node.js / Axios-style timeout code
  if (typeof err.code === 'string' && err.code.toUpperCase() === 'ECONNABORTED') {
    return true
  }

  // HTTP timeout status codes
  const status = err.status ?? err.statusCode
  if (status === 408) {
    return true
  }

  // Some libraries wrap the original error in `cause`
  if (err.cause && typeof err.cause === 'object' && isTimeoutError(err.cause)) {
    return true
  }

  // Fallback to message-based detection as a last resort
  const message = err?.message || String(err)
  return (
    typeof message === 'string' &&
    (message.includes('Network request timed out') ||
      message.includes('timeout') ||
      message.includes('timed out'))
  )
}

/**
 * Check if an error is a network connectivity error
 * Uses structured error indicators for more reliable detection
 */
export function isNetworkError(error: any): boolean {
  if (!error) return false

  const err = error as any

  // Check for common network error names
  if (err.name === 'NetworkError' || err.name === 'TypeError' && err.message?.includes('fetch')) {
    return true
  }

  // Check for network-related error codes
  if (typeof err.code === 'string') {
    const code = err.code.toUpperCase()
    if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'ENETUNREACH') {
      return true
    }
  }

  // Some libraries wrap the original error in `cause`
  if (err.cause && typeof err.cause === 'object' && isNetworkError(err.cause)) {
    return true
  }

  // Fallback to message-based detection
  const message = err?.message || String(err)
  return (
    typeof message === 'string' &&
    (message.includes('Network request failed') ||
      message.includes('fetch failed') ||
      message.includes('Failed to fetch') ||
      message.includes('Network error') ||
      message.includes('No internet connection'))
  )
}

/**
 * Get user-friendly error message for auth errors
 */
export function getAuthErrorMessage(error: any): string {
  const message = error?.message || String(error)
  
  // Network issues
  if (message.includes('No internet connection')) {
    return 'No internet connection. Please check your network and try again.'
  }
  
  // Timeout errors
  if (isTimeoutError(error)) {
    return 'Request is taking longer than expected. This might be due to slow network or server issues. Please try again.'
  }
  
  // Configuration issues
  if (message.includes('not configured')) {
    return 'Authentication service is not configured. Please contact support.'
  }
  
  // Supabase auth errors
  if (message.includes('Invalid login credentials')) {
    return 'Invalid email or password. Please try again.'
  }
  
  if (message.includes('Email not confirmed')) {
    return 'Please confirm your email address before signing in.'
  }
  
  if (message.includes('already registered')) {
    return 'This email is already registered. Please sign in instead.'
  }
  
  if (message.includes('rate limit')) {
    return 'Too many attempts. Please wait a few minutes before trying again.'
  }
  
  // Default fallback
  return message || 'An unexpected error occurred. Please try again.'
}

/**
 * Retry configuration constants
 * Optimized for speed while maintaining reliability
 */
export const AUTH_RETRY_CONFIG = {
  MAX_ATTEMPTS: 2,
  AUTH_TIMEOUT: 15000, // 15 seconds - reduced from 30s for faster feedback
  PROFILE_TIMEOUT: 5000, // 5 seconds - reduced from 10s, profile checks are typically fast
  SOCIAL_AUTH_TIMEOUT: 15000, // 15 seconds - reduced from 20s
  SIGNUP_TIMEOUT: 20000, // 20 seconds - reduced from 30s
} as const

/**
 * Calculate exponential backoff delay
 * Returns exponentially increasing delays: 1s, 2s, 4s, 8s (capped at 8s)
 */
export function getBackoffDelay(attempt: number, baseDelay: number = 1000): number {
  return Math.min(8000, Math.pow(2, attempt - 1) * baseDelay)
}
