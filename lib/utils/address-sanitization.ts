/**
 * Address sanitization utilities
 * Sanitizes address data from external APIs to prevent XSS and injection attacks
 */

/**
 * Sanitize address text by removing potentially dangerous characters
 * while preserving valid address characters
 */
export function sanitizeAddressText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // Remove any HTML tags
  let sanitized = text.replace(/<[^>]*>/g, '');
  
  // Remove script tags and their content
  sanitized = sanitized.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  
  // Remove potential XSS patterns
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length to prevent abuse
  const MAX_ADDRESS_LENGTH = 500;
  if (sanitized.length > MAX_ADDRESS_LENGTH) {
    sanitized = sanitized.substring(0, MAX_ADDRESS_LENGTH);
  }
  
  return sanitized;
}

/**
 * Validate and sanitize place ID from Google Places API
 * Place IDs should be alphanumeric with hyphens and underscores
 */
export function sanitizePlaceId(placeId: string): string {
  if (!placeId || typeof placeId !== 'string') {
    return '';
  }
  
  // Place IDs from Google are typically alphanumeric with hyphens and underscores
  const VALID_PLACE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
  
  if (!VALID_PLACE_ID_PATTERN.test(placeId)) {
    console.error('Invalid place ID format detected:', placeId.substring(0, 20));
    return '';
  }
  
  return placeId;
}

/**
 * Sanitize query input for API requests
 */
export function sanitizeSearchQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    return '';
  }
  
  // Remove potentially dangerous patterns
  let sanitized = query.replace(/<[^>]*>/g, '');
  sanitized = sanitized.replace(/[<>{}]/g, '');
  
  // Trim and limit length
  sanitized = sanitized.trim();
  const MAX_QUERY_LENGTH = 200;
  if (sanitized.length > MAX_QUERY_LENGTH) {
    sanitized = sanitized.substring(0, MAX_QUERY_LENGTH);
  }
  
  return sanitized;
}

/**
 * Address suggestion structure (matches AddressSuggestion from service)
 */
export interface AddressSuggestionInput {
  id: string;
  description: string;
  placeId: string;
  mainText: string;
  secondaryText?: string;
}

/**
 * Sanitize address suggestion from API response
 */
export function sanitizeAddressSuggestion(suggestion: AddressSuggestionInput): AddressSuggestionInput | null {
  if (!suggestion || typeof suggestion !== 'object') {
    return null;
  }
  
  return {
    ...suggestion,
    description: sanitizeAddressText(suggestion.description || ''),
    mainText: sanitizeAddressText(suggestion.mainText || ''),
    secondaryText: suggestion.secondaryText ? sanitizeAddressText(suggestion.secondaryText) : undefined,
  };
}
