import Constants from 'expo-constants';
import { sanitizeAddressText, sanitizePlaceId, sanitizeSearchQuery } from '../utils/address-sanitization';

/**
 * Address suggestion from autocomplete service
 */
export interface AddressSuggestion {
  id: string;
  description: string;
  placeId: string;
  mainText: string;
  secondaryText?: string;
}

/**
 * Detailed place information
 */
export interface PlaceDetails {
  placeId: string;
  formattedAddress: string;
  latitude?: number;
  longitude?: number;
  components?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
}

/**
 * Error response for place details
 */
export interface PlaceDetailsError {
  error: string;
  details: null;
}

/**
 * Type guard to check if a place details response is an error
 */
export function isPlaceDetailsError(
  response: PlaceDetails | PlaceDetailsError
): response is PlaceDetailsError {
  return (
    typeof (response as any).error === 'string' &&
    (response as any).details === null &&
    !('placeId' in response) &&
    !('formattedAddress' in response)
  );
}

/**
 * Address Autocomplete Service
 * Provides real-time address suggestions using Google Places API
 * 
 * Configuration:
 * - Set EXPO_PUBLIC_GOOGLE_PLACES_API_KEY in .env or app.json
 * - API key should have Places API enabled
 * - Consider restricting key to specific platforms for security
 */
class AddressAutocompleteService {
  private apiKey: string | null = null;
  private cache: Map<string, AddressSuggestion[]> = new Map();
  private cacheTimeout = 5 * 60 * 1000; // 5 minutes
  private cacheTimeoutIds: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private lastRequestTime = 0;
  private minRequestInterval = 300; // Rate limiting: 300ms between requests
  
  constructor() {
    // Try to get API key from environment
    this.apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey || 
                  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || 
                  null;
    
    if (!this.apiKey) {
      console.error('Google Places API key not configured. Address autocomplete will be disabled.');
    }
  }

  /**
   * Check if the service is properly configured
   */
  isConfigured(): boolean {
    return !!this.apiKey;
  }

  /**
   * Search for address suggestions based on user input
   * @param query User's search input
   * @param options Additional search options
   * @returns Array of address suggestions
   */
  async searchAddresses(
    query: string,
    options?: {
      latitude?: number;
      longitude?: number;
      radius?: number; // in meters
      types?: string[]; // e.g., ['address', 'establishment']
      components?: string; // e.g., 'country:us'
    }
  ): Promise<AddressSuggestion[]> {
    if (!this.isConfigured()) {
      console.error('Address autocomplete not configured');
      return [];
    }

    if (!query || query.trim().length < 2) {
      return [];
    }

    // Sanitize the query input
    const sanitizedQuery = sanitizeSearchQuery(query);
    if (!sanitizedQuery) {
      console.error('Invalid search query');
      return [];
    }

    // Check cache first
    const cacheKey = this.getCacheKey(sanitizedQuery, options);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Rate limiting
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.minRequestInterval) {
      await this.delay(this.minRequestInterval - timeSinceLastRequest);
    }

