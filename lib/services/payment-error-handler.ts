/**
 * Payment Error Handler
 * 
 * Enhanced error handling for Stripe payments with:
 * - Error categorization by type
 * - Specific recovery actions
 * - Proper logging for payment failures
 * - Automatic retries for transient errors
 * - Duplicate payment submission protection
 */

import { analyticsService } from './analytics-service';

/**
 * Payment error categories for better error handling
 */
export type PaymentErrorCategory =
  | 'card_declined'
  | 'authentication_required'
  | 'network'
  | 'rate_limit'
  | 'validation'
  | 'processing'
  | 'duplicate'
  | 'fraud'
  | 'server'
  | 'unknown';

/**
 * Structured payment error with category and recovery info
 */
export interface PaymentError {
  category: PaymentErrorCategory;
  code: string;
  message: string;
  userMessage: string;
  recoveryAction: PaymentRecoveryAction;
  retryable: boolean;
  retryDelayMs?: number;
  originalError?: any;
}

/**
 * Recovery actions for payment errors
 */
export type PaymentRecoveryAction =
  | 'retry'
  | 'update_card'
  | 'verify_identity'
  | 'contact_bank'
  | 'contact_support'
  | 'try_different_card'
  | 'wait_and_retry'
  | 'none';

/**
 * Map of decline codes to error categories
 */
const DECLINE_CODE_CATEGORIES: Record<string, PaymentErrorCategory> = {
  // Card declined errors
  'card_declined': 'card_declined',
  'generic_decline': 'card_declined',
  'do_not_honor': 'card_declined',
  'transaction_not_allowed': 'card_declined',
  'card_not_supported': 'card_declined',
  'currency_not_supported': 'card_declined',
  
  // Insufficient funds
  'insufficient_funds': 'card_declined',
  'withdrawal_count_limit_exceeded': 'card_declined',
  
  // Card validation issues
  'incorrect_number': 'validation',
  'incorrect_cvc': 'validation',
  'incorrect_zip': 'validation',
  'invalid_cvc': 'validation',
  'invalid_expiry_month': 'validation',
  'invalid_expiry_year': 'validation',
  'invalid_number': 'validation',
  'expired_card': 'validation',
  
  // Authentication required
  'authentication_required': 'authentication_required',
  
  // Processing errors
  'processing_error': 'processing',
  'try_again_later': 'processing',
  
  // Fraud prevention
  'fraudulent': 'fraud',
  'stolen_card': 'fraud',
  'lost_card': 'fraud',
  'merchant_blacklist': 'fraud',
  'pickup_card': 'fraud',
  'restricted_card': 'fraud',
  
  // Rate limiting
  'too_many_attempts': 'rate_limit',
  
  // Duplicate transaction
  'duplicate_transaction': 'duplicate',
};

/**
 * User-friendly messages for each category
 */
const CATEGORY_MESSAGES: Record<PaymentErrorCategory, string> = {
  card_declined: 'Your card was declined. Please try a different payment method or contact your bank.',
  authentication_required: 'Additional verification is required. Please complete the authentication process.',
  network: 'Unable to connect to the payment service. Please check your connection and try again.',
  rate_limit: 'Too many payment attempts. Please wait a moment and try again.',
  validation: 'Please check your payment details and try again.',
  processing: 'An error occurred while processing your payment. Please try again.',
  duplicate: 'This payment has already been processed. Please check your account for the transaction.',
  fraud: 'This card cannot be used. Please try a different payment method.',
  server: 'The payment service is temporarily unavailable. Please try again later.',
  unknown: 'An unexpected error occurred. Please try again or contact support.',
};

/**
 * Recovery actions for each category
 */
const CATEGORY_RECOVERY_ACTIONS: Record<PaymentErrorCategory, PaymentRecoveryAction> = {
  card_declined: 'try_different_card',
  authentication_required: 'verify_identity',
  network: 'retry',
  rate_limit: 'wait_and_retry',
  validation: 'update_card',
  processing: 'retry',
  duplicate: 'none',
  fraud: 'contact_support',
  server: 'wait_and_retry',
  unknown: 'retry',
};

