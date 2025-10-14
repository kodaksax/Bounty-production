/**
 * Authentication Service
 * Handles email verification and other auth-related operations
 */

import { supabase } from '../supabase'

/**
 * Resend verification email to the user
 * Email verification gate: Triggers backend to send verification link
 * 
 * @param email - User's email address
 * @returns Promise that resolves when the request completes
 */
export async function resendVerification(email: string): Promise<{ success: boolean; message: string }> {
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
