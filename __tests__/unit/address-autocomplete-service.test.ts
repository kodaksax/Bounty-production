/**
 * Unit tests for Address Autocomplete Service
 * 
 * Note: These tests verify the structure and error handling of the service.
 * In a real environment with a valid API key, the service would make actual API calls.
 */

describe('AddressAutocompleteService', () => {
  // Mock expo-constants to simulate environment without API key
  jest.mock('expo-constants', () => ({
    default: {
      expoConfig: {
        extra: {},
      },
    },
  }));

  let addressAutocompleteService: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    
    // Clear module cache to get fresh instance
    jest.resetModules();
    
    // Import the service
    const module = await import('../../lib/services/address-autocomplete-service');
    addressAutocompleteService = module.addressAutocompleteService;
    addressAutocompleteService.clearCache();
  });

  describe('Configuration', () => {
    it('should report configuration status', () => {
      const isConfigured = addressAutocompleteService.isConfigured();
      expect(typeof isConfigured).toBe('boolean');
    });

    it('should return false when not configured', () => {
      const isConfigured = addressAutocompleteService.isConfigured();
      // In test environment without API key, should return false
      expect(isConfigured).toBe(false);
    });
  });

  describe('searchAddresses', () => {
    it('should return empty array for queries less than 2 characters', async () => {
      const results = await addressAutocompleteService.searchAddresses('a');
      expect(results).toEqual([]);
    });

    it('should return empty array for empty query', async () => {
      const results = await addressAutocompleteService.searchAddresses('');
      expect(results).toEqual([]);
    });

    it('should return empty array when not configured', async () => {
      const results = await addressAutocompleteService.searchAddresses('123 Main St');
      expect(results).toEqual([]);
    });


  });

  describe('getPlaceDetails', () => {
    it('should return null when not configured', async () => {
      const details = await addressAutocompleteService.getPlaceDetails('place1');
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

    it('should return false when not configured', async () => {
      const isValid = await addressAutocompleteService.validateAddress('123 Main St');
      expect(isValid).toBe(false);
    });
  });

  describe('Caching', () => {
    it('should have a clearCache method', () => {
      expect(typeof addressAutocompleteService.clearCache).toBe('function');
      // Should not throw
      addressAutocompleteService.clearCache();
    });
  });

  describe('API Methods', () => {
    it('should have searchAddresses method', () => {
      expect(typeof addressAutocompleteService.searchAddresses).toBe('function');
    });

    it('should have getPlaceDetails method', () => {
      expect(typeof addressAutocompleteService.getPlaceDetails).toBe('function');
    });

    it('should have validateAddress method', () => {
      expect(typeof addressAutocompleteService.validateAddress).toBe('function');
    });

    it('should have isConfigured method', () => {
      expect(typeof addressAutocompleteService.isConfigured).toBe('function');
    });
  });
});