/**
 * Retryable categories
 */
const RETRYABLE_CATEGORIES: PaymentErrorCategory[] = [
  'network',
  'processing',
  'server',
  'rate_limit',
];

/**
 * Retry delays in milliseconds for each category
 */
const RETRY_DELAYS: Partial<Record<PaymentErrorCategory, number>> = {
  network: 1000,
  processing: 2000,
  server: 5000,
  rate_limit: 60000,
};

/**
 * Parse a Stripe error into a structured PaymentError
 */
export function parsePaymentError(error: any): PaymentError {
  const code = error?.code || error?.decline_code || 'unknown';
  const type = error?.type || '';
  const message = error?.message || 'An error occurred';

  // Determine category
  let category: PaymentErrorCategory = 'unknown';

  // Check decline codes first
  if (code in DECLINE_CODE_CATEGORIES) {
    category = DECLINE_CODE_CATEGORIES[code];
  }
  // Check error types
  else if (type === 'card_error') {
    category = 'card_declined';
  } else if (type === 'rate_limit_error') {
    category = 'rate_limit';
  } else if (type === 'api_error') {
    category = 'server';
  } else if (type === 'validation_error' || type === 'invalid_request_error') {
    category = 'validation';
  } else if (type === 'authentication_error') {
    category = 'authentication_required';
  } else if (type === 'idempotency_error') {
    category = 'duplicate';
  }
  // Check for network-related messages
  else if (
    message.toLowerCase().includes('network') ||
    message.toLowerCase().includes('connection') ||
    message.toLowerCase().includes('fetch')
  ) {
    category = 'network';
  }

  const userMessage = CATEGORY_MESSAGES[category];
  const recoveryAction = CATEGORY_RECOVERY_ACTIONS[category];
  const retryable = RETRYABLE_CATEGORIES.includes(category);
  const retryDelayMs = RETRY_DELAYS[category];

  return {
    category,
    code,
    message,
    userMessage,
    recoveryAction,
    retryable,
    retryDelayMs,
    originalError: error,
  };
}

/**
 * Log payment error with analytics
 */
export async function logPaymentError(
  error: PaymentError,
  context: {
    paymentIntentId?: string;
    amount?: number;
    currency?: string;
    userId?: string;
    stage?: 'initiate' | 'confirm' | 'process';
  }
): Promise<void> {
  // Log to console for debugging
  console.error('[PaymentError]', {
    category: error.category,
    code: error.code,
    message: error.message,
    ...context,
  });

  // Track with analytics
  try {
    await analyticsService.trackEvent('payment_error', {
      error_category: error.category,
      error_code: error.code,
      retryable: error.retryable,
      recovery_action: error.recoveryAction,
      ...context,
    });
  } catch (analyticsError) {
    // Don't let analytics errors affect payment flow
    console.error('[PaymentError] Analytics tracking failed:', analyticsError);
  }
}

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBackoff: boolean;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  exponentialBackoff: true,
};

/**
 * Execute a payment operation with automatic retries for transient errors
 */
