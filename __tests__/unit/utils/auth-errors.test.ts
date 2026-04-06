/**
 * Unit tests for auth error utilities
 * Covers parseAuthError, isNetworkError, isTimeoutError,
 * getAuthErrorMessage, getBackoffDelay, generateCorrelationId,
 * and getAuthErrorRecoveryInstructions.
 */

import {
  parseAuthError,
  isNetworkError,
  isTimeoutError,
  getAuthErrorMessage,
  getBackoffDelay,
  generateCorrelationId,
  getAuthErrorRecoveryInstructions,
  AUTH_RETRY_CONFIG,
  type AuthError,
} from '../../../lib/utils/auth-errors';

describe('parseAuthError', () => {
  describe('invalid credentials', () => {
    it('detects "Invalid login credentials" message', () => {
      const result = parseAuthError({ message: 'Invalid login credentials' });
      expect(result.category).toBe('invalid_credentials');
      expect(result.retryable).toBe(false);
      expect(result.recoveryAction).toBe('check_credentials');
    });

    it('detects "invalid_grant" message', () => {
      const result = parseAuthError({ message: 'invalid_grant: some detail' });
      expect(result.category).toBe('invalid_credentials');
    });

    it('detects "invalid_credentials" error code', () => {
      const result = parseAuthError({ code: 'invalid_credentials', message: 'bad creds' });
      expect(result.category).toBe('invalid_credentials');
    });
  });

  describe('email not confirmed', () => {
    it('detects "Email not confirmed" message', () => {
      const result = parseAuthError({ message: 'Email not confirmed' });
      expect(result.category).toBe('email_not_confirmed');
      expect(result.retryable).toBe(false);
      expect(result.recoveryAction).toBe('verify_email');
    });

    it('detects email_not_confirmed code', () => {
      const result = parseAuthError({ code: 'email_not_confirmed', message: '' });
      expect(result.category).toBe('email_not_confirmed');
    });
  });

  describe('email already registered', () => {
    it('detects "already registered" message', () => {
      const result = parseAuthError({ message: 'User already registered' });
      expect(result.category).toBe('email_already_registered');
      expect(result.retryable).toBe(false);
    });

    it('detects user_already_exists code', () => {
      const result = parseAuthError({ code: 'user_already_exists', message: '' });
      expect(result.category).toBe('email_already_registered');
    });

    it('detects 422 status code', () => {
      const result = parseAuthError({ status: 422, message: 'Unprocessable entity' });
      expect(result.category).toBe('email_already_registered');
    });
  });

  describe('rate limiting', () => {
    it('detects 429 status code', () => {
      const result = parseAuthError({ status: 429, message: 'Too many requests' });
      expect(result.category).toBe('rate_limited');
      expect(result.retryable).toBe(true);
      expect(result.recoveryAction).toBe('try_later');
    });

    it('detects "rate limit" message', () => {
      const result = parseAuthError({ message: 'Email rate limit exceeded' });
      expect(result.category).toBe('rate_limited');
    });

    it('detects over_request_rate_limit code', () => {
      const result = parseAuthError({ code: 'over_request_rate_limit', message: '' });
      expect(result.category).toBe('rate_limited');
    });
  });

  describe('token expired', () => {
    it('detects "Token has expired" message', () => {
      const result = parseAuthError({ message: 'Token has expired' });
      expect(result.category).toBe('token_expired');
      expect(result.retryable).toBe(false);
    });

    it('detects token_expired code', () => {
      const result = parseAuthError({ code: 'token_expired', message: '' });
      expect(result.category).toBe('token_expired');
    });
  });

  describe('session expired', () => {
    it('detects session expired message', () => {
      const result = parseAuthError({ message: 'session has expired' });
      expect(result.category).toBe('session_expired');
    });
  });

  describe('configuration error', () => {
    it('detects "not configured" message', () => {
      const result = parseAuthError({ message: 'Authentication service not configured' });
      expect(result.category).toBe('configuration_error');
      expect(result.recoveryAction).toBe('contact_support');
    });

    it('detects "Invalid API key" message (case-insensitive)', () => {
      const result = parseAuthError({ message: 'invalid api key supplied' });
      expect(result.category).toBe('configuration_error');
    });
  });

  describe('unknown / internal server errors', () => {
    it('returns sanitized user message for "internal server error"', () => {
      const result = parseAuthError({ message: 'internal server error' });
      expect(result.userMessage).not.toContain('internal');
      expect(result.userMessage.toLowerCase()).not.toBe('internal server error');
    });

    it('returns sanitized message for unexpected errors', () => {
      const result = parseAuthError({ message: 'unexpected error occurred' });
      // The raw message should be replaced with a safe, human-readable version.
      // It must not equal the original raw message.
      expect(result.userMessage).not.toBe('unexpected error occurred');
      expect(result.userMessage.length).toBeGreaterThan(0);
    });

    it('handles null / undefined error gracefully', () => {
      const result = parseAuthError(null);
      expect(result.category).toBe('unknown');
      expect(typeof result.userMessage).toBe('string');
    });

    it('handles Error objects', () => {
      const result = parseAuthError(new Error('Invalid login credentials'));
      expect(result.category).toBe('invalid_credentials');
    });
  });

  describe('correlationId propagation', () => {
    it('attaches correlationId when provided', () => {
      const result = parseAuthError({ message: 'Invalid login credentials' }, 'test_corr_123');
      expect(result.correlationId).toBe('test_corr_123');
    });

    it('omits correlationId when not provided', () => {
      const result = parseAuthError({ message: 'Invalid login credentials' });
      expect(result.correlationId).toBeUndefined();
    });
  });

  describe('network errors', () => {
    it('categorises network errors correctly', () => {
      const result = parseAuthError({ message: 'Network request failed' });
      expect(result.category).toBe('network_error');
      expect(result.retryable).toBe(true);
    });
  });

  describe('timeout errors', () => {
    it('categorises AbortError as timeout', () => {
      const err = { name: 'AbortError', message: 'The operation was aborted' };
      const result = parseAuthError(err);
      expect(result.category).toBe('timeout_error');
      expect(result.retryable).toBe(true);
    });
  });
});

