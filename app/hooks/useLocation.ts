import { useCallback, useEffect, useState } from 'react';
import { locationService } from '../../lib/services/location-service';
import type { LocationCoordinates, LocationPermissionState } from '../../lib/types';

export interface UseLocationResult {
  location: LocationCoordinates | null;
  permission: LocationPermissionState | null;
  isLoading: boolean;
  error: string | null;
  requestPermission: () => Promise<void>;
  getCurrentLocation: () => Promise<void>;
  calculateDistance: (to: LocationCoordinates, unit?: 'miles' | 'km') => number | null;
}

/**
 * Hook for managing location permissions and geolocation
 */
export function useLocation(): UseLocationResult {
  const [location, setLocation] = useState<LocationCoordinates | null>(null);
  const [permission, setPermission] = useState<LocationPermissionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize by checking permission status
  useEffect(() => {
    (async () => {
      try {
        const status = await locationService.getPermissionStatus();
        setPermission(status);
        
        // If already granted, get current location
        if (status.granted) {
          const loc = await locationService.getCurrentLocation();
          if (loc) {
            setLocation(loc);
          }
        }
      } catch (err) {
        console.error('Error initializing location:', err);
      }
    })();
  }, []);

  const requestPermission = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const status = await locationService.requestPermission();
      setPermission(status);

      if (status.granted) {
        const loc = await locationService.getCurrentLocation();
        if (loc) {
          setLocation(loc);
        } else {
          setError('Could not retrieve location');
        }
      } else {
        setError('Location permission denied');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to request permission';
      setError(message);
      console.error('Error requesting permission:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getCurrentLocation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const loc = await locationService.getCurrentLocation();
      if (loc) {
        setLocation(loc);
      } else {
        setError('Could not retrieve location');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get location';
      setError(message);
      console.error('Error getting location:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const calculateDistance = useCallback(
    (to: LocationCoordinates, unit: 'miles' | 'km' = 'miles'): number | null => {
      if (!location) {
        return null;
      }
      return locationService.calculateDistance(location, to, unit);
    },
    [location]
  );

  return {
    location,
    permission,
    isLoading,
    error,
    requestPermission,
    getCurrentLocation,
    calculateDistance,
  };
}

export default useLocation;
