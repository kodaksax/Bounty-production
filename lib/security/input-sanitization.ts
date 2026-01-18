/**
 * Input Sanitization Utilities
 * Provides comprehensive input sanitization to prevent XSS, injection attacks, and other security vulnerabilities
 * 
 * Note: React Native automatically escapes JSX content, but we still sanitize data before storage
 * and when working with raw HTML or user-generated content.
 */

/**
 * Sanitize HTML content to prevent XSS attacks
 * For React Native, we focus on stripping potentially dangerous content
 * rather than rendering sanitized HTML (since we render native components)
 */
export function sanitizeHTML(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  // Strip HTML tags completely for React Native (we don't render HTML)
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '') // Remove iframe tags
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '') // Remove object tags
    .replace(/<embed\b[^<]*>/gi, '') // Remove embed tags
    .replace(/<link\b[^<]*>/gi, '') // Remove link tags
    .replace(/<img[^>]+src="[^"]*javascript:[^"]*"[^>]*>/gi, '') // Remove images with javascript: src
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '') // Remove inline event handlers
    .replace(/<[^>]+>/g, ''); // Strip remaining HTML tags
}

/**
 * Sanitize user input text (names, titles, descriptions, etc.)
 * Prevents common injection attacks and ensures data integrity
 */
export function sanitizeText(input: string, options: {
  maxLength?: number;
  allowNewlines?: boolean;
  allowSpecialChars?: boolean;
} = {}): string {
  if (!input || typeof input !== 'string') return '';
  
  const {
    maxLength = 10000,
    allowNewlines = true,
    allowSpecialChars = true
  } = options;
  
  let sanitized = input;
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Remove control characters except newlines and tabs (if allowed)
  if (allowNewlines) {
    sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  } else {
    sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  }
  
  // Remove zero-width characters that might be used for obfuscation
  sanitized = sanitized.replace(/[\u200B-\u200D\uFEFF]/g, '');
  
  // If special chars not allowed, keep only alphanumeric, spaces, and basic punctuation
  if (!allowSpecialChars) {
    sanitized = sanitized.replace(/[^a-zA-Z0-9\s\.\,\!\?\-\_]/g, '');
  }
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Enforce max length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Sanitize email addresses
 */
export function sanitizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  
  // Convert to lowercase and trim
  let sanitized = email.toLowerCase().trim();
  
  // Remove any characters that aren't valid in email addresses
  sanitized = sanitized.replace(/[^a-z0-9@.\-_+]/g, '');
  
  // Ensure only one @ symbol
  const atCount = (sanitized.match(/@/g) || []).length;
  if (atCount !== 1) return '';
  
  return sanitized;
}

/**
 * Sanitize URLs to prevent javascript: and data: URL attacks
 */
export function sanitizeURL(url: string): string {
  if (!url || typeof url !== 'string') return '';
  
  const trimmed = url.trim();
  
  // Block dangerous protocols
  const dangerousProtocols = ['javascript:', 'data:', 'vbscript:', 'file:'];
  const lowerURL = trimmed.toLowerCase();
  
  for (const protocol of dangerousProtocols) {
    if (lowerURL.startsWith(protocol)) {
      return '';
    }
  }
  
  // Only allow http, https, and mailto
  if (!lowerURL.startsWith('http://') && 
      !lowerURL.startsWith('https://') && 
      !lowerURL.startsWith('mailto:')) {
    // If no protocol specified, assume https
    return `https://${trimmed}`;
  }
  
  return trimmed;
}

/**
 * Sanitize file names to prevent path traversal
 */
export function sanitizeFileName(fileName: string): string {
  if (!fileName || typeof fileName !== 'string') return '';
  
  // Remove path traversal attempts
  let sanitized = fileName.replace(/\.\.[\\/]/g, '');
  
  // Remove directory separators
  sanitized = sanitized.replace(/[\/\\]/g, '_');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Keep only safe characters
  sanitized = sanitized.replace(/[^a-zA-Z0-9._\-]/g, '_');
  
  // Ensure filename doesn't start with a dot (hidden files)
  if (sanitized.startsWith('.')) {
    sanitized = '_' + sanitized;
  }
  
  return sanitized;
}

/**
 * Sanitize JSON strings to prevent injection
 */
export function sanitizeJSON(input: string): string {
  if (!input || typeof input !== 'string') return '';
  
  try {
    // Parse and re-stringify to ensure valid JSON
    const parsed = JSON.parse(input);
    return JSON.stringify(parsed);
  } catch (_error) {
    return '';
  }
}

