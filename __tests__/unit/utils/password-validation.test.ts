/**
 * Unit tests for Password Validation Utilities
 */

import {
  PASSWORD_REQUIREMENTS,
  checkPasswordRequirements,
  calculatePasswordStrength,
  validateNewPassword,
  validatePasswordMatch,
  getStrengthColor,
  getStrengthWidth,
  isValidEmail,
  EMAIL_REGEX,
} from '../../../lib/utils/password-validation';

describe('Password Validation', () => {
  describe('isValidEmail', () => {
    it('should return true for valid email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@domain.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.org')).toBe(true);
    });

    it('should return false for invalid email addresses', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user name@example.com')).toBe(false);
    });

    it('should trim whitespace before validation', () => {
      expect(isValidEmail('  test@example.com  ')).toBe(true);
    });
  });

  describe('EMAIL_REGEX', () => {
    it('should be a valid regex pattern', () => {
      expect(EMAIL_REGEX).toBeInstanceOf(RegExp);
      expect(EMAIL_REGEX.test('test@example.com')).toBe(true);
    });
  });

  describe('checkPasswordRequirements', () => {
    it('should return all requirements as not met for empty password', () => {
      const requirements = checkPasswordRequirements('');
      expect(requirements.every(r => !r.met)).toBe(true);
      expect(requirements.length).toBe(5);
    });

    it('should detect minimum length requirement', () => {
      const short = checkPasswordRequirements('Short1!');
      expect(short.find(r => r.id === 'length')?.met).toBe(false);

      const long = checkPasswordRequirements('LongEnough1!');
      expect(long.find(r => r.id === 'length')?.met).toBe(true);
    });

    it('should detect uppercase requirement', () => {
      const noUpper = checkPasswordRequirements('lowercase1!');
      expect(noUpper.find(r => r.id === 'uppercase')?.met).toBe(false);

      const hasUpper = checkPasswordRequirements('Uppercase1!');
      expect(hasUpper.find(r => r.id === 'uppercase')?.met).toBe(true);
    });

    it('should detect lowercase requirement', () => {
      const noLower = checkPasswordRequirements('UPPERCASE1!');
      expect(noLower.find(r => r.id === 'lowercase')?.met).toBe(false);

      const hasLower = checkPasswordRequirements('UpperLower1!');
      expect(hasLower.find(r => r.id === 'lowercase')?.met).toBe(true);
    });

    it('should detect number requirement', () => {
      const noNumber = checkPasswordRequirements('NoNumber!');
      expect(noNumber.find(r => r.id === 'number')?.met).toBe(false);

      const hasNumber = checkPasswordRequirements('HasNumber1!');
      expect(hasNumber.find(r => r.id === 'number')?.met).toBe(true);
    });

    it('should detect special character requirement', () => {
      const noSpecial = checkPasswordRequirements('NoSpecial1');
      expect(noSpecial.find(r => r.id === 'special')?.met).toBe(false);

      const hasSpecial = checkPasswordRequirements('Special1!');
      expect(hasSpecial.find(r => r.id === 'special')?.met).toBe(true);

      // Test various special characters
      expect(checkPasswordRequirements('Test1@').find(r => r.id === 'special')?.met).toBe(true);
      expect(checkPasswordRequirements('Test1$').find(r => r.id === 'special')?.met).toBe(true);
      expect(checkPasswordRequirements('Test1%').find(r => r.id === 'special')?.met).toBe(true);
      expect(checkPasswordRequirements('Test1?').find(r => r.id === 'special')?.met).toBe(true);
      expect(checkPasswordRequirements('Test1&').find(r => r.id === 'special')?.met).toBe(true);
    });
  });

  describe('calculatePasswordStrength', () => {
    it('should return very-weak for empty password', () => {
      const result = calculatePasswordStrength('');
      expect(result.score).toBe(0);
      expect(result.level).toBe('very-weak');
      expect(result.isValid).toBe(false);
    });

    it('should return very-weak for simple password', () => {
      const result = calculatePasswordStrength('abc');
      expect(result.score).toBeLessThanOrEqual(1);
      expect(result.isValid).toBe(false);
    });

    it('should return strong for password meeting all requirements', () => {
      const result = calculatePasswordStrength('StrongPass1!');
      expect(result.score).toBeGreaterThanOrEqual(3);
      expect(['strong', 'very-strong']).toContain(result.level);
      expect(result.isValid).toBe(true);
    });

    it('should return very-strong for long complex password', () => {
      const result = calculatePasswordStrength('VeryStrongPassword123!@#');
      expect(result.score).toBe(4);
      expect(result.level).toBe('very-strong');
      expect(result.isValid).toBe(true);
    });

    it('should penalize common password patterns', () => {
      const password123 = calculatePasswordStrength('Password123!');
      const qwerty = calculatePasswordStrength('Qwerty123!');
      
      // These should have lower scores due to common patterns
      expect(password123.feedback.some(f => f.includes('common'))).toBe(true);
      expect(qwerty.feedback.some(f => f.includes('common'))).toBe(true);
    });

    it('should penalize repeating characters', () => {
      const result = calculatePasswordStrength('Aaaa1111!');
      expect(result.feedback.some(f => f.includes('repeating'))).toBe(true);
    });

    it('should provide feedback for missing requirements', () => {
      const noUppercase = calculatePasswordStrength('password1!');
      expect(noUppercase.feedback.some(f => f.toLowerCase().includes('uppercase'))).toBe(true);
    });
  });

  describe('validateNewPassword', () => {
    it('should return error for empty password', () => {
      expect(validateNewPassword('')).toBe('Password is required');
    });

    it('should return error for short password', () => {
      const error = validateNewPassword('Short1!');
      expect(error).toContain('at least');
    });

    it('should return error for very long password', () => {
      const longPassword = 'A'.repeat(129) + '1!';
      const error = validateNewPassword(longPassword);
      expect(error).toContain('exceed');
    });

    it('should return null for valid password', () => {
      expect(validateNewPassword('ValidPass1!')).toBeNull();
    });

    it('should return error for password missing requirements', () => {
      // Missing uppercase
      const error1 = validateNewPassword('password1!');
      expect(error1).not.toBeNull();

      // Missing number
      const error2 = validateNewPassword('Password!');
      expect(error2).not.toBeNull();

      // Missing special char
      const error3 = validateNewPassword('Password1');
      expect(error3).not.toBeNull();
    });
  });

  describe('validatePasswordMatch', () => {
    it('should return error for empty confirmation', () => {
      expect(validatePasswordMatch('password', '')).toBe('Please confirm your password');
    });

    it('should return error for mismatched passwords', () => {
      expect(validatePasswordMatch('password1', 'password2')).toBe('Passwords do not match');
    });

    it('should return null for matching passwords', () => {
      expect(validatePasswordMatch('ValidPass1!', 'ValidPass1!')).toBeNull();
    });
  });

  describe('getStrengthColor', () => {
    it('should return correct colors for each level', () => {
      expect(getStrengthColor('very-weak')).toBe('#ef4444');
      expect(getStrengthColor('weak')).toBe('#f97316');
      expect(getStrengthColor('fair')).toBe('#eab308');
      expect(getStrengthColor('strong')).toBe('#22c55e');
      expect(getStrengthColor('very-strong')).toBe('#008e2a');
    });
  });

  describe('getStrengthWidth', () => {
    it('should return minimum 5% for score 0', () => {
      expect(getStrengthWidth(0)).toBe(5);
    });

    it('should return correct percentage for each score', () => {
      expect(getStrengthWidth(1)).toBe(25);
      expect(getStrengthWidth(2)).toBe(50);
      expect(getStrengthWidth(3)).toBe(75);
      expect(getStrengthWidth(4)).toBe(100);
    });
  });

  describe('PASSWORD_REQUIREMENTS constant', () => {
    it('should have correct default values', () => {
      expect(PASSWORD_REQUIREMENTS.minLength).toBe(8);
      expect(PASSWORD_REQUIREMENTS.maxLength).toBe(128);
      expect(PASSWORD_REQUIREMENTS.requireUppercase).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireLowercase).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireNumber).toBe(true);
      expect(PASSWORD_REQUIREMENTS.requireSpecialChar).toBe(true);
      expect(PASSWORD_REQUIREMENTS.specialChars).toBe('@$!%*?&');
    });
  });
});
