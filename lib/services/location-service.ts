import * as Location from 'expo-location';
import type { LocationCoordinates, LocationPermissionState } from '../types';

/**
 * Location Service
 * Handles location permissions and geolocation operations
 */
class LocationService {
  private currentLocation: LocationCoordinates | null = null;
  private permissionState: LocationPermissionState | null = null;

  /**
   * Request location permission from the user
   */
  async requestPermission(): Promise<LocationPermissionState> {
    try {
      const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
      
      this.permissionState = {
        granted: status === 'granted',
        canAskAgain,
        status: status as 'granted' | 'denied' | 'undetermined',
      };

      return this.permissionState;
    } catch (error) {
      console.error('Error requesting location permission:', error);
      return {
        granted: false,
        canAskAgain: false,
        status: 'denied',
      };
    }
  }

  /**
   * Get current permission status without requesting
   */
  async getPermissionStatus(): Promise<LocationPermissionState> {
    try {
      const { status, canAskAgain } = await Location.getForegroundPermissionsAsync();
      
      this.permissionState = {
        granted: status === 'granted',
        canAskAgain,
        status: status as 'granted' | 'denied' | 'undetermined',
      };

      return this.permissionState;
    } catch (error) {
      console.error('Error getting location permission status:', error);
      return {
        granted: false,
        canAskAgain: false,
        status: 'denied',
      };
    }
  }

  /**
   * Get the user's current location
   */
  async getCurrentLocation(): Promise<LocationCoordinates | null> {
    try {
      const permissionStatus = await this.getPermissionStatus();
      
      if (!permissionStatus.granted) {
        console.error('Location permission not granted');
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      this.currentLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      return this.currentLocation;
    } catch (error) {
      console.error('Error getting current location:', error);
      return null;
    }
  }

  /**
   * Get cached current location (doesn't fetch new location)
   */
  getCachedLocation(): LocationCoordinates | null {
    return this.currentLocation;
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   * @param from Starting coordinates
   * @param to Ending coordinates
   * @param unit Distance unit ('miles' or 'km')
   * @returns Distance in the specified unit
   */
  calculateDistance(
    from: LocationCoordinates,
    to: LocationCoordinates,
    unit: 'miles' | 'km' = 'miles'
  ): number {
    const R = unit === 'miles' ? 3959 : 6371; // Earth's radius in miles or km
    
    const lat1Rad = this.toRadians(from.latitude);
    const lat2Rad = this.toRadians(to.latitude);
    const deltaLatRad = this.toRadians(to.latitude - from.latitude);
    const deltaLonRad = this.toRadians(to.longitude - from.longitude);

    const a =
      Math.sin(deltaLatRad / 2) * Math.sin(deltaLatRad / 2) +
      Math.cos(lat1Rad) *
        Math.cos(lat2Rad) *
        Math.sin(deltaLonRad / 2) *
        Math.sin(deltaLonRad / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;

    return Math.round(distance * 10) / 10; // Round to 1 decimal place
  }

  /**
   * Geocode an address string to coordinates
   * Note: This requires network access and may have rate limits
   */
  async geocodeAddress(address: string): Promise<LocationCoordinates | null> {
    try {
      const results = await Location.geocodeAsync(address);
      
      if (results && results.length > 0) {
        return {
          latitude: results[0].latitude,
          longitude: results[0].longitude,
        };
      }

      return null;
    } catch (error) {
      console.error('Error geocoding address:', error);
      return null;
    }
  }

  /**
   * Reverse geocode coordinates to an address string
   */
  async reverseGeocode(coords: LocationCoordinates): Promise<string | null> {
    try {
      const results = await Location.reverseGeocodeAsync(coords);
      
      if (results && results.length > 0) {
        const location = results[0];
        const parts = [
          location.street,
          location.city,
          location.region,
          location.postalCode,
        ].filter(Boolean);
        
        return parts.join(', ');
      }

      return null;
    } catch (error) {
      console.error('Error reverse geocoding:', error);
      return null;
    }
  }

  /**
   * Convert degrees to radians
   */
  private toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }

  /**
   * Clear cached location data
   */
  clearCache(): void {
    this.currentLocation = null;
    this.permissionState = null;
  }
}

export const locationService = new LocationService();
