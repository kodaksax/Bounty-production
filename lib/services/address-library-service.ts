import { supabase, isSupabaseConfigured } from '../supabase';
import { getCurrentUserId } from '../utils/data-utils';
import { logger } from '../utils/error-logger';
import { locationService } from './location-service';
import type { SavedAddress } from '../types';

/**
 * Address Library Service
 *
 * Backed by the `saved_locations` table (self-only via RLS), so favorites
 * sync across devices and survive reinstalls. Previously AsyncStorage-only
 * (device-local, lost on reinstall) — this replaces that with the same
 * public method signatures so existing callers (useAddressLibrary,
 * AddressAutocomplete's "saved addresses" list) don't need to change.
 */
class AddressLibraryService {
  private toSavedAddress(row: any): SavedAddress {
    return {
      id: row.id,
      label: row.label,
      address: row.address,
      unit: row.unit ?? undefined,
      latitude: row.latitude ?? undefined,
      longitude: row.longitude ?? undefined,
      createdAt: row.created_at,
    };
  }

  /**
   * Get all saved addresses for the current user.
   */
  async getAll(): Promise<SavedAddress[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('saved_locations')
        .select('id, label, address, unit, latitude, longitude, is_default, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('address-library getAll error', { error });
        return [];
      }
      return (data || []).map((row) => this.toSavedAddress(row));
    } catch (error) {
      logger.error('address-library getAll threw', { error });
      return [];
    }
  }

  /**
   * Add a new address to the library. If coordinates aren't supplied
   * (e.g. the caller already has them from a map picker / Place Details),
   * falls back to geocoding the address text.
   */
  async add(
    label: string,
    address: string,
    opts?: { unit?: string; latitude?: number; longitude?: number }
  ): Promise<SavedAddress | null> {
    if (!isSupabaseConfigured) return null;

    let latitude = opts?.latitude;
    let longitude = opts?.longitude;
    if (latitude == null || longitude == null) {
      const coords = await locationService.geocodeAddress(address);
      latitude = coords?.latitude;
      longitude = coords?.longitude;
    }

    try {
      const userId = getCurrentUserId();
      const { data, error } = await supabase
        .from('saved_locations')
        .insert({
          user_id: userId,
          label,
          address,
          unit: opts?.unit || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        })
        .select('id, label, address, unit, latitude, longitude, is_default, created_at')
        .single();

      if (error) {
        logger.error('address-library add error', { error });
        return null;
      }
      return this.toSavedAddress(data);
    } catch (error) {
      logger.error('address-library add threw', { error });
      return null;
    }
  }

  /**
   * Update an existing address.
   */
  async update(
    id: string,
    label: string,
    address: string,
    opts?: { unit?: string; latitude?: number; longitude?: number }
  ): Promise<SavedAddress | null> {
    if (!isSupabaseConfigured) return null;

    let latitude = opts?.latitude;
    let longitude = opts?.longitude;
    if (latitude == null || longitude == null) {
      const coords = await locationService.geocodeAddress(address);
      latitude = coords?.latitude;
      longitude = coords?.longitude;
    }

    try {
      const { data, error } = await supabase
        .from('saved_locations')
        .update({
          label,
          address,
          unit: opts?.unit || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
        })
        .eq('id', id)
        .select('id, label, address, unit, latitude, longitude, is_default, created_at')
        .maybeSingle();

      if (error) {
        logger.error('address-library update error', { error, id });
        return null;
      }
      return data ? this.toSavedAddress(data) : null;
    } catch (error) {
      logger.error('address-library update threw', { error, id });
      return null;
    }
  }

  /**
   * Delete an address from the library.
   */
  async delete(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const { error } = await supabase.from('saved_locations').delete().eq('id', id);
      if (error) {
        logger.error('address-library delete error', { error, id });
        return false;
      }
      return true;
    } catch (error) {
      logger.error('address-library delete threw', { error, id });
      return false;
    }
  }

  /**
   * Search addresses by query string (client-side filter over the loaded set).
   */
  async search(query: string): Promise<SavedAddress[]> {
    const all = await this.getAll();
    if (!query.trim()) return all;

    const lowerQuery = query.toLowerCase();
    return all.filter(
      (addr) =>
        addr.label.toLowerCase().includes(lowerQuery) ||
        addr.address.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get a single address by ID.
   */
  async getById(id: string): Promise<SavedAddress | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .from('saved_locations')
        .select('id, label, address, unit, latitude, longitude, is_default, created_at')
        .eq('id', id)
        .maybeSingle();

      if (error || !data) return null;
      return this.toSavedAddress(data);
    } catch (error) {
      logger.error('address-library getById threw', { error, id });
      return null;
    }
  }

  /**
   * Clear all of the current user's saved addresses.
   */
  async clear(): Promise<void> {
    if (!isSupabaseConfigured) return;
    try {
      const userId = getCurrentUserId();
      await supabase.from('saved_locations').delete().eq('user_id', userId);
    } catch (error) {
      logger.error('address-library clear threw', { error });
    }
  }
}

export const addressLibraryService = new AddressLibraryService();