/**
 * Sanitize search queries
 * 
 * Note: When using parameterized queries or ORMs (like Drizzle), SQL injection
 * is prevented at the database layer. This function primarily limits length
 * and removes control characters for consistency.
 * 
 * Avoid keyword filtering as it can break legitimate searches (e.g., "select a table")
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') return '';
  
  let sanitized = query.trim();
  
  // Remove control characters (but keep normal punctuation)
  sanitized = sanitized.replace(/[\x00-\x1F\x7F]/g, '');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');
  
  // Limit length
  return sanitized.substring(0, 500);
}

/**
 * Sanitize numeric inputs
 */
export function sanitizeNumber(input: string | number, options: {
  min?: number;
  max?: number;
  allowDecimals?: boolean;
} = {}): number | null {
  const {
    min = -Infinity,
    max = Infinity,
    allowDecimals = true
  } = options;
  
  // Convert to number
  const num = typeof input === 'number' ? input : parseFloat(input);
  
  // Check if valid number
  if (isNaN(num) || !isFinite(num)) {
    return null;
  }
  
  // Round if decimals not allowed
  const finalNum = allowDecimals ? num : Math.round(num);
  
  // Enforce min/max bounds
  if (finalNum < min || finalNum > max) {
    return null;
  }
  
  return finalNum;
}

/**
 * Sanitize phone numbers
 */
export function sanitizePhoneNumber(phone: string): string {
  if (!phone || typeof phone !== 'string') return '';
  
  // Keep only digits, plus, and hyphens
  return phone.replace(/[^0-9+\-\s()]/g, '').trim();
}

/**
 * Sanitize object by applying appropriate sanitization to each field
 */
export function sanitizeObject<T extends Record<string, any>>(
  obj: T,
  schema: Record<keyof T, 'text' | 'email' | 'url' | 'html' | 'number' | 'phone' | 'fileName'>
): T {
  const sanitized = {} as T;
  
  for (const [key, value] of Object.entries(obj)) {
    const sanitizeType = schema[key as keyof T];
    
    if (value === null || value === undefined) {
      sanitized[key as keyof T] = value;
      continue;
    }
    
    switch (sanitizeType) {
      case 'text':
        sanitized[key as keyof T] = sanitizeText(String(value)) as any;
        break;
      case 'email':
        sanitized[key as keyof T] = sanitizeEmail(String(value)) as any;
        break;
      case 'url':
        sanitized[key as keyof T] = sanitizeURL(String(value)) as any;
        break;
      case 'html':
        sanitized[key as keyof T] = sanitizeHTML(String(value)) as any;
        break;
      case 'number':
        sanitized[key as keyof T] = sanitizeNumber(value) as any;
        break;
      case 'phone':
        sanitized[key as keyof T] = sanitizePhoneNumber(String(value)) as any;
        break;
      case 'fileName':
        sanitized[key as keyof T] = sanitizeFileName(String(value)) as any;
        break;
      default:
        sanitized[key as keyof T] = value;
    }
  }
  
  return sanitized;
}

/**
 * Validate and sanitize bounty data
 */
export function sanitizeBountyData(data: {
  title?: string;
  description?: string;
  amount?: number | string;
  location?: string;
}) {
  return {
    title: data.title ? sanitizeText(data.title, { maxLength: 200, allowNewlines: false }) : '',
    description: data.description ? sanitizeText(data.description, { maxLength: 5000, allowNewlines: true }) : '',
    amount: data.amount ? sanitizeNumber(data.amount, { min: 0, max: 1000000, allowDecimals: true }) : null,
    location: data.location ? sanitizeText(data.location, { maxLength: 500, allowNewlines: false }) : '',
  };
}

/**
 * Validate and sanitize message data
 */
export function sanitizeMessageData(data: {
  text?: string;
  conversationId?: string;
}) {
  return {
    text: data.text ? sanitizeText(data.text, { maxLength: 10000, allowNewlines: true }) : '',
    conversationId: data.conversationId ? sanitizeText(data.conversationId, { maxLength: 100, allowNewlines: false, allowSpecialChars: false }) : '',
  };
}

/**
 * Validate and sanitize user profile data
 */
export function sanitizeUserProfileData(data: {
  username?: string;
  displayName?: string;
  bio?: string;
  website?: string;
  location?: string;
}) {
  return {
    username: data.username ? sanitizeText(data.username, { maxLength: 50, allowNewlines: false, allowSpecialChars: false }) : '',
    displayName: data.displayName ? sanitizeText(data.displayName, { maxLength: 100, allowNewlines: false }) : '',
    bio: data.bio ? sanitizeText(data.bio, { maxLength: 500, allowNewlines: true }) : '',
    website: data.website ? sanitizeURL(data.website) : '',
    location: data.location ? sanitizeText(data.location, { maxLength: 100, allowNewlines: false }) : '',
  };
}
