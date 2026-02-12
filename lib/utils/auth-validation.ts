// lib/utils/auth-validation.ts - Validation utilities for authentication forms

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors: Record<string, string>;
}

/**
 * Validate email format
 */
import { isValidEmail } from './password-validation';

export function validateEmail(email: string): string | null {
  if (!email || email.trim().length === 0) {
    return 'Email is required';
  }

  const normalized = email.trim().toLowerCase()
  if (!isValidEmail(normalized)) {
    return 'Invalid email address';
  }

  return null;
}

/**
 * Validate username format
 * Must be 3-24 characters, alphanumeric and underscore only
 */
export function validateUsername(username: string): string | null {
  if (!username || username.trim().length === 0) {
    return 'Username is required';
  }
  
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
    return 'Username must be 3-24 characters (letters, numbers, underscore only)';
  }
  
  return null;
}

/**
 * Validate password strength
 * Minimum 6 characters for now, backend may enforce stronger rules
 */
export function validatePassword(password: string): string | null {
  if (!password || password.length === 0) {
    return 'Password is required';
  }
  
  if (password.length < 6) {
    return 'Password must be at least 6 characters';
  }
  
  return null;
}

/**
 * Validate password confirmation matches
 */
export function validatePasswordMatch(password: string, confirmPassword: string): string | null {
  if (password !== confirmPassword) {
    return 'Passwords do not match';
  }
  
  return null;
}

/**
 * Validate sign-up form data
 */
export function validateSignUpForm(
  email: string,
  username: string,
  password: string,
  confirmPassword: string
): ValidationResult {
  const errors: Record<string, string> = {};
  
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  
  const usernameError = validateUsername(username);
  if (usernameError) errors.username = usernameError;
  
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;
  
  const matchError = validatePasswordMatch(password, confirmPassword);
  if (matchError) errors.confirmPassword = matchError;
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Validate sign-in form data
 */
export function validateSignInForm(
  identifier: string,
  password: string
): ValidationResult {
  const errors: Record<string, string> = {};
  
  if (!identifier || identifier.trim().length === 0) {
    errors.identifier = 'Email or username is required';
  }
  
  const passwordError = validatePassword(password);
  if (passwordError) errors.password = passwordError;
  
  return {
    isValid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * Get user-friendly error message from API error
 */
export function getAuthErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  
  if (error instanceof Error) {
    // Check for network errors
    if (error.message.includes('fetch') || error.message.includes('network')) {
      return 'Network error. Please check your connection and try again.';
    }
    
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
}
