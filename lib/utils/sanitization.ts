/**
 * Input Sanitization Utilities
 * 
 * Provides functions to sanitize user inputs and prevent XSS attacks.
 * All user-generated content should be sanitized before storage and display.
 */

// Minimal, dependency-free sanitization helpers to avoid bundler issues
// (replaces use of the `validator` npm package which doesn't bundle well for Expo)

function stripLow(input: string): string {
  // Remove ASCII control characters (0-31) and DEL (127)
  return input.replace(/[\x00-\x1F\x7F]/g, '');
}

function normalizeEmail(email: string): string | null {
  if (!email) return null;
  // Basic normalization: trim and lowercase. Avoid aggressive normalization.
  return email.trim().toLowerCase();
}

function isEmail(email: string): boolean {
  if (!email) return false;
  // Simple, permissive email check
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isURL(input: string, opts?: { protocols?: string[]; require_protocol?: boolean }): boolean {
  if (!input) return false;
  const trimmed = input.trim();
  try {
    const u = new URL(trimmed);
    if (opts?.protocols && opts.protocols.length > 0) {
      return opts.protocols.includes(u.protocol.replace(':', ''));
    }
    return true;
  } catch {
    // If require_protocol is false, allow schemeless URLs like example.com
    if (!opts?.require_protocol) {
      // Basic host-like pattern
      return /^[^\s\/]+\.[^\s]{2,}$/.test(trimmed);
    }
    return false;
  }
}

/**
 * Sanitize plain text input
 * Removes control characters and trims whitespace.
 * Does NOT HTML-encode entities because React Native renders text natively;
 * encoding would display literal `&lt;` instead of `<` in Text components.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (!input) return '';
  
  // Remove low/control characters
  let sanitized = stripLow(input);
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  return sanitized;
}

/**
 * Sanitize and validate email
 */
export function sanitizeEmail(email: string | null | undefined): string {
  if (!email) return '';
  const sanitized = normalizeEmail(email) || '';

  if (!isEmail(sanitized)) {
    throw new Error('Invalid email format');
  }

  return sanitized;
}

/**
 * Sanitize URL input
 */
export function sanitizeURL(url: string | null | undefined): string {
  if (!url) return '';
  
  const trimmed = url.trim();
  
  if (!isURL(trimmed, { protocols: ['http', 'https'], require_protocol: true })) {
    throw new Error('Invalid URL format');
  }

  return trimmed;
}

/**
 * Sanitize rich text (for bounty descriptions, messages with formatting).
 * Strips HTML tags so raw markup is not stored or displayed, but does NOT
 * HTML-encode surviving characters — React Native renders text natively.
 */
export function sanitizeRichText(input: string | null | undefined): string {
  if (!input) return '';
  
  // Strip HTML tags iteratively to handle nested/obfuscated patterns like
  // <<script>script>alert(1)<</script>/script> (CodeQL: js/incomplete-multi-character-sanitization).
  let current = input;
  let previous: string;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous);

  return sanitizeText(current);
}

/**
 * Sanitize numeric input (amounts, IDs, etc.)
 * Allows positive and negative numbers, including decimals
 */
export function sanitizeNumber(input: string | number | null | undefined): number {
  if (input === null || input === undefined) {
    throw new Error('Number is required');
  }
  
  // Convert to number first to handle both string and number inputs
  const num = Number(input);
  
  // Check if conversion resulted in valid number
  if (isNaN(num) || !isFinite(num)) {
    throw new Error('Invalid numeric format');
  }
  
  // Additional validation: ensure input was actually numeric-looking
  const str = String(input).trim();
  // Allow digits, decimal point, minus sign (but not plus sign for consistency)
  if (!/^-?\d+(\.\d+)?$/.test(str)) {
    throw new Error('Invalid numeric format');
  }
  
  return num;
}

/**
 * Sanitize positive numeric input (for amounts, prices)
 * Only allows positive numbers including decimals
 */
export function sanitizePositiveNumber(input: string | number | null | undefined): number {
  const num = sanitizeNumber(input);
  
  if (num < 0) {
    throw new Error('Number must be positive');
  }
  
  return num;
}

/**
 * Sanitize bounty data before saving
 */
export interface BountyInput {
  title?: string;
  description?: string;
  amount?: number | string;
  location?: string;
}

export interface SanitizedBounty {
  title: string;
  description: string;
  amount?: number;
  location?: string;
}

export function sanitizeBountyInput(input: BountyInput): SanitizedBounty {
  const sanitized: SanitizedBounty = {
    title: sanitizeRichText(input.title),
    description: sanitizeRichText(input.description),
  };
  
  if (input.amount !== undefined && input.amount !== null && input.amount !== '') {
    // Use sanitizePositiveNumber for bounty amounts (must be positive)
    sanitized.amount = sanitizePositiveNumber(input.amount);
  }
  
  if (input.location) {
    sanitized.location = sanitizeText(input.location);
  }
  
  // Validate required fields
  if (!sanitized.title || sanitized.title.length < 3) {
    throw new Error('Title must be at least 3 characters');
  }
  
  if (!sanitized.description || sanitized.description.length < 10) {
    throw new Error('Description must be at least 10 characters');
  }
  
  return sanitized;
}

/**
 * Sanitize message text before sending.
 * Strips HTML markup (tags are removed so `<b>bold</b>` becomes `bold`)
 * and validates length. Does NOT HTML-encode surviving characters because
 * React Native Text components render plain strings, not HTML.
 */
export function sanitizeMessage(text: string | null | undefined): string {
  if (!text) {
    throw new Error('Message text is required');
  }
  
  const sanitized = sanitizeRichText(text);
  
  if (!sanitized || sanitized.length === 0) {
    throw new Error('Message cannot be empty');
  }
  
  if (sanitized.length > 5000) {
    throw new Error('Message is too long (max 5000 characters)');
  }
  
  return sanitized;
}

/**
 * Sanitize profile data
 */
export interface ProfileInput {
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
}

export interface SanitizedProfile {
  displayName?: string;
  bio?: string;
  location?: string;
  website?: string;
}

export function sanitizeProfileInput(input: ProfileInput): SanitizedProfile {
  const sanitized: SanitizedProfile = {};
  
  if (input.displayName) {
    sanitized.displayName = sanitizeRichText(input.displayName);
    if (sanitized.displayName.length > 100) {
      throw new Error('Display name is too long (max 100 characters)');
    }
  }
  
  if (input.bio) {
    sanitized.bio = sanitizeRichText(input.bio);
    if (sanitized.bio.length > 500) {
      throw new Error('Bio is too long (max 500 characters)');
    }
  }
  
  if (input.location) {
    sanitized.location = sanitizeText(input.location);
  }
  
  if (input.website) {
    sanitized.website = sanitizeURL(input.website);
  }
  
  return sanitized;
}
