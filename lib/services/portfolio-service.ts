import * as VideoThumbnails from 'expo-video-thumbnails';
import { supabase } from '../supabase';
import type { PortfolioItem } from '../types';
import { attachmentService } from './attachment-service';

/**
 * Real, Supabase-backed portfolio service against public.portfolio_items --
 * see supabase/migrations/20260914160000_portfolio_items.sql (table + RLS +
 * the 5-item-per-user trigger + the locked-down portfolio_pictures bucket).
 *
 * Replaces a previous AsyncStorage-only implementation whose item
 * metadata/ordering never left the device it was added on -- a poster
 * viewing a hunter's profile from a different device saw nothing, which
 * failed the "portfolio works across devices" requirement even though the
 * underlying files were already durably hosted in Supabase Storage.
 */

/** Maximum number of portfolio items per user -- spec caps "work samples" at 3-5. */
export const MAX_PORTFOLIO_ITEMS = 5;

interface PortfolioItemRow {
  id: string;
  user_id: string;
  type: 'image' | 'video' | 'file';
  url: string;
  thumbnail_url: string | null;
  title: string | null;
  description: string | null;
  category: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  position: number;
  created_at: string;
}

function mapRow(row: PortfolioItemRow): PortfolioItem {
  return {
    id: row.id,
    userId: row.user_id,
    type: row.type,
    url: row.url,
    thumbnail: row.thumbnail_url ?? undefined,
    title: row.title ?? undefined,
    description: row.description ?? undefined,
    name: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    sizeBytes: row.size_bytes ?? undefined,
    category: row.category ?? undefined,
    position: row.position,
    createdAt: row.created_at,
  };
}

export const portfolioService = {
  /**
   * Get portfolio items for a user, in display order.
   */
  getItems: async (userId: string): Promise<PortfolioItem[]> => {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('user_id', userId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[portfolio-service] getItems failed', error);
      return [];
    }
    return (data ?? []).map((row) => mapRow(row as PortfolioItemRow));
  },

  /**
   * Get a specific portfolio item
   */
  getItem: async (itemId: string): Promise<PortfolioItem | null> => {
    const { data, error } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('[portfolio-service] getItem failed', error);
      return null;
    }
    return mapRow(data as any);
  },

  /**
   * Add a portfolio item. Enforces MAX_PORTFOLIO_ITEMS app-side (the DB trigger
   * in the migration is the defense-in-depth backstop, not the only gate).
   */
  addItem: async (item: Omit<PortfolioItem, 'id' | 'createdAt'>): Promise<PortfolioItem> => {
    const count = await portfolioService.getItemCount(item.userId);
    if (count >= MAX_PORTFOLIO_ITEMS) {
      throw new Error(`Maximum of ${MAX_PORTFOLIO_ITEMS} portfolio items allowed`);
    }

    const { data, error } = await supabase
      .from('portfolio_items')
      .insert({
        user_id: item.userId,
        type: item.type,
        url: item.url,
        thumbnail_url: item.thumbnail ?? null,
        title: item.title ?? null,
        description: item.description ?? null,
        category: item.category ?? null,
        file_name: item.name ?? null,
        mime_type: item.mimeType ?? null,
        size_bytes: item.sizeBytes ?? null,
        position: count,
      })
      .select('*')
      .single();

    if (error || !data) {
      throw new Error(error?.message || 'Failed to add portfolio item');
    }
    return mapRow(data as any);
  },

  /**
   * Update a portfolio item
   */
  updateItem: async (itemId: string, updates: Partial<PortfolioItem>): Promise<PortfolioItem | null> => {
    const patch: Record<string, unknown> = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.category !== undefined) patch.category = updates.category;
    if (updates.thumbnail !== undefined) patch.thumbnail_url = updates.thumbnail;
    if (updates.position !== undefined) patch.position = updates.position;

    const { data, error } = await supabase
      .from('portfolio_items')
      .update(patch)
      .eq('id', itemId)
      .select('*')
      .maybeSingle();

    if (error || !data) {
      if (error) console.error('[portfolio-service] updateItem failed', error);
      return null;
    }
    return mapRow(data as any);
  },

  /**
   * Delete a portfolio item's row and best-effort remove its underlying
   * storage object (a failed storage delete does not block removing the
   * record -- an orphaned file is a smaller problem than a stuck "delete"
   * button).
   */
  deleteItem: async (itemId: string): Promise<{ success: boolean; error?: string }> => {
    const existing = await portfolioService.getItem(itemId);

    const { error } = await supabase.from('portfolio_items').delete().eq('id', itemId);
    if (error) {
      console.error('[portfolio-service] deleteItem failed', error);
      return { success: false, error: error.message };
    }

    if (existing?.url) {
      try {
        await attachmentService.delete(existing.url);
      } catch (e) {
        console.error('[portfolio-service] failed to delete storage object', e);
      }
    }

    return { success: true };
  },

  /**
   * Reorder portfolio items by writing new `position` values in a single
   * server-side statement (see the reorder_portfolio_items RPC in
   * supabase/migrations/20260915054500_reorder_portfolio_items_rpc.sql) --
   * one round trip instead of one UPDATE per item, and a real error surfaces
   * instead of a silently partial reorder.
   */
  reorderItems: async (userId: string, itemIds: string[]): Promise<PortfolioItem[]> => {
    const { data, error } = await supabase.rpc('reorder_portfolio_items', {
      p_item_ids: itemIds,
    });

    if (error) {
      console.error('[portfolio-service] reorderItems failed', error);
      throw new Error(error.message || 'Failed to reorder portfolio items');
    }

    return ((data ?? []) as PortfolioItemRow[])
      .map((row) => mapRow(row))
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  },

  /**
   * Get count of portfolio items for a user
   */
  getItemCount: async (userId: string): Promise<number> => {
    const { count, error } = await supabase
      .from('portfolio_items')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.error('[portfolio-service] getItemCount failed', error);
      return 0;
    }
    return count ?? 0;
  },

  /**
   * Check if user can add more portfolio items
   */
  canAddItem: async (userId: string): Promise<boolean> => {
    const count = await portfolioService.getItemCount(userId);
    return count < MAX_PORTFOLIO_ITEMS;
  },
};

/**
 * Generate a thumbnail for a video file
 * @param videoUri - URI of the video file
 * @param time - Time position in milliseconds (default: 0)
 * @returns URI of the generated thumbnail, or undefined on failure
 */
export async function generateVideoThumbnail(
  videoUri: string,
  time: number = 0
): Promise<string | undefined> {
  try {
    const { uri } = await VideoThumbnails.getThumbnailAsync(videoUri, {
      time,
      quality: 0.7,
    });
    return uri;
  } catch (error) {
    console.error('[portfolio-service] Failed to generate video thumbnail:', error);
    return undefined;
  }
}
