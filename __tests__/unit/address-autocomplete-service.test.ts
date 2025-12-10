/**
 * Unit tests for Address Autocomplete Service
 */

import { addressAutocompleteService } from '../../lib/services/address-autocomplete-service';

// Mock fetch
global.fetch = jest.fn();

describe('AddressAutocompleteService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addressAutocompleteService.clearCache();
  });

  describe('Configuration', () => {
    it('should report configuration status', () => {
      const isConfigured = addressAutocompleteService.isConfigured();
      expect(typeof isConfigured).toBe('boolean');
    });
  });

  describe('searchAddresses', () => {
    it('should return empty array for queries less than 2 characters', async () => {
      const results = await addressAutocompleteService.searchAddresses('a');
      expect(results).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should return empty array for empty query', async () => {
      const results = await addressAutocompleteService.searchAddresses('');
      expect(results).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle successful API response', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [
          {
            place_id: 'place1',
            description: '123 Main St, San Francisco, CA',
            structured_formatting: {
              main_text: '123 Main St',
              secondary_text: 'San Francisco, CA',
            },
          },
          {
            place_id: 'place2',
            description: '456 Oak Ave, San Francisco, CA',
            structured_formatting: {
              main_text: '456 Oak Ave',
              secondary_text: 'San Francisco, CA',
            },
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const results = await addressAutocompleteService.searchAddresses('123 Main');
      
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        id: 'place1',
        description: '123 Main St, San Francisco, CA',
        placeId: 'place1',
        mainText: '123 Main St',
        secondaryText: 'San Francisco, CA',
      });
    });

    it('should handle ZERO_RESULTS response', async () => {
      const mockResponse = {
        status: 'ZERO_RESULTS',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const results = await addressAutocompleteService.searchAddresses('nonexistent address');
      expect(results).toEqual([]);
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        status: 'REQUEST_DENIED',
        error_message: 'Invalid API key',
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      await expect(
        addressAutocompleteService.searchAddresses('123 Main')
      ).rejects.toThrow();
    });

    it('should handle network errors', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(
        addressAutocompleteService.searchAddresses('123 Main')
      ).rejects.toThrow('Network error');
    });

    it('should pass location parameters to API', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      await addressAutocompleteService.searchAddresses('123 Main', {
        latitude: 37.7749,
        longitude: -122.4194,
        radius: 50000,
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('location=37.7749,-122.4194');
      expect(fetchCall).toContain('radius=50000');
    });

    it('should pass types parameter to API', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      await addressAutocompleteService.searchAddresses('123 Main', {
        types: ['address', 'geocode'],
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('types=address%7Cgeocode');
    });

    it('should pass components parameter to API', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      await addressAutocompleteService.searchAddresses('123 Main', {
        components: 'country:us',
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0][0];
      expect(fetchCall).toContain('components=country%3Aus');
    });
  });

  describe('getPlaceDetails', () => {
    it('should fetch and parse place details', async () => {
      const mockResponse = {
        status: 'OK',
        result: {
          place_id: 'place1',
          formatted_address: '123 Main St, San Francisco, CA 94102, USA',
          geometry: {
            location: {
              lat: 37.7749,
              lng: -122.4194,
            },
          },
          address_components: [
            {
              long_name: '123',
              types: ['street_number'],
            },
            {
              long_name: 'Main St',
              types: ['route'],
            },
            {
              long_name: 'San Francisco',
              types: ['locality'],
            },
            {
              long_name: 'CA',
              short_name: 'CA',
              types: ['administrative_area_level_1'],
            },
            {
              long_name: 'United States',
              types: ['country'],
            },
            {
              long_name: '94102',
              types: ['postal_code'],
            },
          ],
        },
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const details = await addressAutocompleteService.getPlaceDetails('place1');
      
      expect(details).toEqual({
        placeId: 'place1',
        formattedAddress: '123 Main St, San Francisco, CA 94102, USA',
        latitude: 37.7749,
        longitude: -122.4194,
        components: {
          street: ' 123 Main St',
          city: 'San Francisco',
          state: 'CA',
          country: 'United States',
          postalCode: '94102',
        },
      });
    });

    it('should handle place details API errors', async () => {
      const mockResponse = {
        status: 'NOT_FOUND',
        error_message: 'Place not found',
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const details = await addressAutocompleteService.getPlaceDetails('invalid');
      expect(details).toBeNull();
    });
  });

  describe('validateAddress', () => {
    it('should return false for empty address', async () => {
      const isValid = await addressAutocompleteService.validateAddress('');
      expect(isValid).toBe(false);
    });

    it('should return false for short address', async () => {
      const isValid = await addressAutocompleteService.validateAddress('ab');
      expect(isValid).toBe(false);
    });

    it('should return true when suggestions are found', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [
          {
            place_id: 'place1',
            description: '123 Main St',
            structured_formatting: {
              main_text: '123 Main St',
            },
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const isValid = await addressAutocompleteService.validateAddress('123 Main St');
      expect(isValid).toBe(true);
    });

    it('should return false when no suggestions found', async () => {
      const mockResponse = {
        status: 'ZERO_RESULTS',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => mockResponse,
      });

      const isValid = await addressAutocompleteService.validateAddress('invalid address xyz');
      expect(isValid).toBe(false);
    });

    it('should return false on API error', async () => {
      (fetch as jest.Mock).mockRejectedValueOnce(new Error('API error'));

      const isValid = await addressAutocompleteService.validateAddress('123 Main St');
      expect(isValid).toBe(false);
    });
  });

  describe('Caching', () => {
    it('should cache search results', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [
          {
            place_id: 'place1',
            description: '123 Main St',
            structured_formatting: {
              main_text: '123 Main St',
            },
          },
        ],
      };

      (fetch as jest.Mock).mockResolvedValue({
        json: async () => mockResponse,
      });

      // First call
      await addressAutocompleteService.searchAddresses('123 Main');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Second call with same query - should use cache
      await addressAutocompleteService.searchAddresses('123 Main');
      expect(fetch).toHaveBeenCalledTimes(1); // Still 1, used cache
    });

    it('should clear cache', async () => {
      const mockResponse = {
        status: 'OK',
        predictions: [],
      };

      (fetch as jest.Mock).mockResolvedValue({
        json: async () => mockResponse,
      });

      // First call
      await addressAutocompleteService.searchAddresses('123 Main');
      expect(fetch).toHaveBeenCalledTimes(1);

      // Clear cache
      addressAutocompleteService.clearCache();

      // Second call - should make new request
      await addressAutocompleteService.searchAddresses('123 Main');
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
