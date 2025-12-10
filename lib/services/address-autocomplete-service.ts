import Constants from 'expo-constants';

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
  private lastRequestTime = 0;
  private minRequestInterval = 300; // Rate limiting: 300ms between requests
  
  constructor() {
    // Try to get API key from environment
    this.apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey || 
                  process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || 
                  null;
    
    if (!this.apiKey) {
      console.warn('Google Places API key not configured. Address autocomplete will be disabled.');
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
      console.warn('Address autocomplete not configured');
      return [];
    }

    if (!query || query.trim().length < 2) {
      return [];
    }

    // Check cache first
    const cacheKey = this.getCacheKey(query, options);
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
        input: query.trim(),
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
          description: prediction.description,
          placeId: prediction.place_id,
          mainText: prediction.structured_formatting?.main_text || prediction.description,
          secondaryText: prediction.structured_formatting?.secondary_text,
        }));

        // Cache results
        this.cache.set(cacheKey, suggestions);
        this.scheduleCacheCleanup(cacheKey);

        return suggestions;
      } else if (data.status === 'ZERO_RESULTS') {
        return [];
      } else {
        console.error('Places API error:', data.status, data.error_message);
        throw new Error(data.error_message || `API error: ${data.status}`);
      }
    } catch (error) {
      console.error('Error fetching address suggestions:', error);
      throw error;
    }
  }

  /**
   * Get detailed information about a specific place
   * @param placeId The place ID from a suggestion
   * @returns Detailed place information
   */
  async getPlaceDetails(placeId: string): Promise<PlaceDetails | null> {
    if (!this.isConfigured()) {
      console.warn('Address autocomplete not configured');
      return null;
    }

    try {
      const params = new URLSearchParams({
        place_id: placeId,
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
              streetParts.push(component.long_name);
            } else if (types.includes('locality')) {
              components.city = component.long_name;
            } else if (types.includes('administrative_area_level_1')) {
              components.state = component.short_name;
            } else if (types.includes('country')) {
              components.country = component.long_name;
            } else if (types.includes('postal_code')) {
              components.postalCode = component.long_name;
            }
          }
          
          // Combine street parts with proper spacing
          if (streetParts.length > 0) {
            components.street = streetParts.join(' ').trim();
          }
        }

        return {
          placeId,
          formattedAddress: result.formatted_address,
          latitude: result.geometry?.location?.lat,
          longitude: result.geometry?.location?.lng,
          components,
        };
      } else {
        console.error('Place details API error:', data.status, data.error_message);
        return null;
      }
    } catch (error) {
      console.error('Error fetching place details:', error);
      return null;
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
   * Clear the suggestion cache
   */
  clearCache(): void {
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
    setTimeout(() => {
      this.cache.delete(key);
    }, this.cacheTimeout);
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const addressAutocompleteService = new AddressAutocompleteService();
