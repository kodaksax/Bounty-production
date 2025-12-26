/**
 * Shared utility functions for auth error handling
 * Provides consistent error detection and messaging across auth flows
 */

/**
 * Check if an error is a network timeout error
 */
export function isTimeoutError(error: any): boolean {
  const message = error?.message || String(error)
  return (
    message.includes('Network request timed out') ||
    message.includes('timeout') ||
    message.includes('timed out')
  )
}

/**
 * Check if an error is a network connectivity error
 */
export function isNetworkError(error: any): boolean {
  const message = error?.message || String(error)
  return (
    message.includes('Network request failed') ||
    message.includes('fetch failed') ||
    message.includes('Failed to fetch') ||
    message.includes('Network error') ||
    message.includes('No internet connection')
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
 */
export const AUTH_RETRY_CONFIG = {
  MAX_ATTEMPTS: 2,
  AUTH_TIMEOUT: 20000, // 20 seconds
  PROFILE_TIMEOUT: 8000, // 8 seconds
  SOCIAL_AUTH_TIMEOUT: 15000, // 15 seconds
  SIGNUP_TIMEOUT: 20000, // 20 seconds
} as const

/**
 * Calculate exponential backoff delay
 */
export function getBackoffDelay(attempt: number, baseDelay: number = 1000): number {
  return baseDelay * attempt
}
