/**
 * Phone Verification Tests
 * Tests for phone verification service functionality
 */

import { 
  sendPhoneOTP, 
  verifyPhoneOTP, 
  checkPhoneVerified,
  updatePhoneNumber 
} from '../../../lib/services/phone-verification-service';

// Mock Supabase
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: jest.fn(),
      verifyOtp: jest.fn(),
      getSession: jest.fn(),
      updateUser: jest.fn(),
    },
  },
}));

describe('Phone Verification Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sendPhoneOTP', () => {
    it('should successfully send OTP to valid phone number', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.signInWithOtp.mockResolvedValue({ error: null });

      const result = await sendPhoneOTP('+15551234567');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('sent');
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        phone: '+15551234567',
      });
    });

    it('should format US phone numbers to E.164', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.signInWithOtp.mockResolvedValue({ error: null });

      await sendPhoneOTP('5551234567');
      
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        phone: '+15551234567',
      });
    });

    it('should handle rate limiting errors', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.signInWithOtp.mockResolvedValue({
        error: { message: 'Rate limit exceeded' },
      });

      const result = await sendPhoneOTP('+15551234567');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Too many attempts');
      expect(result.error).toBe('rate_limited');
    });

    it('should reject invalid phone numbers', async () => {
      const result = await sendPhoneOTP('123');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('valid phone number');
      expect(result.error).toBe('invalid_phone');
    });

    it('should handle network errors gracefully', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.signInWithOtp.mockRejectedValue(new Error('Network error'));

      const result = await sendPhoneOTP('+15551234567');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('unexpected error');
    });
  });

  describe('verifyPhoneOTP', () => {
    it('should successfully verify valid OTP', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.verifyOtp.mockResolvedValue({
        data: { session: { user: { id: '123' } } },
        error: null,
      });
      supabase.auth.updateUser.mockResolvedValue({ error: null });

      const result = await verifyPhoneOTP('+15551234567', '123456');
      
      expect(result.success).toBe(true);
      expect(result.message).toContain('verified successfully');
    });

    it('should reject invalid OTP format', async () => {
      const result = await verifyPhoneOTP('+15551234567', '12345');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('6-digit code');
      expect(result.error).toBe('invalid_token');
    });

    it('should reject non-numeric OTP', async () => {
      const result = await verifyPhoneOTP('+15551234567', 'abcdef');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should handle expired OTP', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.verifyOtp.mockResolvedValue({
        error: { message: 'Token expired' },
      });

      const result = await verifyPhoneOTP('+15551234567', '123456');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('expired');
      expect(result.error).toBe('token_expired');
    });

    it('should handle incorrect OTP', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.verifyOtp.mockResolvedValue({
        error: { message: 'Invalid token' },
      });

      const result = await verifyPhoneOTP('+15551234567', '123456');
      
      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid verification code');
      expect(result.error).toBe('invalid_token');
    });
  });

  describe('checkPhoneVerified', () => {
    it('should return true when phone is verified', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              phone: '+15551234567',
              user_metadata: { phone_verified: true },
            },
          },
        },
      });

      const result = await checkPhoneVerified();
      expect(result).toBe(true);
    });

    it('should return false when phone not verified', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              phone: '+15551234567',
              user_metadata: { phone_verified: false },
            },
          },
        },
      });

      const result = await checkPhoneVerified();
      expect(result).toBe(false);
    });

    it('should return false when no session', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
      });

      const result = await checkPhoneVerified();
      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.getSession.mockRejectedValue(new Error('Network error'));

      const result = await checkPhoneVerified();
      expect(result).toBe(false);
    });
  });

  describe('updatePhoneNumber', () => {
    it('should successfully update phone number', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.updateUser.mockResolvedValue({ error: null });

      const result = await updatePhoneNumber('+15551234567');
      
      expect(result.success).toBe(true);
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        phone: '+15551234567',
        data: { phone_verified: false },
      });
    });

    it('should reset verification status when phone changes', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.updateUser.mockResolvedValue({ error: null });

      await updatePhoneNumber('+15551234567');
      
      expect(supabase.auth.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { phone_verified: false },
        })
      );
    });

    it('should handle update errors', async () => {
      const { supabase } = require('../../../lib/supabase');
      supabase.auth.updateUser.mockResolvedValue({
        error: { message: 'Update failed' },
      });

      const result = await updatePhoneNumber('+15551234567');
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });
  });
});

describe('Phone Verification Integration', () => {
  // Integration tests
  it.todo('should complete full verification flow');
  it.todo('should handle OTP resend correctly');
  it.todo('should enforce rate limits');
  it.todo('should handle international phone numbers');
});