export async function withPaymentRetry<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<T> {
  const { maxRetries, baseDelayMs, maxDelayMs, exponentialBackoff } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };

  let lastError: any;
  let attempt = 0;

  // Initial attempt + maxRetries retries (e.g., maxRetries: 3 = 1 initial + 3 retries = 4 total attempts)
  while (attempt <= maxRetries) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;
      const paymentError = parsePaymentError(error);

      // Only retry if the error is retryable
      if (!paymentError.retryable) {
        throw error;
      }

      attempt++;

      // Don't retry if we've exceeded max retries
      if (attempt > maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      let delay = exponentialBackoff
        ? Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
        : baseDelayMs;

      // Use category-specific delay if available
      if (paymentError.retryDelayMs) {
        delay = Math.min(paymentError.retryDelayMs, maxDelayMs);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Idempotency key generation and management for duplicate prevention
 * 
 * NOTE: This is a client-side implementation for immediate duplicate detection.
 * The server-side idempotency (in payments.ts) provides the authoritative check.
 * This client-side cache is used for:
 * 1. Preventing rapid double-clicks from creating duplicate requests
 * 2. Providing immediate feedback to users without a network round-trip
 * 
 * For production distributed systems, consider using:
 * - Server-side: Redis with atomic operations
 * - Client-side: This in-memory cache is sufficient as it's per-device
 */
const IDEMPOTENCY_KEY_PREFIX = 'bountyexpo_pay_';
const IDEMPOTENCY_CACHE = new Map<string, number>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate an idempotency key for a payment request
 */
export function generateIdempotencyKey(
  userId: string,
  amount: number,
  purpose: string
): string {
  // Deterministic key: identical parameters yield identical key
  return `${IDEMPOTENCY_KEY_PREFIX}${userId}_${amount}_${purpose}`;
}

/**
 * Check if a payment with this idempotency key is already in progress
 */
export function checkDuplicatePayment(idempotencyKey: string): boolean {
  const existingTimestamp = IDEMPOTENCY_CACHE.get(idempotencyKey);
  
  if (existingTimestamp) {
    // Check if the key is still within TTL
    if (Date.now() - existingTimestamp < IDEMPOTENCY_TTL_MS) {
      return true; // Duplicate detected
    }
    // Key expired, remove it
    IDEMPOTENCY_CACHE.delete(idempotencyKey);
  }
  
  return false;
}

/**
 * Record a payment attempt with idempotency key
 */
export function recordPaymentAttempt(idempotencyKey: string): void {
  IDEMPOTENCY_CACHE.set(idempotencyKey, Date.now());
  
  // Cleanup old keys periodically
  cleanupExpiredIdempotencyKeys();
}

/**
 * Mark a payment attempt as complete (remove from tracking)
 */
export function completePaymentAttempt(idempotencyKey: string): void {
  IDEMPOTENCY_CACHE.delete(idempotencyKey);
}

/**
 * Clean up expired idempotency keys
 */
function cleanupExpiredIdempotencyKeys(): void {
  const now = Date.now();
  for (const [key, timestamp] of IDEMPOTENCY_CACHE.entries()) {
    if (now - timestamp >= IDEMPOTENCY_TTL_MS) {
      IDEMPOTENCY_CACHE.delete(key);
    }
  }
}

/**
 * Get recovery instructions based on error category
 */
export function getRecoveryInstructions(error: PaymentError): string {
  switch (error.recoveryAction) {
    case 'retry':
      return 'Please tap "Try Again" to retry your payment.';
    case 'update_card':
      return 'Please check your card details are correct and try again.';
    case 'verify_identity':
      return 'Your bank requires additional verification. Please complete the authentication when prompted.';
    case 'contact_bank':
      return 'Please contact your bank to resolve this issue, then try again.';
    case 'try_different_card':
      return 'Please try a different payment method.';
    case 'wait_and_retry':
      return 'Please wait a moment and try again.';
    case 'contact_support':
      return 'Please contact support at support@bountyexpo.com for assistance.';
    case 'none':
      return 'No action needed. If you believe this is an error, please contact support.';
    default:
      return 'Please try again or contact support if the problem persists.';
  }
}

/**
 * Combined error response for UI display
 */
export interface PaymentErrorResponse {
  error: PaymentError;
  recoveryInstructions: string;
  showRetryButton: boolean;
  showUpdateCardButton: boolean;
  showContactSupportButton: boolean;
}

/**
 * Get complete error response for UI
 */
export function getPaymentErrorResponse(rawError: any): PaymentErrorResponse {
  const error = parsePaymentError(rawError);
  const recoveryInstructions = getRecoveryInstructions(error);

  return {
    error,
    recoveryInstructions,
    showRetryButton: error.retryable,
    showUpdateCardButton: error.recoveryAction === 'update_card' || error.recoveryAction === 'try_different_card',
    showContactSupportButton: error.recoveryAction === 'contact_support' || error.category === 'unknown',
  };
}
