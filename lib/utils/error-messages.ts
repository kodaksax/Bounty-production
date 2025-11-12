/**
 * Centralized error messages and error handling utilities
 * Provides user-friendly error messages for common error scenarios
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
  | 'unknown';

export interface UserFriendlyError {
  type: ErrorType;
  title: string;
  message: string;
  action?: string;
  retryable: boolean;
}

/**
 * Convert technical error to user-friendly error message
 */
export function getUserFriendlyError(error: any): UserFriendlyError {
  // Network errors
  if (error?.message?.includes('Network request failed') || 
      error?.code === 'ECONNREFUSED' ||
      error?.message?.includes('Failed to fetch')) {
    return {
      type: 'network',
      title: 'Connection Error',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      action: 'Retry',
      retryable: true,
    };
  }

  // Timeout errors
  if (error?.message?.includes('timeout') || error?.code === 'ETIMEDOUT') {
    return {
      type: 'network',
      title: 'Request Timeout',
      message: 'The request took too long to complete. Please try again.',
      action: 'Retry',
      retryable: true,
    };
  }

  // Authentication errors
  if (error?.status === 401 || error?.message?.includes('Unauthorized')) {
    return {
      type: 'authentication',
      title: 'Session Expired',
      message: 'Your session has expired. Please sign in again to continue.',
      action: 'Sign In',
      retryable: false,
    };
  }

  // Authorization errors
  if (error?.status === 403 || error?.message?.includes('Forbidden')) {
    return {
      type: 'authorization',
      title: 'Access Denied',
      message: 'You don\'t have permission to perform this action.',
      action: 'Go Back',
      retryable: false,
    };
  }

  // Not found errors
  if (error?.status === 404 || error?.message?.includes('not found')) {
    return {
      type: 'not_found',
      title: 'Not Found',
      message: 'The requested resource could not be found.',
      action: 'Go Back',
      retryable: false,
    };
  }

  // Rate limiting
  if (error?.status === 429 || error?.message?.includes('rate limit')) {
    return {
      type: 'rate_limit',
      title: 'Too Many Requests',
      message: 'You\'ve made too many requests. Please wait a moment and try again.',
      action: 'Try Later',
      retryable: true,
    };
  }

  // Payment errors
  if (error?.type === 'card_error' || error?.message?.includes('payment')) {
    const cardErrorMsg = error?.message || 'Payment failed';
    return {
      type: 'payment',
      title: 'Payment Error',
      message: cardErrorMsg.includes('declined') 
        ? 'Your card was declined. Please check your card details or try a different payment method.'
        : cardErrorMsg,
      action: 'Try Again',
      retryable: true,
    };
  }

  // Validation errors
  if (error?.status === 400 || error?.type === 'validation') {
    return {
      type: 'validation',
      title: 'Validation Error',
      message: error?.message || 'Please check your input and try again.',
      action: 'Fix Input',
      retryable: true,
    };
  }

  // Server errors
  if (error?.status >= 500 || error?.message?.includes('Internal Server Error')) {
    return {
      type: 'server',
      title: 'Server Error',
      message: 'Something went wrong on our end. We\'re working to fix it. Please try again later.',
      action: 'Try Later',
      retryable: true,
    };
  }

  // Generic unknown error
  return {
    type: 'unknown',
    title: 'Unexpected Error',
    message: error?.message || 'An unexpected error occurred. Please try again.',
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
