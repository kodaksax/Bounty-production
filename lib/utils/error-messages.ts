/**
 * Centralized error messages and error handling utilities
 * Provides user-friendly error messages for common error scenarios
 * 
 * Key principles:
 * - Never expose technical details to users
 * - Always provide actionable guidance
 * - Suggest retry actions for recoverable errors
 */

export type ErrorType =
  | 'network'
  | 'validation'
  | 'authentication'
  | 'authorization'
  | 'payment'
  | 'rate_limit'
  | 'not_found'
  | 'server'
  | 'navigation'
  | 'database'
  | 'unknown';

export interface UserFriendlyError {
  type: ErrorType;
  title: string;
  message: string;
  action?: string;
  retryable: boolean;
}

/**
 * Patterns for technical error messages that should be sanitized
 */
const TECHNICAL_ERROR_PATTERNS = [
  /Couldn't find.*navigation/i,
  /NavigationContainer/i,
  /NavigationContent/i,
  /PGRST\d+/i, // Supabase/PostgREST error codes
  /JWT\s*(expired|invalid|malformed)/i,
  /supabase/i,
  /postgres/i,
  /ENOTFOUND/i,
  /ECONNRESET/i,
  /socket hang up/i,
  /getaddrinfo/i,
  /certificate/i,
  /SSL/i,
  /TLS/i,
  /sql/i,
  /query/i,
  /column/i,
  /table/i,
  /relation/i,
  /schema/i,
  /foreign key/i,
  /constraint/i,
  /duplicate key/i,
  /violates/i,
  /undefined is not/i,
  /Cannot read property/i,
  /null is not/i,
  /is not a function/i,
  /stack trace/i,
  /at\s+\w+\s+\(/i, // Stack trace patterns
  /\.tsx?:\d+:\d+/i, // File:line:col patterns
  /\.jsx?:\d+:\d+/i,
  /node_modules/i,
  /webpack/i,
  /bundle/i,
  /chunk/i,
  /Stripe error:/i,
  /StripeError/i,
  /sk_live_/i, // Stripe secret key patterns (should never appear, but just in case)
  /sk_test_/i,
  /pk_live_/i,
  /pk_test_/i,
];

/**
 * Check if an error message contains technical details that should be hidden
 */
function containsTechnicalDetails(message: string): boolean {
  if (!message || typeof message !== 'string') return false;
  return TECHNICAL_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Sanitize an error message to remove technical details for production
 * In development mode, technical details may be shown for debugging
 */
export function sanitizeErrorMessage(error: any): string {
  const message = error?.message || error?.error || String(error);
  
  // Check if message contains technical details
  if (containsTechnicalDetails(message)) {
    return 'An unexpected error occurred. Please try again or contact support if the problem persists.';
  }
  
  return message;
}

/**
 * Convert technical error to user-friendly error message
 */
export function getUserFriendlyError(error: any): UserFriendlyError {
  const errorMessage = error?.message || '';
  const errorCode = error?.code || '';
  
  // Navigation context errors (React Navigation)
  if (errorMessage.includes('navigation') || 
      errorMessage.includes('NavigationContainer') ||
      errorMessage.includes('NavigationContent') ||
      errorMessage.includes("Couldn't find")) {
    return {
      type: 'navigation',
      title: 'Navigation Error',
      message: 'Unable to navigate. Please restart the app and try again.',
      action: 'Restart App',
      retryable: false,
    };
  }
  
  // Supabase-specific errors
  if (isSupabaseError(error)) {
    return getSupabaseUserFriendlyError(error);
  }
  
  // Stripe-specific errors
  if (isStripeError(error)) {
    return getStripeUserFriendlyError(error);
  }

  // Network errors - with clearer retry guidance
  if (errorMessage.includes('Network request failed') || 
      errorCode === 'ECONNREFUSED' ||
      errorCode === 'ENOTFOUND' ||
      errorCode === 'ECONNRESET' ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('network') ||
      errorMessage.includes('socket hang up')) {
    return {
      type: 'network',
      title: 'Connection Error',
      message: 'Unable to connect. Check your internet connection, then tap Retry.',
      action: 'Retry',
      retryable: true,
    };
  }

  // Timeout errors - with clear retry action
  if (errorMessage.includes('timeout') || errorCode === 'ETIMEDOUT') {
    return {
      type: 'network',
      title: 'Request Timeout',
      message: 'The request is taking too long. Please check your connection and try again.',
      action: 'Retry',
      retryable: true,
    };
  }

  // Authentication errors
  if (error?.status === 401 || errorMessage.includes('Unauthorized') || errorMessage.includes('unauthenticated')) {
    return {
      type: 'authentication',
      title: 'Session Expired',
      message: 'Your session has expired. Please sign in again to continue.',
      action: 'Sign In',
      retryable: false,
    };
  }

  // Authorization errors
  if (error?.status === 403 || errorMessage.includes('Forbidden') || errorMessage.includes('permission')) {
    return {
      type: 'authorization',
      title: 'Access Denied',
      message: 'You don\'t have permission to perform this action.',
      action: 'Go Back',
      retryable: false,
    };
  }

  // Not found errors
  if (error?.status === 404 || errorMessage.toLowerCase().includes('not found')) {
    return {
      type: 'not_found',
      title: 'Not Found',
      message: 'The requested item could not be found. It may have been removed or is no longer available.',
      action: 'Go Back',
      retryable: false,
    };
  }

  // Rate limiting - with clear wait guidance
  if (error?.status === 429 || errorMessage.toLowerCase().includes('rate limit') || errorMessage.includes('too many requests')) {
    return {
      type: 'rate_limit',
      title: 'Please Slow Down',
      message: 'You\'ve made too many requests. Wait a minute and try again.',
      action: 'Wait & Retry',
      retryable: true,
    };
  }

  // Payment errors
  if (error?.type === 'card_error' || error?.type === 'payment_error' || errorMessage.toLowerCase().includes('payment')) {
    return getPaymentUserFriendlyError(error);
  }

  // Validation errors
  if (error?.status === 400 || error?.type === 'validation') {
    // Sanitize validation messages that might contain technical details
    const safeMessage = containsTechnicalDetails(errorMessage)
      ? 'Please check your input and try again.'
      : errorMessage || 'Please check your input and try again.';
    return {
      type: 'validation',
      title: 'Validation Error',
      message: safeMessage,
      action: 'Fix Input',
      retryable: true,
    };
  }

  // Server errors
  if (error?.status >= 500 || errorMessage.includes('Internal Server Error') || errorMessage.includes('500')) {
    return {
      type: 'server',
      title: 'Server Error',
      message: 'Something went wrong on our end. Please try again in a few moments.',
      action: 'Try Later',
      retryable: true,
    };
  }

  // Generic unknown error - always sanitize
  const sanitizedMessage = sanitizeErrorMessage(error);
  return {
    type: 'unknown',
    title: 'Something Went Wrong',
    message: sanitizedMessage === errorMessage 
      ? errorMessage || 'An unexpected error occurred. Please try again.'
      : sanitizedMessage,
    action: 'Try Again',
    retryable: true,
  };
}

/**
 * Check if error is a Supabase error
 */
function isSupabaseError(error: any): boolean {
  if (!error) return false;
  const message = error?.message || '';
  const code = error?.code || '';
  
  return (
    message.toLowerCase().includes('supabase') ||
    message.includes('PGRST') ||
    code.startsWith('PGRST') ||
    code.startsWith('22') || // PostgreSQL error codes
    code.startsWith('23') ||
    code.startsWith('42') ||
    error?.hint !== undefined ||
    error?.details !== undefined ||
    message.includes('row-level security') ||
    message.includes('JWT')
  );
}

/**
 * Get user-friendly error for Supabase errors
 */
function getSupabaseUserFriendlyError(error: any): UserFriendlyError {
  const message = error?.message || '';
  const code = error?.code || '';
  
  // JWT/Session errors
  if (message.includes('JWT') || message.includes('token')) {
    return {
      type: 'authentication',
      title: 'Session Expired',
      message: 'Your session has expired. Please sign in again.',
      action: 'Sign In',
      retryable: false,
    };
  }
  
  // Row-level security / permission errors
  if (message.includes('row-level security') || message.includes('policy') || code === '42501') {
    return {
      type: 'authorization',
      title: 'Access Denied',
      message: 'You don\'t have permission to access this data.',
      action: 'Go Back',
      retryable: false,
    };
  }
  
  // Unique constraint violations (e.g., duplicate email)
  if (code === '23505' || message.includes('duplicate') || message.includes('unique')) {
    return {
      type: 'validation',
      title: 'Already Exists',
      message: 'This information is already in use. Please try with different details.',
      action: 'Change Input',
      retryable: true,
    };
  }
  
  // Foreign key violations
  if (code === '23503' || message.includes('foreign key')) {
    return {
      type: 'validation',
      title: 'Invalid Reference',
      message: 'The referenced item doesn\'t exist or has been removed.',
      action: 'Go Back',
      retryable: false,
    };
  }
  
  // Not found in database
  if (code === 'PGRST116' || message.includes('no rows')) {
    return {
      type: 'not_found',
      title: 'Not Found',
      message: 'The requested item could not be found.',
      action: 'Go Back',
      retryable: false,
    };
  }
  
  // Connection/network errors to database
  if (message.includes('connection') || message.includes('ECONNREFUSED')) {
    return {
      type: 'network',
      title: 'Connection Error',
      message: 'Unable to connect to the service. Please check your connection and try again.',
      action: 'Retry',
      retryable: true,
    };
  }
  
  // Default database error
  return {
    type: 'database',
    title: 'Service Error',
    message: 'We encountered an issue processing your request. Please try again.',
    action: 'Try Again',
    retryable: true,
  };
}

/**
 * Check if error is a Stripe error
 */
function isStripeError(error: any): boolean {
  if (!error) return false;
  const message = error?.message || '';
  const type = error?.type || '';
  
  // Check for Stripe-specific error types
  const stripeErrorTypes = [
    'card_error',
    'invalid_request_error',
    'api_error',
    'authentication_error',
    'rate_limit_error',
    'idempotency_error',
    'invalid_grant',
  ];
  
  return (
    stripeErrorTypes.includes(type) ||
    type.includes('stripe') ||
    type.includes('card') ||
    message.includes('Stripe') ||
    message.includes('StripeError') ||
    error?.decline_code !== undefined ||
    error?.payment_intent !== undefined ||
    error?.charge !== undefined
  );
}

/**
 * Get user-friendly error for Stripe errors
 */
function getStripeUserFriendlyError(error: any): UserFriendlyError {
  const code = error?.code || error?.decline_code || '';
  const type = error?.type || '';
  
  // Card errors
  if (type === 'card_error' || type.includes('card')) {
    return getPaymentUserFriendlyError(error);
  }
  
  // Authentication required (3D Secure, etc.)
  if (code === 'authentication_required') {
    return {
      type: 'payment',
      title: 'Verification Required',
      message: 'Your bank requires additional verification. Please complete the authentication.',
      action: 'Verify',
      retryable: true,
    };
  }
  
  // Rate limit
  if (type === 'rate_limit_error') {
    return {
      type: 'rate_limit',
      title: 'Please Wait',
      message: 'Too many payment attempts. Please wait a moment and try again.',
      action: 'Wait & Retry',
      retryable: true,
    };
  }
  
  // Invalid request (usually developer error, but show user-friendly message)
  if (type === 'invalid_request_error') {
    return {
      type: 'validation',
      title: 'Invalid Request',
      message: 'There was an issue with your payment details. Please check and try again.',
      action: 'Check Details',
      retryable: true,
    };
  }
  
  // API errors
  if (type === 'api_error') {
    return {
      type: 'server',
      title: 'Payment Service Error',
      message: 'The payment service is temporarily unavailable. Please try again shortly.',
      action: 'Try Later',
      retryable: true,
    };
  }
  
  // Default Stripe error
  return {
    type: 'payment',
    title: 'Payment Error',
    message: 'Unable to process payment. Please check your payment method and try again.',
    action: 'Try Again',
    retryable: true,
  };
}

/**
 * Get user-friendly error for payment errors
 */
function getPaymentUserFriendlyError(error: any): UserFriendlyError {
  const code = error?.code || error?.decline_code || '';
  
  // Use specific payment error messages if available
  const specificMessage = PAYMENT_ERROR_MESSAGES[code as keyof typeof PAYMENT_ERROR_MESSAGES];
  if (specificMessage) {
    return {
      type: 'payment',
      title: 'Payment Failed',
      message: specificMessage,
      action: 'Try Again',
      retryable: true,
    };
  }
  
  return {
    type: 'payment',
    title: 'Payment Error',
    message: 'Unable to process your payment. Please check your payment details and try again.',
    action: 'Try Again',
    retryable: true,
  };
}

/**
 * Get user-friendly validation error message
 */
export function getValidationError(field: string, error: string): string {
  const fieldName = field.charAt(0).toUpperCase() + field.slice(1);
  
  if (error.includes('required')) {
    return `${fieldName} is required`;
  }
  if (error.includes('email')) {
    return 'Please enter a valid email address';
  }
  if (error.includes('password')) {
    return 'Password must be at least 8 characters';
  }
  if (error.includes('min')) {
    const match = error.match(/\d+/);
    const min = match ? match[0] : '';
    return `${fieldName} must be at least ${min} characters`;
  }
  if (error.includes('max')) {
    const match = error.match(/\d+/);
    const max = match ? match[0] : '';
    return `${fieldName} must be no more than ${max} characters`;
  }
  
  return error;
}

/**
 * Payment error messages
 */
export const PAYMENT_ERROR_MESSAGES = {
  card_declined: 'Your card was declined. Please check your card details or try a different payment method.',
  insufficient_funds: 'Your card has insufficient funds. Please use a different payment method.',
  expired_card: 'Your card has expired. Please update your payment method.',
  incorrect_cvc: 'The security code (CVC) you entered is incorrect.',
  processing_error: 'An error occurred while processing your payment. Please try again.',
  invalid_amount: 'The payment amount is invalid. Please check and try again.',
  authentication_required: 'Additional authentication is required. Please complete the verification process.',
  generic: 'Payment failed. Please check your payment details and try again.',
} as const;

/**
 * Get payment-specific error message
 */
export function getPaymentErrorMessage(error: any): string {
  const code = error?.code || error?.decline_code;
  
  if (code in PAYMENT_ERROR_MESSAGES) {
    return PAYMENT_ERROR_MESSAGES[code as keyof typeof PAYMENT_ERROR_MESSAGES];
  }
  
  return PAYMENT_ERROR_MESSAGES.generic;
}
