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

/** Common email providers used for typo suggestions */
const COMMON_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'icloud.com',
  'aol.com',
  'protonmail.com',
  'live.com',
  'me.com',
  'msn.com',
];

/**
 * Compute Levenshtein edit distance between two strings.
 * Used internally to detect near-miss domain typos.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Suggest a corrected email address when the domain looks like a typo
 * of a common provider (edit distance ≤ 2).
 * Returns the suggested email string, or null if no suggestion.
 *
 * Examples:
 *   "kcw.diy@gmail.comk"      → "kcw.diy@gmail.com"
 *   "user@gmuil.com"          → "user@gmail.com"
 *   "user@gmail.com"          → null  (already correct)
 */
export function suggestEmailCorrection(email: string): string | null {
  if (!email || !email.includes('@')) return null;
  const atIndex = email.lastIndexOf('@');
  const localPart = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1).trim().toLowerCase();
  if (!localPart || !domain) return null;

  for (const common of COMMON_EMAIL_DOMAINS) {
    if (domain === common) return null; // already correct
    if (levenshtein(domain, common) <= 2) {
      return `${localPart}@${common}`;
    }
  }
  return null;
}

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
