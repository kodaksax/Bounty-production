/**
 * Authentication Service
 * Handles email verification, password reset, and other auth-related operations
 */

import { supabase } from '../supabase'
import { validateNewPassword, isValidEmail } from '../utils/password-validation'

/**
 * Result type for authentication operations
 */
export interface AuthResult {
  success: boolean;
  message: string;
  error?: string;
}

/**
 * Resend verification email to the user
 * Email verification gate: Triggers backend to send verification link
 * 
 * @param email - User's email address
 * @returns Promise that resolves when the request completes
 */
export async function resendVerification(email: string): Promise<AuthResult> {
  try {
    // Supabase provides a built-in resend method
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
    })

    if (error) {
      console.error('[auth-service] Failed to resend verification:', error)
      return {
        success: false,
        message: error.message || 'Failed to resend verification email',
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Verification email sent! Please check your inbox.',
    }
  } catch (error: any) {
    console.error('[auth-service] Unexpected error resending verification:', error)
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    }
  }
}

/**
 * Check if the current user's email is verified
 * Email verification gate: Helper to check verification status
 * 
 * @returns Promise<boolean> - true if email is verified
 */
export async function checkEmailVerified(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    return Boolean(
      session?.user?.email_confirmed_at ||
      session?.user?.confirmed_at
    )
  } catch (error) {
    console.error('[auth-service] Error checking email verification:', error)
    return false
  }
}

/**
 * Request a password reset email
 * Sends a secure reset link to the user's email address
 * 
 * Security considerations:
 * - Always returns success message to prevent email enumeration
 * - Uses Supabase's built-in rate limiting
 * - Token expires after configured time (default 1 hour in Supabase)
 * 
 * @param email - User's email address
 * @param redirectTo - Optional redirect URL after password reset (for deep linking)
 * @returns Promise with result of the operation
 */
export async function requestPasswordReset(
  email: string, 
  redirectTo?: string
): Promise<AuthResult> {
  try {
    // Validate email format using pre-compiled regex
    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return {
        success: false,
        message: 'Please enter a valid email address',
        error: 'Invalid email format',
      }
    }

    // Use environment variable for redirect URL, with fallback
    const resetRedirectUrl = redirectTo || 
      process.env.EXPO_PUBLIC_AUTH_REDIRECT_URL || 
      'bountyexpo://auth/update-password'

    const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: resetRedirectUrl,
    })

    if (error) {
      console.error('[auth-service] Password reset request error:', error)
      
      // Handle rate limiting specifically
      if (error.message.includes('rate limit') || error.message.includes('too many requests')) {
        return {
          success: false,
          message: 'Too many requests. Please wait a few minutes before trying again.',
          error: 'rate_limited',
        }
      }

      // For security, we don't reveal whether the email exists or not
      // Instead, we log the actual error and return a generic success message
      console.warn('[auth-service] Password reset error (returning success for security):', error.message)
    }

    // Always return success to prevent email enumeration attacks
    return {
      success: true,
      message: 'If an account exists with this email, you will receive a password reset link shortly.',
    }
  } catch (error: any) {
    console.error('[auth-service] Unexpected error in password reset request:', error)
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    }
  }
}

/**
 * Update user's password after verification via reset token
 * This is called after the user clicks the reset link and enters a new password
 * 
 * Security considerations:
 * - Validates password strength before updating
 * - Supabase handles token validation and expiration
 * - Password is securely hashed by Supabase
 * 
 * @param newPassword - The new password to set
 * @returns Promise with result of the operation
 */
export async function updatePassword(newPassword: string): Promise<AuthResult> {
  try {
    // Validate password strength
    const passwordError = validateNewPassword(newPassword)
    if (passwordError) {
      return {
        success: false,
        message: passwordError,
        error: 'password_validation_failed',
      }
    }

    // Update the password via Supabase
    // This requires the user to be authenticated with a valid reset token
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    })

    if (error) {
      console.error('[auth-service] Password update error:', error)

      // Handle specific error cases
      if (error.message.includes('Token has expired')) {
        return {
          success: false,
          message: 'Your reset link has expired. Please request a new password reset.',
          error: 'token_expired',
        }
      }

      if (error.message.includes('session') || error.message.includes('authenticated')) {
        return {
          success: false,
          message: 'Your session has expired. Please request a new password reset link.',
          error: 'session_expired',
        }
      }

      if (error.message.includes('same as')) {
        return {
          success: false,
          message: 'New password cannot be the same as your current password.',
          error: 'same_password',
        }
      }

      return {
        success: false,
        message: 'Failed to update password. Please try again or request a new reset link.',
        error: error.message,
      }
    }

    return {
      success: true,
      message: 'Password updated successfully! You can now sign in with your new password.',
    }
  } catch (error: any) {
    console.error('[auth-service] Unexpected error updating password:', error)
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    }
  }
}

/**
 * Verify and exchange a password reset token
 * This is called when the user clicks the reset link from their email
 * 
 * @param token - The reset token from the URL
 * @param type - The type of token (typically 'recovery' for password reset)
 * @returns Promise with result of the verification
 */
export async function verifyResetToken(
  token: string, 
  type: 'recovery' | 'signup' | 'invite' | 'email' = 'recovery'
): Promise<AuthResult> {
  try {
    if (!token || token.trim().length === 0) {
      return {
        success: false,
        message: 'Invalid or missing reset token.',
        error: 'invalid_token',
      }
    }

    // Exchange the token for a session
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: token,
      type: type,
    })

    if (error) {
      console.error('[auth-service] Token verification error:', error)

      if (error.message.includes('expired')) {
        return {
          success: false,
          message: 'Your reset link has expired. Please request a new one.',
          error: 'token_expired',
        }
      }

      if (error.message.includes('invalid') || error.message.includes('not found')) {
        return {
          success: false,
          message: 'Invalid reset link. Please request a new password reset.',
          error: 'invalid_token',
        }
      }

      return {
        success: false,
        message: 'Failed to verify reset link. Please try again.',
        error: error.message,
      }
    }

    if (!data.session) {
      return {
        success: false,
        message: 'Could not establish session. Please try again.',
        error: 'no_session',
      }
    }

    return {
      success: true,
      message: 'Token verified successfully. You can now set a new password.',
    }
  } catch (error: any) {
    console.error('[auth-service] Unexpected error verifying token:', error)
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    }
  }
}

/**
 * Check if the current session is from a password recovery flow
 * Useful for determining if user is in password reset mode
 * 
 * @returns Promise<boolean> - true if in recovery mode
 */
export async function isInRecoveryMode(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    // Supabase sets aal to 'aal1' or has specific metadata during recovery
    // We check if there's a session but no confirmed email (recovery state)
    if (!session) return false
    
    // Check if the session was created via recovery
    // The amr (Authentication Methods Reference) is available on the user object at runtime
    // but may not be typed in all Supabase versions
    const user = session.user as any
    const amr = user?.amr
    if (amr && Array.isArray(amr)) {
      return amr.some((method: { method: string }) => 
        method.method === 'recovery' || method.method === 'otp'
      )
    }
    
    return false
  } catch (error) {
    console.error('[auth-service] Error checking recovery mode:', error)
    return false
  }
}