describe('isTimeoutError', () => {
  it('returns true for AbortError', () => {
    expect(isTimeoutError({ name: 'AbortError', message: 'aborted' })).toBe(true);
  });

  it('returns true for ECONNABORTED code', () => {
    expect(isTimeoutError({ code: 'ECONNABORTED', message: 'timeout' })).toBe(true);
  });

  it('returns true for HTTP 408 status', () => {
    expect(isTimeoutError({ status: 408, message: 'Request Timeout' })).toBe(true);
  });

  it('returns true for message containing "timed out"', () => {
    expect(isTimeoutError({ message: 'Request timed out' })).toBe(true);
  });

  it('returns true for "Network request timed out"', () => {
    expect(isTimeoutError({ message: 'Network request timed out' })).toBe(true);
  });

  it('returns false for non-timeout errors', () => {
    expect(isTimeoutError({ message: 'Invalid login credentials' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isTimeoutError(null)).toBe(false);
  });
});

describe('isNetworkError', () => {
  it('returns true for "Network request failed"', () => {
    expect(isNetworkError({ message: 'Network request failed' })).toBe(true);
  });

  it('returns false for credential errors', () => {
    expect(isNetworkError({ message: 'Invalid login credentials' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('getAuthErrorMessage', () => {
  it('returns user-friendly message for invalid credentials', () => {
    const msg = getAuthErrorMessage({ message: 'Invalid login credentials' });
    expect(msg).toContain('Invalid email or password');
  });

  it('returns user-friendly message for email not confirmed', () => {
    const msg = getAuthErrorMessage({ message: 'Email not confirmed' });
    expect(msg).toContain('confirm');
  });

  it('returns user-friendly message for already registered', () => {
    const msg = getAuthErrorMessage({ message: 'already registered' });
    expect(msg).toContain('already registered');
  });

  it('returns user-friendly message for rate limit', () => {
    const msg = getAuthErrorMessage({ message: 'Email rate limit exceeded' });
    expect(msg).toContain('Too many');
  });

  it('returns generic fallback for unknown errors', () => {
    const msg = getAuthErrorMessage({ message: 'something totally random happened' });
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
  });

  it('returns configuration message for "not configured"', () => {
    const msg = getAuthErrorMessage({ message: 'service not configured' });
    expect(msg).toContain('configuration');
  });
});

describe('getBackoffDelay', () => {
  it('returns baseDelay for first attempt', () => {
    expect(getBackoffDelay(1)).toBe(1000);
  });

  it('doubles delay for each subsequent attempt', () => {
    expect(getBackoffDelay(2)).toBe(2000);
    expect(getBackoffDelay(3)).toBe(4000);
    expect(getBackoffDelay(4)).toBe(8000);
  });

  it('caps at 8000ms', () => {
    expect(getBackoffDelay(10)).toBe(8000);
  });

  it('uses custom baseDelay', () => {
    expect(getBackoffDelay(1, 500)).toBe(500);
    expect(getBackoffDelay(2, 500)).toBe(1000);
  });
});

describe('generateCorrelationId', () => {
  it('generates a string', () => {
    expect(typeof generateCorrelationId()).toBe('string');
  });

  it('includes the prefix', () => {
    const id = generateCorrelationId('signin');
    expect(id.startsWith('signin_')).toBe(true);
  });

  it('defaults to "auth" prefix', () => {
    const id = generateCorrelationId();
    expect(id.startsWith('auth_')).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateCorrelationId()));
    expect(ids.size).toBe(20);
  });
});

describe('getAuthErrorRecoveryInstructions', () => {
  const makeError = (overrides: Partial<AuthError>): AuthError => ({
    category: 'unknown',
    code: 'unknown',
    message: '',
    userMessage: '',
    recoveryAction: 'retry',
    retryable: false,
    ...overrides,
  });

  it('returns retry instructions for "retry" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'retry' }));
    expect(instructions).toContain('try again');
  });

  it('returns credential instructions for "check_credentials" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'check_credentials' }));
    expect(instructions).toContain('email');
  });

  it('returns email verification instructions for "verify_email" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'verify_email' }));
    expect(instructions).toContain('inbox');
  });

  it('returns wait instructions for "try_later" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'try_later' }));
    expect(instructions).toContain('wait');
  });

  it('returns support instructions for "contact_support" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'contact_support' }));
    expect(instructions).toContain('support');
  });

  it('returns empty string for "none" action', () => {
    const instructions = getAuthErrorRecoveryInstructions(makeError({ recoveryAction: 'none' }));
    expect(instructions).toBe('');
  });
});

describe('AUTH_RETRY_CONFIG', () => {
  it('has required constants', () => {
    expect(AUTH_RETRY_CONFIG.MAX_ATTEMPTS).toBeGreaterThan(0);
    expect(AUTH_RETRY_CONFIG.AUTH_TIMEOUT).toBeGreaterThan(0);
    expect(AUTH_RETRY_CONFIG.PROFILE_TIMEOUT).toBeGreaterThan(0);
    expect(AUTH_RETRY_CONFIG.SIGNUP_TIMEOUT).toBeGreaterThan(0);
  });
});
