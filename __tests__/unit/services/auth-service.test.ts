/**
 * Unit tests for Authentication Service
 */

import { resendVerification, checkEmailVerified, requestPasswordReset, updatePassword, verifyResetToken, isInRecoveryMode } from '../../../lib/services/auth-service';

// Mock supabase
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    auth: {
      resend: jest.fn(),
      getSession: jest.fn(),
      resetPasswordForEmail: jest.fn(),
      updateUser: jest.fn(),
      verifyOtp: jest.fn(),
    },
  },
}));

// Mock password validation
jest.mock('../../../lib/utils/password-validation', () => ({
  validateNewPassword: jest.fn(),
}));

const { supabase } = require('../../../lib/supabase');
const { validateNewPassword } = require('../../../lib/utils/password-validation');

describe('Auth Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateNewPassword.mockReturnValue(null); // Default to valid password
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

  describe('requestPasswordReset', () => {
    it('should successfully request password reset', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      const result = await requestPasswordReset('test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('receive a password reset link');
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalled();
    });

    it('should normalize email to lowercase', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      await requestPasswordReset('  TEST@EXAMPLE.COM  ');

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
        expect.any(Object)
      );
    });

    it('should return error for invalid email format', async () => {
      const result = await requestPasswordReset('invalid-email');

      expect(result.success).toBe(false);
      expect(result.message).toContain('valid email');
      expect(supabase.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it('should handle rate limiting', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'rate limit exceeded' }
      });

      const result = await requestPasswordReset('test@example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('rate_limited');
    });

    it('should return success even for non-existent email (security)', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({
        error: { message: 'User not found' }
      });

      const result = await requestPasswordReset('nonexistent@example.com');

      // For security, we still return success
      expect(result.success).toBe(true);
    });

    it('should use custom redirect URL if provided', async () => {
      supabase.auth.resetPasswordForEmail.mockResolvedValue({ error: null });

      await requestPasswordReset('test@example.com', 'https://custom.app/reset');

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com',
        { redirectTo: 'https://custom.app/reset' }
      );
    });
  });

  describe('updatePassword', () => {
    it('should successfully update password', async () => {
      validateNewPassword.mockReturnValue(null);
      supabase.auth.updateUser.mockResolvedValue({ error: null });

      const result = await updatePassword('NewValidPass1!');

      expect(result.success).toBe(true);
      expect(result.message).toContain('successfully');
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: 'NewValidPass1!'
      });
    });

    it('should fail if password validation fails', async () => {
      validateNewPassword.mockReturnValue('Password is too weak');

      const result = await updatePassword('weak');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Password is too weak');
      expect(supabase.auth.updateUser).not.toHaveBeenCalled();
    });

    it('should handle expired token error', async () => {
      validateNewPassword.mockReturnValue(null);
      supabase.auth.updateUser.mockResolvedValue({
        error: { message: 'Token has expired' }
      });

      const result = await updatePassword('NewValidPass1!');

      expect(result.success).toBe(false);
      expect(result.error).toBe('token_expired');
      expect(result.message).toContain('expired');
    });

    it('should handle session expired error', async () => {
      validateNewPassword.mockReturnValue(null);
      supabase.auth.updateUser.mockResolvedValue({
        error: { message: 'User not authenticated' }
      });

      const result = await updatePassword('NewValidPass1!');

      expect(result.success).toBe(false);
      expect(result.error).toBe('session_expired');
    });

    it('should handle same password error', async () => {
      validateNewPassword.mockReturnValue(null);
      supabase.auth.updateUser.mockResolvedValue({
        error: { message: 'New password same as old password' }
      });

      const result = await updatePassword('SamePassword1!');

      expect(result.success).toBe(false);
      expect(result.error).toBe('same_password');
    });

    it('should handle unexpected errors', async () => {
      validateNewPassword.mockReturnValue(null);
      supabase.auth.updateUser.mockRejectedValue(new Error('Network error'));

      const result = await updatePassword('NewValidPass1!');

      expect(result.success).toBe(false);
      expect(result.message).toContain('unexpected error');
    });
  });

  describe('verifyResetToken', () => {
    it('should successfully verify valid token', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: { session: { user: { id: '123' } } },
        error: null
      });

      const result = await verifyResetToken('valid-token-hash');

      expect(result.success).toBe(true);
      expect(result.message).toContain('verified');
    });

    it('should fail for empty token', async () => {
      const result = await verifyResetToken('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
      expect(supabase.auth.verifyOtp).not.toHaveBeenCalled();
    });

    it('should handle expired token', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: {},
        error: { message: 'Token has expired' }
      });

      const result = await verifyResetToken('expired-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('token_expired');
    });

    it('should handle invalid token', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: {},
        error: { message: 'Token is invalid' }
      });

      const result = await verifyResetToken('invalid-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_token');
    });

    it('should fail when no session is returned', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: { session: null },
        error: null
      });

      const result = await verifyResetToken('no-session-token');

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_session');
    });

    it('should use correct token type', async () => {
      supabase.auth.verifyOtp.mockResolvedValue({
        data: { session: { user: { id: '123' } } },
        error: null
      });

      await verifyResetToken('token', 'recovery');

      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: 'token',
        type: 'recovery'
      });
    });
  });

  describe('isInRecoveryMode', () => {
    it('should return false when no session exists', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: { session: null }
      });

      const result = await isInRecoveryMode();

      expect(result).toBe(false);
    });

    it('should return true when in recovery mode', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              amr: [{ method: 'recovery' }]
            }
          }
        }
      });

      const result = await isInRecoveryMode();

      expect(result).toBe(true);
    });

    it('should return true when using OTP method', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              amr: [{ method: 'otp' }]
            }
          }
        }
      });

      const result = await isInRecoveryMode();

      expect(result).toBe(true);
    });

    it('should return false for normal password login', async () => {
      supabase.auth.getSession.mockResolvedValue({
        data: {
          session: {
            user: {
              amr: [{ method: 'password' }]
            }
          }
        }
      });

      const result = await isInRecoveryMode();

      expect(result).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      supabase.auth.getSession.mockRejectedValue(new Error('Session error'));

      const result = await isInRecoveryMode();

      expect(result).toBe(false);
    });
  });
});