    try {
      this.lastRequestTime = Date.now();
      
      // Build request URL
      const params = new URLSearchParams({
        input: sanitizedQuery,
        key: this.apiKey!,
      });

      // Add optional parameters
      if (options?.latitude && options?.longitude) {
        params.append('location', `${options.latitude},${options.longitude}`);
        if (options.radius) {
          params.append('radius', options.radius.toString());
        }
      }

      if (options?.types && options.types.length > 0) {
        params.append('types', options.types.join('|'));
      }

      if (options?.components) {
        params.append('components', options.components);
      }

      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.predictions) {
        const suggestions: AddressSuggestion[] = data.predictions.map((prediction: any) => ({
          id: prediction.place_id,
          description: sanitizeAddressText(prediction.description),
          placeId: prediction.place_id,
          mainText: sanitizeAddressText(prediction.structured_formatting?.main_text || prediction.description),
          secondaryText: prediction.structured_formatting?.secondary_text 
            ? sanitizeAddressText(prediction.structured_formatting.secondary_text)
            : undefined,
        }));

        // Cache results
        this.cache.set(cacheKey, suggestions);
        this.scheduleCacheCleanup(cacheKey);

        return suggestions;
      } else if (data.status === 'ZERO_RESULTS') {
        return [];
      } else {
        // Log error status for debugging but don't expose API error message to prevent information leakage
        console.error('Places API error:', data.status);
        if (__DEV__) {
          console.error('Places API error details (dev only):', data.error_message);
        }
        throw new Error('Unable to fetch address suggestions. Please try again later.');
      }
    } catch (error) {
      console.error('Error fetching address suggestions:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific place
   * @param placeId The place ID from a suggestion
   * @returns Detailed place information or error response
   */
  async getPlaceDetails(placeId: string): Promise<PlaceDetails | PlaceDetailsError> {
    if (!this.isConfigured()) {
      console.error('Address autocomplete not configured');
      return { error: 'Service not configured', details: null };
    }

    // Validate and sanitize place ID
    const sanitizedPlaceId = sanitizePlaceId(placeId);
    if (!sanitizedPlaceId) {
      console.error('Invalid place ID provided');
      return { error: 'Invalid place ID provided', details: null };
    }

    try {
      const params = new URLSearchParams({
        place_id: sanitizedPlaceId,
        key: this.apiKey!,
        fields: 'formatted_address,geometry,address_components',
      });

      const url = `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`;
      
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.result) {
        const result = data.result;
        
        // Parse address components
        const components: PlaceDetails['components'] = {};
        const streetParts: string[] = [];
        
        if (result.address_components) {
          for (const component of result.address_components) {
            const types = component.types;
            if (types.includes('street_number') || types.includes('route')) {
              streetParts.push(sanitizeAddressText(component.long_name));
            } else if (types.includes('locality')) {
              components.city = sanitizeAddressText(component.long_name);
            } else if (types.includes('administrative_area_level_1')) {
              components.state = sanitizeAddressText(component.short_name);
            } else if (types.includes('country')) {
              components.country = sanitizeAddressText(component.long_name);
            } else if (types.includes('postal_code')) {
              components.postalCode = sanitizeAddressText(component.long_name);
            }
          }
          
          // Combine street parts with proper spacing
          if (streetParts.length > 0) {
            components.street = streetParts.join(' ').trim();
          }
        }

        return {
          placeId: sanitizedPlaceId,
          formattedAddress: sanitizeAddressText(result.formatted_address),
          latitude: result.geometry?.location?.lat,
          longitude: result.geometry?.location?.lng,
          components,
        };
      } else if (data.status === 'NOT_FOUND') {
        // Handle NOT_FOUND status specifically
        console.error('Place not found:', sanitizedPlaceId);
        return { error: 'Place not found', details: null };
      } else {
        // Log error status for debugging but don't expose API error message
        console.error('Place details API error:', data.status);
        if (__DEV__) {
          console.error('Place details API error details (dev only):', data.error_message);
        }
        return { error: 'Unable to fetch place details', details: null };
      }
    } catch (error: any) {
      console.error('Error fetching place details:', error);
      return { error: 'Network error occurred', details: null };
    }
  }

  /**
   * Validate if an address is complete and valid
   * @param address The address string to validate
   * @returns true if valid, false otherwise
   */
  async validateAddress(address: string): Promise<boolean> {
    if (!address || address.trim().length < 3) {
      return false;
    }

    try {
      const suggestions = await this.searchAddresses(address);
      return suggestions.length > 0;
    } catch (error) {
      console.error('Error validating address:', error);
      return false;
    }
  }

  /**
   * Clear the suggestion cache and cancel all pending timeouts
   */
  clearCache(): void {
    // Clear all pending timeout callbacks
    for (const timeoutId of this.cacheTimeoutIds.values()) {
      clearTimeout(timeoutId as any);
    }
    this.cacheTimeoutIds.clear();
    this.cache.clear();
  }

  /**
   * Generate cache key from query and options
   */
  private getCacheKey(query: string, options?: any): string {
    return JSON.stringify({ query: query.toLowerCase().trim(), options });
  }

  /**
   * Schedule cache cleanup for a specific key
   */
  private scheduleCacheCleanup(key: string): void {
    // Cancel any existing timeout for this key
    const existingTimeout = this.cacheTimeoutIds.get(key);
    if (existingTimeout) {
      clearTimeout(existingTimeout as any);
    }
    
    // Set new timeout and store its ID
    const timeoutId = setTimeout(() => {
      this.cache.delete(key);
      this.cacheTimeoutIds.delete(key);
    }, this.cacheTimeout);
    
    this.cacheTimeoutIds.set(key, timeoutId as any);
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const addressAutocompleteService = new AddressAutocompleteService();
