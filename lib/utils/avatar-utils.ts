/**
 * Avatar Utilities
 * 
 * Shared utility functions for handling avatar URLs in React Native.
 */

/**
 * Validates if the provided URL is a valid image URL for React Native.
 * Returns the URL if valid, or undefined if invalid (e.g., placeholder or malformed).
 * 
 * @param url - The avatar URL to validate
 * @returns The validated URL or undefined if invalid
 */
export function getValidAvatarUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  
  // Filter out web placeholder URLs that don't work in React Native
  if (url.includes('/placeholder') || url.startsWith('/')) {
    return undefined;
  }
  
  // Ensure the URL starts with http:// or https://
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return undefined;
  }
  
  return url;
}

/**
 * Generates initials from a username for avatar fallback.
 * 
 * @param username - The username to generate initials from
 * @param maxLength - Maximum number of characters for initials (default: 2)
 * @returns The uppercase initials
 */
export function getAvatarInitials(username: string | undefined | null, maxLength: number = 2): string {
  if (!username) return 'U';
  return username.substring(0, maxLength).toUpperCase();
}
