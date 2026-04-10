/**
 * Tests for input sanitization utilities
 */

import {
  sanitizeText,
  sanitizeEmail,
  sanitizeURL,
  sanitizeNumber,
  sanitizePositiveNumber,
  sanitizeMessage,
  sanitizeBountyInput,
  sanitizeProfileInput,
} from '../../../lib/utils/sanitization';

describe('sanitization utilities', () => {
  describe('sanitizeText', () => {
    it('should strip control characters', () => {
      // Control chars (ASCII 0-31, 127) should be removed; printable chars preserved
      const input = 'Hello\x00World\x1F!';
      const result = sanitizeText(input);
      expect(result).not.toContain('\x00');
      expect(result).not.toContain('\x1F');
      expect(result).toBe('HelloWorld!');
    });

    it('should preserve HTML characters as plain text (React Native renders natively)', () => {
      // React Native Text does not render HTML, so & < > should not be encoded.
      const input = 'Hello & <world>';
      const result = sanitizeText(input);
      expect(result).toBe('Hello & <world>');
      expect(result).not.toContain('&amp;');
      expect(result).not.toContain('&lt;');
    });

    it('should preserve HTML tags as plain text', () => {
      // sanitizeText is for short fields (names, tags). Tags are kept as literal text.
      // Use sanitizeRichText when you need tag stripping.
      const input = '<script>alert("xss")</script>Hello';
      const result = sanitizeText(input);
      expect(result).toBe('<script>alert("xss")</script>Hello');
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

    it('should accept negative numbers', () => {
      expect(sanitizeNumber(-10)).toBe(-10);
      expect(sanitizeNumber('-25.5')).toBe(-25.5);
    });

    it('should reject numbers with plus sign for consistency', () => {
      // Plus sign not allowed to maintain consistency
      expect(() => sanitizeNumber('+10')).toThrow('Invalid numeric format');
    });
  });

  describe('sanitizePositiveNumber', () => {
    it('should accept positive numbers', () => {
      expect(sanitizePositiveNumber(123)).toBe(123);
      expect(sanitizePositiveNumber('456.78')).toBe(456.78);
      expect(sanitizePositiveNumber(0)).toBe(0);
    });

    it('should throw error for negative numbers', () => {
      expect(() => sanitizePositiveNumber(-10)).toThrow('Number must be positive');
      expect(() => sanitizePositiveNumber('-5.5')).toThrow('Number must be positive');
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
      // HTML tags stripped (sanitizeRichText is used for both title and description)
      expect(result.title).not.toContain('<b>');
      // & is preserved as-is; no HTML encoding in React Native context
      expect(result.description).not.toContain('&amp;');
      expect(result.description).toContain('&');
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
      // Bounty amounts must be positive
      expect(() => sanitizeBountyInput(input)).toThrow('Number must be positive');
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
      // HTML tags stripped from display name (sanitizeRichText used)
      expect(result.displayName).not.toContain('<script>');
      // & is preserved as-is; React Native renders plain text, no HTML encoding
      expect(result.bio).not.toContain('&amp;');
      expect(result.bio).toContain('&');
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
    // React Native renders text natively (not as HTML), so HTML injection is not a
    // threat at the rendering layer.  sanitizeText therefore does NOT HTML-encode
    // characters; instead XSS-style payloads are stripped by sanitizeRichText,
    // which is used for user-generated content (messages, descriptions).
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '<img src=x onerror=alert("xss")>',
      '<svg/onload=alert("xss")>',
      '<iframe src="javascript:alert(\'xss\')">',
      '<body onload=alert("xss")>',
    ];

    xssPayloads.forEach(payload => {
      it(`sanitizeRichText should strip HTML tags from XSS payload: ${payload}`, () => {
        // sanitizeRichText is used for descriptions and messages
        // importing here to avoid changing the import block at top
        const { sanitizeRichText: srt } = require('../../../lib/utils/sanitization');
        const result = srt(payload);
        // HTML tags should be stripped (not encoded)
        expect(result).not.toMatch(/<script[\s>]/i);
        expect(result).not.toMatch(/<img[\s>]/i);
        expect(result).not.toMatch(/<iframe[\s>]/i);
        expect(result).not.toMatch(/<svg[\s>/]/i);
        // Should not produce HTML entities (React Native renders natively)
        expect(result).not.toContain('&lt;');
        expect(result).not.toContain('&gt;');
      });
    });

    it('should preserve javascript: text (not an RN threat)', () => {
      const payload = 'javascript:alert("xss")';
      const result = sanitizeText(payload);
      // javascript: URIs cannot execute in React Native Text components
      expect(result).toBeTruthy();
      expect(result).toContain('javascript:alert');
    });
  });
});
