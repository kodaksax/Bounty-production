/**
 * Tests for input sanitization utilities
 */

import {
  sanitizeText,
  sanitizeHTML,
  sanitizeEmail,
  sanitizeURL,
  sanitizeNumber,
} from '../input-sanitization';

describe('Input Sanitization', () => {
  describe('sanitizeText', () => {
    it('should remove null bytes', () => {
      const input = 'Hello\x00World';
      const result = sanitizeText(input);
      expect(result).toBe('HelloWorld');
    });

    it('should trim whitespace', () => {
      const input = '  Hello World  ';
      const result = sanitizeText(input);
      expect(result).toBe('Hello World');
    });
  });

  describe('sanitizeHTML', () => {
    it('should remove script tags', () => {
      const input = 'Hello<script>alert("xss")</script>World';
      const result = sanitizeHTML(input);
      expect(result).toBe('HelloWorld');
    });
  });

  describe('sanitizeEmail', () => {
    it('should convert to lowercase', () => {
      const input = 'Test@Example.COM';
      const result = sanitizeEmail(input);
      expect(result).toBe('test@example.com');
    });
  });
});
