import { supabase, isSupabaseConfigured } from '../supabase';
import { logger } from '../utils/error-logger';

export interface HunterServiceArea {
  id: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMiles: number | null; // null = Anywhere
  isPrimary: boolean;
  createdAt: string;
}

function toServiceArea(row: any): HunterServiceArea {
  return {
    id: row.id,
    label: row.label,
    latitude: row.latitude,
    longitude: row.longitude,
    radiusMiles: row.radius_miles,
    isPrimary: row.is_primary,
    createdAt: row.created_at,
  };
}

class HunterServiceAreaService {
  async getAll(): Promise<HunterServiceArea[]> {
    if (!isSupabaseConfigured) return [];
    try {
      const { data, error } = await supabase
        .from('hunter_service_areas')
        .select('id, label, latitude, longitude, radius_miles, is_primary, created_at')
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) {
        logger.error('hunter-service-area getAll error', { error });
        return [];
      }
      return (data || []).map(toServiceArea);
    } catch (error) {
      logger.error('hunter-service-area getAll threw', { error });
      return [];
    }
  }

  async upsertPrimary(params: {
    label: string;
    latitude: number;
    longitude: number;
    radiusMiles: number | null;
    hunterId: string;
    existingPrimaryId?: string;
  }): Promise<HunterServiceArea | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const payload = {
        hunter_id: params.hunterId,
        label: params.label,
        latitude: params.latitude,
        longitude: params.longitude,
        radius_miles: params.radiusMiles,
        is_primary: true,
      };

      const query = params.existingPrimaryId
        ? supabase.from('hunter_service_areas').update(payload).eq('id', params.existingPrimaryId)
        : supabase.from('hunter_service_areas').insert(payload);

      const { data, error } = await query
        .select('id, label, latitude, longitude, radius_miles, is_primary, created_at')
        .single();

      if (error) {
        logger.error('hunter-service-area upsertPrimary error', { error });
        return null;
      }
      return toServiceArea(data);
    } catch (error) {
      logger.error('hunter-service-area upsertPrimary threw', { error });
      return null;
    }
  }

  async addArea(params: {
    label: string;
    latitude: number;
    longitude: number;
    radiusMiles: number | null;
    hunterId: string;
  }): Promise<HunterServiceArea | null> {
    if (!isSupabaseConfigured) return null;
    try {
      const { data, error } = await supabase
        .from('hunter_service_areas')
        .insert({
          hunter_id: params.hunterId,
          label: params.label,
          latitude: params.latitude,
          longitude: params.longitude,
          radius_miles: params.radiusMiles,
          is_primary: false,
        })
        .select('id, label, latitude, longitude, radius_miles, is_primary, created_at')
        .single();

      if (error) {
        logger.error('hunter-service-area addArea error', { error });
        return null;
      }
      return toServiceArea(data);
    } catch (error) {
      logger.error('hunter-service-area addArea threw', { error });
      return null;
    }
  }

  async remove(id: string): Promise<boolean> {
    if (!isSupabaseConfigured) return false;
    try {
      const { error } = await supabase.from('hunter_service_areas').delete().eq('id', id);
      if (error) {
        logger.error('hunter-service-area remove error', { error, id });
        return false;
      }
      return true;
    } catch (error) {
      logger.error('hunter-service-area remove threw', { error, id });
      return false;
    }
  }
}

export const hunterServiceAreaService = new HunterServiceAreaService();
