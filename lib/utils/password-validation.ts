/**
 * Password Validation Utilities
 * Provides comprehensive password strength checking and validation
 * for the password reset workflow and other authentication flows.
 */

export interface PasswordStrengthResult {
  score: number; // 0-4 (0 = very weak, 4 = very strong)
  level: 'very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong';
  feedback: string[];
  isValid: boolean;
  requirements: PasswordRequirementStatus[];
}

export interface PasswordRequirementStatus {
  id: string;
  label: string;
  met: boolean;
}

/**
 * Password requirements configuration
 * These align with security best practices and the existing strongPassword pattern
 */
export const PASSWORD_REQUIREMENTS = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: true,
  specialChars: '@$!%*?&',
};

// Pre-compiled regex patterns for performance
const SPECIAL_CHAR_REGEX = new RegExp(
  `[${PASSWORD_REQUIREMENTS.specialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`
);

/** Pre-compiled email regex for validation */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate email format using pre-compiled regex
 */
export function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim());
}

/**
 * Check individual password requirements
 */
export function checkPasswordRequirements(password: string): PasswordRequirementStatus[] {
  const requirements: PasswordRequirementStatus[] = [
    {
      id: 'length',
      label: `At least ${PASSWORD_REQUIREMENTS.minLength} characters`,
      met: password.length >= PASSWORD_REQUIREMENTS.minLength,
    },
    {
      id: 'uppercase',
      label: 'One uppercase letter (A-Z)',
      met: /[A-Z]/.test(password),
    },
    {
      id: 'lowercase',
      label: 'One lowercase letter (a-z)',
      met: /[a-z]/.test(password),
    },
    {
      id: 'number',
      label: 'One number (0-9)',
      met: /\d/.test(password),
    },
    {
      id: 'special',
      label: `One special character (${PASSWORD_REQUIREMENTS.specialChars})`,
      met: SPECIAL_CHAR_REGEX.test(password),
    },
  ];

  return requirements;
}

/**
 * Calculate password strength score and level
 */
export function calculatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password || password.length === 0) {
    return {
      score: 0,
      level: 'very-weak',
      feedback: ['Password is required'],
      isValid: false,
      requirements: checkPasswordRequirements(''),
    };
  }

  const requirements = checkPasswordRequirements(password);
  const metCount = requirements.filter((r) => r.met).length;
  const feedback: string[] = [];

  // Calculate base score from requirements (0-5 points)
  let score = metCount;

  // Bonus for extra length beyond minimum
  if (password.length >= 12) score += 0.5;
  if (password.length >= 16) score += 0.5;

  // Penalty for common patterns
  if (/^[a-zA-Z]+$/.test(password)) {
    score -= 0.5;
    feedback.push('Add numbers or special characters for a stronger password');
  }

  if (/^[0-9]+$/.test(password)) {
    score -= 1;
    feedback.push('Include letters for a stronger password');
  }

  // Check for common weak patterns
  const commonPatterns = [
    /^123456/i,
    /password/i,
    /qwerty/i,
    /abc123/i,
    /letmein/i,
    /welcome/i,
    /monkey/i,
    /dragon/i,
    /master/i,
    /admin/i,
  ];

  for (const pattern of commonPatterns) {
    if (pattern.test(password)) {
      score -= 1;
      feedback.push('Avoid common passwords or patterns');
      break;
    }
  }

  // Check for sequential characters
  if (/(.)\1{2,}/.test(password)) {
    score -= 0.5;
    feedback.push('Avoid repeating characters');
  }

  // Normalize score to 0-4 range
  const normalizedScore = Math.max(0, Math.min(4, Math.round(score)));

  // Determine level based on normalized score
  const levels: ('very-weak' | 'weak' | 'fair' | 'strong' | 'very-strong')[] = [
    'very-weak',
    'weak',
    'fair',
    'strong',
    'very-strong',
  ];
  const level = levels[normalizedScore];

  // Add feedback for unmet requirements
  const unmetRequirements = requirements.filter((r) => !r.met);
  if (unmetRequirements.length > 0) {
    feedback.push(...unmetRequirements.map((r) => `Missing: ${r.label.toLowerCase()}`));
  }

  // Password is valid only if all requirements are met
  const isValid = metCount === requirements.length;

  return {
    score: normalizedScore,
    level,
    feedback,
    isValid,
    requirements,
  };
}

/**
 * Validate new password against requirements
 * Returns null if valid, error message if invalid
 */
export function validateNewPassword(password: string): string | null {
  if (!password || password.length === 0) {
    return 'Password is required';
  }

  if (password.length < PASSWORD_REQUIREMENTS.minLength) {
    return `Password must be at least ${PASSWORD_REQUIREMENTS.minLength} characters`;
  }

  if (password.length > PASSWORD_REQUIREMENTS.maxLength) {
    return `Password must not exceed ${PASSWORD_REQUIREMENTS.maxLength} characters`;
  }

  const strength = calculatePasswordStrength(password);
  if (!strength.isValid) {
    const unmet = strength.requirements.filter((r) => !r.met);
    if (unmet.length > 0) {
      return `Password must include: ${unmet.map((r) => r.label.toLowerCase()).join(', ')}`;
    }
    return 'Password does not meet security requirements';
  }

  return null;
}

/**
 * Validate password confirmation matches
 */
export function validatePasswordMatch(password: string, confirmPassword: string): string | null {
  if (!confirmPassword || confirmPassword.length === 0) {
    return 'Please confirm your password';
  }

  if (password !== confirmPassword) {
    return 'Passwords do not match';
  }

  return null;
}

/**
 * Get color for password strength indicator
 */
export function getStrengthColor(level: PasswordStrengthResult['level']): string {
  switch (level) {
    case 'very-weak':
      return '#ef4444'; // red
    case 'weak':
      return '#f97316'; // orange
    case 'fair':
      return '#eab308'; // yellow
    case 'strong':
      return '#22c55e'; // green
    case 'very-strong':
      return '#008e2a'; // emerald
    default:
      return '#6b7280'; // gray
  }
}

/**
 * Get width percentage for password strength bar
 */
export function getStrengthWidth(score: number): number {
  return Math.max(5, (score / 4) * 100);
}
