import { useCallback, useEffect, useState } from 'react';
import { addressLibraryService } from '../../lib/services/address-library-service';
import type { SavedAddress } from '../../lib/types';

export interface UseAddressLibraryResult {
  addresses: SavedAddress[];
  isLoading: boolean;
  error: string | null;
  addAddress: (label: string, address: string) => Promise<SavedAddress | null>;
  updateAddress: (id: string, label: string, address: string) => Promise<SavedAddress | null>;
  deleteAddress: (id: string) => Promise<boolean>;
  searchAddresses: (query: string) => Promise<SavedAddress[]>;
  refresh: () => Promise<void>;
}

/**
 * Hook for managing the user's address library
 */
export function useAddressLibrary(): UseAddressLibraryResult {
  const [addresses, setAddresses] = useState<SavedAddress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAddresses = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await addressLibraryService.getAll();
      setAddresses(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load addresses';
      setError(message);
      console.error('Error loading addresses:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load addresses on mount
  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  const addAddress = useCallback(
    async (label: string, address: string): Promise<SavedAddress | null> => {
      try {
        setError(null);
        const newAddress = await addressLibraryService.add(label, address);
        setAddresses((prev) => [...prev, newAddress]);
        return newAddress;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add address';
        setError(message);
        console.error('Error adding address:', err);
        return null;
      }
    },
    []
  );

  const updateAddress = useCallback(
    async (id: string, label: string, address: string): Promise<SavedAddress | null> => {
      try {
        setError(null);
        const updated = await addressLibraryService.update(id, label, address);
        if (updated) {
          setAddresses((prev) => prev.map((addr) => (addr.id === id ? updated : addr)));
          return updated;
        }
        return null;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update address';
        setError(message);
        console.error('Error updating address:', err);
        return null;
      }
    },
    []
  );

  const deleteAddress = useCallback(async (id: string): Promise<boolean> => {
    try {
      setError(null);
      const success = await addressLibraryService.delete(id);
      if (success) {
        setAddresses((prev) => prev.filter((addr) => addr.id !== id));
      }
      return success;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete address';
      setError(message);
      console.error('Error deleting address:', err);
      return false;
    }
  }, []);

  const searchAddresses = useCallback(async (query: string): Promise<SavedAddress[]> => {
    try {
      setError(null);
      return await addressLibraryService.search(query);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search addresses';
      setError(message);
      console.error('Error searching addresses:', err);
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    await loadAddresses();
  }, [loadAddresses]);

  return {
    addresses,
    isLoading,
    error,
    addAddress,
    updateAddress,
    deleteAddress,
    searchAddresses,
    refresh,
  };
}

export default useAddressLibrary;
