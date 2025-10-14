import AsyncStorage from '@react-native-async-storage/async-storage';
import { locationService } from './location-service';
import type { SavedAddress } from '../types';

const ADDRESS_LIBRARY_KEY = '@bountyexpo:address_library';

/**
 * Address Library Service
 * Manages user's saved addresses with AsyncStorage persistence
 */
class AddressLibraryService {
  private addresses: SavedAddress[] = [];
  private isInitialized = false;

  /**
   * Initialize the service by loading saved addresses
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    try {
      const stored = await AsyncStorage.getItem(ADDRESS_LIBRARY_KEY);
      if (stored) {
        this.addresses = JSON.parse(stored);
      }
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing address library:', error);
      this.addresses = [];
      this.isInitialized = true;
    }
  }

  /**
   * Get all saved addresses
   */
  async getAll(): Promise<SavedAddress[]> {
    await this.initialize();
    return [...this.addresses];
  }

  /**
   * Add a new address to the library
   */
  async add(label: string, address: string): Promise<SavedAddress> {
    await this.initialize();

    // Try to geocode the address to get coordinates
    const coords = await locationService.geocodeAddress(address);

    const newAddress: SavedAddress = {
      id: Date.now().toString(),
      label,
      address,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
      createdAt: new Date().toISOString(),
    };

    this.addresses.push(newAddress);
    await this.save();

    return newAddress;
  }

  /**
   * Update an existing address
   */
  async update(id: string, label: string, address: string): Promise<SavedAddress | null> {
    await this.initialize();

    const index = this.addresses.findIndex((a) => a.id === id);
    if (index === -1) {
      return null;
    }

    // Try to geocode the new address
    const coords = await locationService.geocodeAddress(address);

    this.addresses[index] = {
      ...this.addresses[index],
      label,
      address,
      latitude: coords?.latitude,
      longitude: coords?.longitude,
    };

    await this.save();
    return this.addresses[index];
  }

  /**
   * Delete an address from the library
   */
  async delete(id: string): Promise<boolean> {
    await this.initialize();

    const initialLength = this.addresses.length;
    this.addresses = this.addresses.filter((a) => a.id !== id);

    if (this.addresses.length < initialLength) {
      await this.save();
      return true;
    }

    return false;
  }

  /**
   * Search addresses by query string
   */
  async search(query: string): Promise<SavedAddress[]> {
    await this.initialize();

    if (!query.trim()) {
      return this.addresses;
    }

    const lowerQuery = query.toLowerCase();
    return this.addresses.filter(
      (addr) =>
        addr.label.toLowerCase().includes(lowerQuery) ||
        addr.address.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get a single address by ID
   */
  async getById(id: string): Promise<SavedAddress | null> {
    await this.initialize();
    return this.addresses.find((a) => a.id === id) || null;
  }

  /**
   * Clear all addresses
   */
  async clear(): Promise<void> {
    this.addresses = [];
    await this.save();
  }

  /**
   * Save addresses to AsyncStorage
   */
  private async save(): Promise<void> {
    try {
      await AsyncStorage.setItem(ADDRESS_LIBRARY_KEY, JSON.stringify(this.addresses));
    } catch (error) {
      console.error('Error saving address library:', error);
      throw error;
    }
  }
}

export const addressLibraryService = new AddressLibraryService();
