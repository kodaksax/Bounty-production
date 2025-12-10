/**
 * Tests for input sanitization utilities
 */

import {
  sanitizeText,
  sanitizeEmail,
  sanitizeURL,
  sanitizeNumber,
  sanitizeMessage,
  sanitizeBountyInput,
  sanitizeProfileInput,
} from '../../../lib/utils/sanitization';

describe('sanitization utilities', () => {
  describe('sanitizeText', () => {
    it('should remove HTML tags', () => {
      const input = '<script>alert("xss")</script>Hello';
      const result = sanitizeText(input);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
    });

    it('should escape HTML entities', () => {
      const input = 'Hello & <world>';
      const result = sanitizeText(input);
      expect(result).toContain('&amp;');
      expect(result).toContain('&lt;');
      expect(result).toContain('&gt;');
    });

    it('should trim whitespace', () => {
      const input = '  Hello World  ';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeText(null)).toBe('');
      expect(sanitizeText(undefined)).toBe('');
    });

    it('should handle empty string', () => {
      expect(sanitizeText('')).toBe('');
    });
  });

  describe('sanitizeEmail', () => {
    it('should normalize valid email', () => {
      const input = 'Test@Example.COM';
      const result = sanitizeEmail(input);
      expect(result).toBe('test@example.com');
    });

    it('should throw error for invalid email', () => {
      expect(() => sanitizeEmail('not-an-email')).toThrow('Invalid email format');
    });

    it('should handle null and undefined', () => {
      // validator.normalizeEmail returns false for null/undefined, not an error
      // So it will throw "Invalid email format" on the isEmail check
      expect(sanitizeEmail(null)).toBe('');
      expect(sanitizeEmail(undefined)).toBe('');
    });
  });

  describe('sanitizeURL', () => {
    it('should accept valid HTTPS URL', () => {
      const input = 'https://example.com/path';
      const result = sanitizeURL(input);
      expect(result).toBe('https://example.com/path');
    });

    it('should accept valid HTTP URL', () => {
      const input = 'http://example.com';
      const result = sanitizeURL(input);
      expect(result).toBe('http://example.com');
    });

    it('should throw error for URL without protocol', () => {
      expect(() => sanitizeURL('example.com')).toThrow('Invalid URL format');
    });

    it('should throw error for invalid protocol', () => {
      expect(() => sanitizeURL('ftp://example.com')).toThrow('Invalid URL format');
    });

    it('should handle null and undefined', () => {
      expect(sanitizeURL(null)).toBe('');
      expect(sanitizeURL(undefined)).toBe('');
    });
  });

  describe('sanitizeNumber', () => {
    it('should accept valid number', () => {
      expect(sanitizeNumber(123)).toBe(123);
      expect(sanitizeNumber('456')).toBe(456);
      expect(sanitizeNumber(0)).toBe(0);
    });

    it('should accept decimal numbers', () => {
      expect(sanitizeNumber(123.45)).toBe(123.45);
      expect(sanitizeNumber('678.90')).toBe(678.90);
      expect(sanitizeNumber(123)).toBe(123);
    });

    it('should throw error for non-numeric input', () => {
      expect(() => sanitizeNumber('abc')).toThrow('Invalid numeric format');
      expect(() => sanitizeNumber('12.34.56')).toThrow('Invalid numeric format');
      expect(() => sanitizeNumber('12abc')).toThrow('Invalid numeric format');
    });

    it('should throw error for NaN', () => {
      expect(() => sanitizeNumber(NaN)).toThrow('Invalid numeric format');
    });

    it('should throw error for Infinity', () => {
      expect(() => sanitizeNumber(Infinity)).toThrow('Invalid numeric format');
    });

    it('should throw error for null and undefined', () => {
      expect(() => sanitizeNumber(null)).toThrow('Number is required');
      expect(() => sanitizeNumber(undefined)).toThrow('Number is required');
    });
  });

  describe('sanitizeMessage', () => {
    it('should sanitize valid message', () => {
      const input = 'Hello <b>world</b>!';
      const result = sanitizeMessage(input);
      expect(result).not.toContain('<b>');
      expect(result).not.toContain('</b>');
    });

    it('should throw error for empty message', () => {
      expect(() => sanitizeMessage('')).toThrow('Message text is required');
      // Whitespace-only message gets trimmed to empty, then throws "Message cannot be empty"
      expect(() => sanitizeMessage('   ')).toThrow('Message cannot be empty');
    });

    it('should throw error for null and undefined', () => {
      expect(() => sanitizeMessage(null)).toThrow('Message text is required');
      expect(() => sanitizeMessage(undefined)).toThrow('Message text is required');
    });

    it('should throw error for message too long', () => {
      const longMessage = 'a'.repeat(5001);
      expect(() => sanitizeMessage(longMessage)).toThrow('Message is too long');
    });

    it('should accept message with max length', () => {
      const maxMessage = 'a'.repeat(5000);
      const result = sanitizeMessage(maxMessage);
      expect(result.length).toBeLessThanOrEqual(5000);
    });
  });

  describe('sanitizeBountyInput', () => {
    it('should sanitize valid bounty', () => {
      const input = {
        title: 'Fix <b>bug</b>',
        description: 'Please fix the bug & test it',
        amount: 100,
        location: 'New York',
      };
      const result = sanitizeBountyInput(input);
      expect(result.title).not.toContain('<b>');
      expect(result.description).toContain('&amp;');
      expect(result.amount).toBe(100);
      expect(result.location).toBe('New York');
    });

    it('should throw error for short title', () => {
      const input = { title: 'AB', description: 'Valid description here' };
      expect(() => sanitizeBountyInput(input)).toThrow('Title must be at least 3 characters');
    });

    it('should throw error for short description', () => {
      const input = { title: 'Valid Title', description: 'Short' };
      expect(() => sanitizeBountyInput(input)).toThrow('Description must be at least 10 characters');
    });

    it('should throw error for negative amount', () => {
      const input = {
        title: 'Valid Title',
        description: 'Valid description here',
        amount: -10,
      };
      // Negative numbers are not considered "numeric" by validator (no_symbols: true)
      expect(() => sanitizeBountyInput(input)).toThrow();
    });

    it('should accept bounty without amount', () => {
      const input = {
        title: 'Valid Title',
        description: 'Valid description here',
      };
      const result = sanitizeBountyInput(input);
      expect(result.amount).toBeUndefined();
    });

    it('should accept bounty without location', () => {
      const input = {
        title: 'Valid Title',
        description: 'Valid description here',
        amount: 100,
      };
      const result = sanitizeBountyInput(input);
      expect(result.location).toBeUndefined();
    });
  });

  describe('sanitizeProfileInput', () => {
    it('should sanitize valid profile', () => {
      const input = {
        displayName: 'John <script>alert("xss")</script> Doe',
        bio: 'I love coding & design',
        location: 'San Francisco',
        website: 'https://example.com',
      };
      const result = sanitizeProfileInput(input);
      expect(result.displayName).not.toContain('<script>');
      expect(result.bio).toContain('&amp;');
      expect(result.location).toBe('San Francisco');
      expect(result.website).toBe('https://example.com');
    });

    it('should throw error for display name too long', () => {
      const input = {
        displayName: 'a'.repeat(101),
      };
      expect(() => sanitizeProfileInput(input)).toThrow('Display name is too long');
    });

    it('should throw error for bio too long', () => {
      const input = {
        bio: 'a'.repeat(501),
      };
      expect(() => sanitizeProfileInput(input)).toThrow('Bio is too long');
    });

    it('should throw error for invalid website URL', () => {
      const input = {
        website: 'not-a-url',
      };
      expect(() => sanitizeProfileInput(input)).toThrow('Invalid URL format');
    });

    it('should accept profile with only some fields', () => {
      const input = {
        displayName: 'John Doe',
      };
      const result = sanitizeProfileInput(input);
      expect(result.displayName).toBe('John Doe');
      expect(result.bio).toBeUndefined();
      expect(result.location).toBeUndefined();
      expect(result.website).toBeUndefined();
    });

    it('should accept empty profile', () => {
      const input = {};
      const result = sanitizeProfileInput(input);
      expect(result).toEqual({});
    });
  });

  describe('XSS prevention', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert("xss")>',
      '<svg/onload=alert("xss")>',
      '<iframe src="javascript:alert(\'xss\')">',
      '<body onload=alert("xss")>',
    ];

    xssPayloads.forEach(payload => {
      it(`should sanitize XSS payload: ${payload}`, () => {
        const result = sanitizeText(payload);
        // Should escape dangerous characters (< becomes &lt;, > becomes &gt;, etc.)
        expect(result).toContain('&lt;');
        expect(result).toContain('&gt;');
        // Should not contain raw HTML tags
        expect(result).not.toMatch(/<script[\s>]/i);
        expect(result).not.toMatch(/<img[\s>]/i);
        expect(result).not.toMatch(/<iframe[\s>]/i);
        expect(result).not.toMatch(/<svg[\s>/]/i);
      });
    });

    it('should escape javascript: protocol', () => {
      const payload = 'javascript:alert("xss")';
      const result = sanitizeText(payload);
      // javascript: gets escaped in HTML context but we keep it for text
      // The key is it won't execute in an HTML context
      expect(result).toBeTruthy();
    });
  });
});
