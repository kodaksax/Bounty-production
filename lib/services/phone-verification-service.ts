/**
 * Phone Verification Service
 * Handles phone number verification via SMS OTP
 * Uses Supabase Phone Auth or can be extended to use Twilio
 */

import { supabase } from '../supabase';

export interface PhoneVerificationResult {
  success: boolean;
  message: string;
  error?: string;
}

// Constants for phone validation
const MIN_PHONE_LENGTH = 10; // Minimum digits for most countries
const OTP_LENGTH = 6; // Standard OTP length
const OTP_PATTERN = /^\d{6}$/; // Regex for 6-digit numeric OTP

/**
 * Format phone number to E.164 format
 * If phone already has country code, use it
 * Otherwise, assume US/Canada (+1) for backwards compatibility
 * 
 * @param phone - Phone number to format
 * @returns E.164 formatted phone number
 */
function formatToE164(phone: string): string {
  const cleanPhone = phone.replace(/\D/g, '');
  
  // If already has country code (starts with +), return as-is
  if (phone.startsWith('+')) {
    return phone;
  }
  
  // Default to +1 (US/Canada) for backwards compatibility
  // TODO (Post-Launch - international-phone-support): Add country code selection in UI for international support
  // Track this enhancement: https://github.com/kodaksax/bountyexpo/issues/TBD
  return `+1${cleanPhone}`;
}

/**
 * Send OTP to phone number
 * Uses Supabase phone authentication
 * 
 * @param phone - Phone number in E.164 format (e.g., +1234567890) or local format
 * @returns Promise with result of the operation
 */
export async function sendPhoneOTP(phone: string): Promise<PhoneVerificationResult> {
  try {
    // Validate phone format (basic validation)
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length < MIN_PHONE_LENGTH) {
      return {
        success: false,
        message: 'Please enter a valid phone number',
        error: 'invalid_phone',
      };
    }

    // Format to E.164
    const e164Phone = formatToE164(phone);

    // Use Supabase phone auth to send OTP
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164Phone,
    });

    if (error) {
      console.error('[phone-verification] Failed to send OTP:', error);

      // Handle rate limiting
      if (error.message.includes('rate limit') || error.message.includes('too many')) {
        // Extract retry-after information from error if available
        let waitTime = 'a few minutes'; // Default message
        
        // Try to parse retry duration from error message
        // Common patterns: "retry in 60 seconds", "wait 2 minutes", "try again in 5m"
        const retryMatch = error.message.match(/(\d+)\s*(second|minute|min|sec|s|m)/i);
        if (retryMatch) {
          const value = parseInt(retryMatch[1]);
          const unit = retryMatch[2].toLowerCase();
          
          if (unit.startsWith('s')) {
            waitTime = value === 1 ? '1 second' : `${value} seconds`;
          } else if (unit.startsWith('m')) {
            waitTime = value === 1 ? '1 minute' : `${value} minutes`;
          }
        }
        
        return {
          success: false,
          message: `Too many attempts. Please wait ${waitTime} before trying again.`,
          error: 'rate_limited',
        };
      }

      return {
        success: false,
        message: error.message || 'Failed to send verification code',
        error: error.message,
      };
    }

    return {
      success: true,
      message: 'Verification code sent to your phone',
    };
  } catch (error: any) {
    console.error('[phone-verification] Unexpected error sending OTP:', error);
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    };
  }
}

/**
 * Verify OTP code
 * 
 * @param phone - Phone number in E.164 format or local format
 * @param token - 6-digit OTP code
 * @returns Promise with result of the operation
 */
export async function verifyPhoneOTP(
  phone: string,
  token: string
): Promise<PhoneVerificationResult> {
  try {
    // Validate token format
    if (!token || token.length !== OTP_LENGTH || !OTP_PATTERN.test(token)) {
      return {
        success: false,
        message: `Please enter a valid ${OTP_LENGTH}-digit code`,
        error: 'invalid_token',
      };
    }

    // Format phone to E.164
    const e164Phone = formatToE164(phone);

    // Verify OTP with Supabase
    const { data, error } = await supabase.auth.verifyOtp({
      phone: e164Phone,
      token,
      type: 'sms',
    });

    if (error) {
      console.error('[phone-verification] Failed to verify OTP:', error);

      if (error.message.includes('expired')) {
        return {
          success: false,
          message: 'Verification code has expired. Please request a new one.',
          error: 'token_expired',
        };
      }

      if (error.message.includes('invalid') || error.message.includes('incorrect')) {
        return {
          success: false,
          message: 'Invalid verification code. Please try again.',
          error: 'invalid_token',
        };
      }

      return {
        success: false,
        message: 'Failed to verify code. Please try again.',
        error: error.message,
      };
    }

    if (!data.session) {
      return {
        success: false,
        message: 'Could not establish verified session.',
        error: 'no_session',
      };
    }

    // Update user metadata to mark phone as verified
    await supabase.auth.updateUser({
      data: {
        phone_verified: true,
        phone_verified_at: new Date().toISOString(),
      },
    });

    return {
      success: true,
      message: 'Phone number verified successfully!',
    };
  } catch (error: any) {
    console.error('[phone-verification] Unexpected error verifying OTP:', error);
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    };
  }
}

/**
 * Check if current user's phone is verified
 * 
 * @returns Promise<boolean> - true if phone is verified
 */
export async function checkPhoneVerified(): Promise<boolean> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    
    // Check if phone is in user metadata and verified
    return Boolean(
      session?.user?.phone &&
      session?.user?.user_metadata?.phone_verified
    );
  } catch (error) {
    console.error('[phone-verification] Error checking phone verification:', error);
    return false;
  }
}

/**
 * Update phone number in user profile
 * This does NOT verify the phone - use sendPhoneOTP + verifyPhoneOTP for verification
 * 
 * @param phone - Phone number to store
 * @returns Promise with result of the operation
 */
export async function updatePhoneNumber(phone: string): Promise<PhoneVerificationResult> {
  try {
    const e164Phone = formatToE164(phone);

    const { error } = await supabase.auth.updateUser({
      phone: e164Phone,
      data: {
        phone_verified: false, // Reset verification when phone changes
      },
    });

    if (error) {
      console.error('[phone-verification] Failed to update phone:', error);
      return {
        success: false,
        message: error.message || 'Failed to update phone number',
        error: error.message,
      };
    }

    return {
      success: true,
      message: 'Phone number updated. Please verify to complete setup.',
    };
  } catch (error: any) {
    console.error('[phone-verification] Unexpected error updating phone:', error);
    return {
      success: false,
      message: 'An unexpected error occurred. Please try again later.',
      error: error?.message,
    };
  }
}
