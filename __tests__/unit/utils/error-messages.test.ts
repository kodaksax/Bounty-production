/**
 * Unit tests for error message utilities
 */

import {
  getUserFriendlyError,
  sanitizeErrorMessage,
  getValidationError,
  getPaymentErrorMessage,
  PAYMENT_ERROR_MESSAGES,
} from '../../../lib/utils/error-messages';

describe('Error Messages', () => {
  describe('getUserFriendlyError', () => {
    describe('Network errors', () => {
      it('should handle network request failed errors', () => {
        const error = { message: 'Network request failed' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('network');
        expect(result.title).toBe('Connection Error');
        expect(result.action).toBe('Retry');
        expect(result.retryable).toBe(true);
      });

      it('should handle ECONNREFUSED errors', () => {
        const error = { code: 'ECONNREFUSED' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('network');
        expect(result.retryable).toBe(true);
      });

      it('should handle Failed to fetch errors', () => {
        const error = { message: 'Failed to fetch' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('network');
      });

      it('should handle timeout errors', () => {
        const error = { message: 'Request timeout exceeded' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('network');
        expect(result.title).toBe('Request Timeout');
        expect(result.retryable).toBe(true);
      });
    });

    describe('Navigation context errors', () => {
      it('should handle navigation context not found error', () => {
        const error = { message: "Couldn't find a navigation object. Is your component inside NavigationContainer?" };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('navigation');
        expect(result.title).toBe('Navigation Error');
        expect(result.message).toContain('restart the app');
        expect(result.retryable).toBe(false);
      });

      it('should handle NavigationContent error', () => {
        const error = { message: 'Component not inside NavigationContent' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('navigation');
      });
    });

    describe('Authentication errors', () => {
      it('should handle 401 status errors', () => {
        const error = { status: 401 };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authentication');
        expect(result.title).toBe('Session Expired');
        expect(result.action).toBe('Sign In');
        expect(result.retryable).toBe(false);
      });

      it('should handle Unauthorized message', () => {
        const error = { message: 'Unauthorized access' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authentication');
      });
    });

    describe('Authorization errors', () => {
      it('should handle 403 status errors', () => {
        const error = { status: 403 };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authorization');
        expect(result.title).toBe('Access Denied');
      });

      it('should handle Forbidden message', () => {
        const error = { message: 'Forbidden resource' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authorization');
      });
    });

    describe('Rate limiting errors', () => {
      it('should handle 429 status errors', () => {
        const error = { status: 429 };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('rate_limit');
        expect(result.title).toBe('Please Slow Down');
        expect(result.action).toBe('Wait & Retry');
        expect(result.retryable).toBe(true);
      });

      it('should handle rate limit message', () => {
        const error = { message: 'Rate limit exceeded' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('rate_limit');
      });
    });

    describe('Supabase errors', () => {
      it('should handle JWT expired errors', () => {
        const error = { message: 'JWT expired' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authentication');
        expect(result.title).toBe('Session Expired');
      });

      it('should handle row-level security errors', () => {
        const error = { message: 'new row violates row-level security policy' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('authorization');
        expect(result.title).toBe('Access Denied');
      });

      it('should handle duplicate key errors (23505)', () => {
        const error = { code: '23505', message: 'duplicate key value' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('validation');
        expect(result.title).toBe('Already Exists');
      });

      it('should handle PGRST116 not found errors', () => {
        const error = { code: 'PGRST116', message: 'The result contains no rows' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('not_found');
      });
    });

    describe('Stripe errors', () => {
      it('should handle card_error type', () => {
        const error = { type: 'card_error', code: 'card_declined' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('payment');
        expect(result.title).toBe('Payment Failed');
      });

      it('should handle authentication_required', () => {
        const error = { type: 'stripe_error', code: 'authentication_required' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('payment');
        expect(result.title).toBe('Verification Required');
      });

      it('should handle rate_limit_error type', () => {
        const error = { type: 'rate_limit_error' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('rate_limit');
      });

      it('should handle api_error type', () => {
        const error = { type: 'api_error' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('server');
        expect(result.title).toBe('Payment Service Error');
      });
    });

    describe('Server errors', () => {
      it('should handle 500 status errors', () => {
        const error = { status: 500 };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('server');
        expect(result.title).toBe('Server Error');
        expect(result.retryable).toBe(true);
      });

      it('should handle Internal Server Error message', () => {
        const error = { message: 'Internal Server Error' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('server');
      });
    });

    describe('Unknown errors', () => {
      it('should handle unknown errors with safe message', () => {
        const error = { message: 'Random error' };
        const result = getUserFriendlyError(error);
        
        expect(result.type).toBe('unknown');
        expect(result.title).toBe('Something Went Wrong');
        expect(result.retryable).toBe(true);
      });

      it('should handle null/undefined errors', () => {
        const result = getUserFriendlyError(null);
        
        expect(result.type).toBe('unknown');
        expect(result.message).toBeDefined();
      });
    });
  });

  describe('sanitizeErrorMessage', () => {
    it('should sanitize navigation context errors', () => {
      const result = sanitizeErrorMessage({ message: "Couldn't find a navigation object" });
      
      expect(result).not.toContain('navigation');
      expect(result).toContain('unexpected error');
    });

    it('should sanitize SQL-related errors', () => {
      const result = sanitizeErrorMessage({ message: 'column "user_id" does not exist' });
      
      expect(result).not.toContain('column');
      expect(result).not.toContain('user_id');
    });

    it('should sanitize stack trace patterns', () => {
      const result = sanitizeErrorMessage({ message: 'Error at Component.tsx:42:10' });
      
      expect(result).not.toContain('.tsx');
      expect(result).not.toContain(':42');
    });

    it('should sanitize Supabase references', () => {
      const result = sanitizeErrorMessage({ message: 'Supabase query failed with PGRST116' });
      
      expect(result).not.toContain('Supabase');
      expect(result).not.toContain('PGRST');
    });

    it('should sanitize Stripe key patterns', () => {
      const result = sanitizeErrorMessage({ message: 'Invalid key: sk_test_123456' });
      
      expect(result).not.toContain('sk_test_');
    });

    it('should preserve safe messages', () => {
      const safeMessage = 'Please enter a valid email address';
      const result = sanitizeErrorMessage({ message: safeMessage });
      
      expect(result).toBe(safeMessage);
    });
  });

  describe('getValidationError', () => {
    it('should format required field errors', () => {
      const result = getValidationError('email', 'required');
      
      expect(result).toBe('Email is required');
    });

    it('should format email validation errors', () => {
      const result = getValidationError('email', 'invalid email format');
      
      expect(result).toBe('Please enter a valid email address');
    });

    it('should format password validation errors', () => {
      const result = getValidationError('password', 'password too short');
      
      expect(result).toBe('Password must be at least 8 characters');
    });

    it('should format min length errors', () => {
      const result = getValidationError('username', 'must be at least min 3 characters');
      
      expect(result).toContain('Username');
      expect(result).toContain('3');
    });

    it('should format max length errors', () => {
      const result = getValidationError('bio', 'must be no more than max 500 characters');
      
      expect(result).toContain('Bio');
      expect(result).toContain('500');
    });
  });

  describe('getPaymentErrorMessage', () => {
    it('should return correct message for card_declined', () => {
      const result = getPaymentErrorMessage({ code: 'card_declined' });
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.card_declined);
    });

    it('should return correct message for insufficient_funds', () => {
      const result = getPaymentErrorMessage({ code: 'insufficient_funds' });
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.insufficient_funds);
    });

    it('should return correct message for expired_card', () => {
      const result = getPaymentErrorMessage({ code: 'expired_card' });
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.expired_card);
    });

    it('should return correct message for decline_code', () => {
      const result = getPaymentErrorMessage({ decline_code: 'incorrect_cvc' });
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.incorrect_cvc);
    });

    it('should return generic message for unknown codes', () => {
      const result = getPaymentErrorMessage({ code: 'unknown_error_code' });
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.generic);
    });

    it('should return generic message for null error', () => {
      const result = getPaymentErrorMessage(null);
      
      expect(result).toBe(PAYMENT_ERROR_MESSAGES.generic);
    });
  });
});
