/**
 * Unit tests for Authentication Service
 */

import { resendVerification, checkEmailVerified } from '../../../lib/services/auth-service';

// Mock supabase
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      resend: jest.fn(),
      getSession: jest.fn(),
    },
  },
}));

const { supabase } = require('../../../lib/supabase');

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resendVerification', () => {
    it('should successfully resend verification email', async () => {
      supabase.auth.resend.mockResolvedValue({ error: null });

      const result = await resendVerification('test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Verification email sent');
      expect(supabase.auth.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'test@example.com',
      });
    });

    it('should handle lowercase and trim email', async () => {
      supabase.auth.resend.mockResolvedValue({ error: null });

      await resendVerification('  TEST@EXAMPLE.COM  ');

      expect(supabase.auth.resend).toHaveBeenCalledWith({
        type: 'signup',
        email: 'test@example.com',
      });
    });

    it('should handle resend error', async () => {
      const mockError = { message: 'Rate limit exceeded' };
      supabase.auth.resend.mockResolvedValue({ error: mockError });

      const result = await resendVerification('test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Rate limit exceeded');
    });

    it('should handle unexpected errors', async () => {
      supabase.auth.resend.mockRejectedValue(new Error('Network error'));

      const result = await resendVerification('test@example.com');

      expect(result.success).toBe(false);
      expect(result.message).toContain('unexpected error occurred');
    });
  });

  describe('checkEmailVerified', () => {
    it('should return true when email is verified', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              email_confirmed_at: '2024-01-01T00:00:00Z',
            },
          },
        },
      });

      const result = await checkEmailVerified();

      expect(result).toBe(true);
    });

    it('should return true when confirmed_at is set', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              confirmed_at: '2024-01-01T00:00:00Z',
            },
          },
        },
      });

      const result = await checkEmailVerified();

      expect(result).toBe(true);
    });

    it('should return false when email is not verified', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              email_confirmed_at: null,
              confirmed_at: null,
            },
          },
        },
      });

      const result = await checkEmailVerified();

      expect(result).toBe(false);
    });

    it('should return false when no session exists', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null },
      });

      const result = await checkEmailVerified();

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      supabase.auth.getSession.mockRejectedValue(new Error('Session error'));

      const result = await checkEmailVerified();

      expect(result).toBe(false);
    });
  });
});
