import { getAvatarInitials, getValidAvatarUrl } from '../../../lib/utils/avatar-utils';

describe('getValidAvatarUrl', () => {
  describe('valid URLs', () => {
    it('should return valid https URLs unchanged', () => {
      const url = 'https://example.com/avatar.jpg';
      expect(getValidAvatarUrl(url)).toBe(url);
    });

    it('should return valid http URLs unchanged', () => {
      const url = 'http://example.com/avatar.png';
      expect(getValidAvatarUrl(url)).toBe(url);
    });

    it('should allow URLs with "placeholder" in valid path segments', () => {
      const url = 'https://example.com/user/placeholder-image/photo.jpg';
      expect(getValidAvatarUrl(url)).toBe(url);
    });

    it('should allow CDN URLs with query parameters', () => {
      const url = 'https://cdn.example.com/avatars/user123.jpg?size=100';
      expect(getValidAvatarUrl(url)).toBe(url);
    });
  });

  describe('invalid URLs', () => {
    it('should return undefined for placeholder.svg URLs', () => {
      expect(getValidAvatarUrl('/placeholder.svg')).toBeUndefined();
      expect(getValidAvatarUrl('/placeholder.svg?height=48&width=48')).toBeUndefined();
    });

    it('should return undefined for relative URLs starting with /', () => {
      expect(getValidAvatarUrl('/images/avatar.jpg')).toBeUndefined();
      expect(getValidAvatarUrl('/user/photo.png')).toBeUndefined();
    });

    it('should return undefined for non-http(s) schemes', () => {
      expect(getValidAvatarUrl('file:///path/to/avatar.jpg')).toBeUndefined();
      expect(getValidAvatarUrl('data:image/png;base64,abc123')).toBeUndefined();
      expect(getValidAvatarUrl('ftp://example.com/avatar.jpg')).toBeUndefined();
    });

    it('should return undefined for null input', () => {
      expect(getValidAvatarUrl(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(getValidAvatarUrl(undefined)).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(getValidAvatarUrl('')).toBeUndefined();
    });

    it('should return undefined for URLs with placeholder.svg in path', () => {
      expect(getValidAvatarUrl('https://example.com/placeholder.svg')).toBeUndefined();
    });
  });
});

describe('getAvatarInitials', () => {
  describe('normal inputs', () => {
    it('should return first 2 characters uppercase for normal username', () => {
      expect(getAvatarInitials('john')).toBe('JO');
    });

    it('should return first 2 characters uppercase for username with spaces', () => {
      expect(getAvatarInitials('John Doe')).toBe('JO');
    });

    it('should handle mixed case', () => {
      expect(getAvatarInitials('jOhN')).toBe('JO');
    });

    it('should handle username with numbers', () => {
      expect(getAvatarInitials('user123')).toBe('US');
    });
  });

  describe('edge cases', () => {
    it('should return default "U" for null input', () => {
      expect(getAvatarInitials(null)).toBe('U');
    });

    it('should return default "U" for undefined input', () => {
      expect(getAvatarInitials(undefined)).toBe('U');
    });

    it('should return default "U" for empty string', () => {
      expect(getAvatarInitials('')).toBe('U');
    });

    it('should return single character uppercase for 1-char username', () => {
      expect(getAvatarInitials('A')).toBe('A');
    });

    it('should handle special characters', () => {
      expect(getAvatarInitials('@user')).toBe('@U');
    });

    it('should handle unicode characters', () => {
      expect(getAvatarInitials('日本語')).toBe('日本');
    });
  });

  describe('custom maxLength', () => {
    it('should respect custom maxLength of 1', () => {
      expect(getAvatarInitials('john', 1)).toBe('J');
    });

    it('should respect custom maxLength of 3', () => {
      expect(getAvatarInitials('john', 3)).toBe('JOH');
    });

    it('should handle maxLength greater than username length', () => {
      expect(getAvatarInitials('ab', 5)).toBe('AB');
    });
  });
});
