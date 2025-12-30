/**
 * Shared utility functions for auth error handling
 * Provides consistent error detection and messaging across auth flows
 */

/**
 * Auth error categories for better error handling and recovery
 */
export type AuthErrorCategory =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'email_already_registered'
  | 'weak_password'
  | 'rate_limited'
  | 'network_error'
  | 'timeout_error'
  | 'token_expired'
  | 'session_expired'
  | 'configuration_error'
  | 'unknown';

/**
 * Structured auth error with category and recovery info
 */
export interface AuthError {
  category: AuthErrorCategory;
  code: string;
  message: string;
  userMessage: string;
  recoveryAction: 'retry' | 'check_credentials' | 'verify_email' | 'try_later' | 'contact_support' | 'none';
  retryable: boolean;
  correlationId?: string;
  originalError?: any;
}

/**
 * Parse a Supabase auth error into a structured AuthError
 * Uses error codes and status codes for reliable detection
 */
export function parseAuthError(error: any, correlationId?: string): AuthError {
  // Extract error properties
  const code = error?.code || error?.error_code || error?.status || 'unknown';
  const message = error?.message || String(error);
  const statusCode = error?.status || error?.statusCode;

  // Default error
  let category: AuthErrorCategory = 'unknown';
  let userMessage = message;
  let recoveryAction: AuthError['recoveryAction'] = 'retry';
  let retryable = false;

  // Detect error category based on status codes and error codes
  // Supabase auth errors typically return 400 with specific messages
  // https://supabase.com/docs/guides/auth/server-side/error-codes

  // Invalid credentials (400 with specific message or code)
  if (
    message.includes('Invalid login credentials') ||
    message.includes('invalid_grant') ||
    code === 'invalid_credentials'
  ) {
    category = 'invalid_credentials';
    userMessage = 'Invalid email or password. Please check your credentials and try again.';
    recoveryAction = 'check_credentials';
    retryable = false;
  }
  // Email not confirmed
  else if (
    message.includes('Email not confirmed') ||
    message.includes('email_not_confirmed') ||
    code === 'email_not_confirmed'
  ) {
    category = 'email_not_confirmed';
    userMessage = 'Please confirm your email address before signing in. Check your inbox for the confirmation link.';
    recoveryAction = 'verify_email';
    retryable = false;
  }
  // Email already registered
  else if (
    message.includes('already registered') ||
    message.includes('User already registered') ||
    code === 'user_already_exists' ||
    statusCode === 422
  ) {
    category = 'email_already_registered';
    userMessage = 'This email is already registered. Please sign in instead or use password reset if you forgot your password.';
    recoveryAction = 'none';
    retryable = false;
  }
  // Weak password
  else if (
    message.includes('Password should be') ||
    message.includes('password') && message.includes('weak') ||
    code === 'weak_password'
  ) {
    category = 'weak_password';
    userMessage = 'Password is too weak. Please use at least 8 characters with uppercase, lowercase, number, and special character.';
    recoveryAction = 'none';
    retryable = false;
  }
  // Rate limiting (429 or specific message)
  else if (
    statusCode === 429 ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('Too many') ||
    code === 'over_request_rate_limit'
  ) {
    category = 'rate_limited';
    userMessage = 'Too many attempts. Please wait a few minutes before trying again.';
    recoveryAction = 'try_later';
    retryable = true; // Can retry after waiting
  }
  // Token expired
  else if (
    message.includes('Token has expired') ||
    message.includes('token_expired') ||
    code === 'token_expired' ||
    statusCode === 401 && message.includes('expired')
  ) {
    category = 'token_expired';
    userMessage = 'Your session has expired. Please sign in again.';
    recoveryAction = 'none';
    retryable = false;
  }
  // Session expired
  else if (
    message.includes('session') && message.includes('expired') ||
    code === 'session_expired'
  ) {
    category = 'session_expired';
    userMessage = 'Your session has expired. Please sign in again.';
    recoveryAction = 'none';
    retryable = false;
  }
  // Network errors
  else if (isNetworkError(error)) {
    category = 'network_error';
    userMessage = 'Unable to connect to the authentication service. Please check your internet connection and try again.';
    recoveryAction = 'retry';
    retryable = true;
  }
  // Timeout errors
  else if (isTimeoutError(error)) {
    category = 'timeout_error';
    userMessage = 'Request is taking longer than expected. Please check your connection and try again.';
    recoveryAction = 'retry';
    retryable = true;
  }
  // Configuration errors
  else if (
    message.includes('not configured') ||
    message.includes('Configuration error')
  ) {
    category = 'configuration_error';
    userMessage = 'Authentication service is not configured. Please contact support.';
    recoveryAction = 'contact_support';
    retryable = false;
  }

  return {
    category,
    code: String(code),
    message,
    userMessage,
    recoveryAction,
    retryable,
    correlationId,
    originalError: error,
  };
}

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
  PROFILE_TIMEOUT: 3000, // 3 seconds - reduced from 10s, profile checks are typically fast
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

/**
 * Generate a correlation ID for tracking auth operations
 * Format: auth_<timestamp>_<random>
 */
export function generateCorrelationId(prefix: string = 'auth'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Get recovery instructions based on auth error
 */
export function getAuthErrorRecoveryInstructions(error: AuthError): string {
  switch (error.recoveryAction) {
    case 'retry':
      return 'Please try again in a moment.';
    case 'check_credentials':
      return 'Please verify your email and password are correct.';
    case 'verify_email':
      return 'Please check your inbox for a verification email and click the confirmation link.';
    case 'try_later':
      return 'Please wait a few minutes and try again.';
    case 'contact_support':
      return 'Please contact support if this problem persists.';
    case 'none':
      return '';
    default:
      return 'Please try again or contact support if the problem persists.';
  }
}
