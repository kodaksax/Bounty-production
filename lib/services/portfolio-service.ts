import AsyncStorage from '@react-native-async-storage/async-storage';
import * as VideoThumbnails from 'expo-video-thumbnails';
import type { PortfolioItem } from '../types';

// In-memory cache: map of userId -> PortfolioItem[]
let portfolioStore: Record<string, PortfolioItem[]> | null = null;

const STORAGE_KEY = 'bountyexpo:portfolio_items_v1';

/** Maximum number of portfolio items per user */
export const MAX_PORTFOLIO_ITEMS = 10;

// Load the per-user map from AsyncStorage into memory (noop if already loaded)
const loadFromStorage = async () => {
  if (portfolioStore !== null) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PortfolioItem[]>;
      if (parsed && typeof parsed === 'object') {
        portfolioStore = parsed;
        return;
      }
    }
  } catch (e) {
    console.warn('[portfolio-service] failed to load from storage', e);
  }
  // Initialize with empty store - no seed data for production readiness
  portfolioStore = {};
  await saveToStorage();
};

const saveToStorage = async () => {
  try {
    if (portfolioStore === null) portfolioStore = {};
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(portfolioStore));
  } catch (e) {
    console.warn('[portfolio-service] failed to save to storage', e);
  }
};

export const portfolioService = {
  /**
   * Get portfolio items for a user
   */
  getItems: async (userId: string): Promise<PortfolioItem[]> => {
    await loadFromStorage();
    const map = portfolioStore || {};
    const items = map[userId] || [];
    return items.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  /**
   * Get a specific portfolio item
   */
  getItem: async (itemId: string): Promise<PortfolioItem | null> => {
    await loadFromStorage();
    const map = portfolioStore || {};
    for (const uid of Object.keys(map)) {
      const found = map[uid].find(i => i.id === itemId);
      if (found) return found;
    }
    return null;
  },

  /**
   * Add a portfolio item
   * Enforces MAX_PORTFOLIO_ITEMS limit per user
   */
  addItem: async (item: Omit<PortfolioItem, 'id' | 'createdAt'>): Promise<PortfolioItem> => {
    await loadFromStorage();
    if (!portfolioStore) portfolioStore = {};

    const list = portfolioStore[item.userId] || [];
    
    // Check if user has reached the maximum limit
    if (list.length >= MAX_PORTFOLIO_ITEMS) {
      throw new Error(`Maximum of ${MAX_PORTFOLIO_ITEMS} portfolio items allowed`);
    }

    const newItem: PortfolioItem = {
      ...item,
      id: `p${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    portfolioStore[item.userId] = [newItem, ...list];
    await saveToStorage();
    return newItem;
  },

  /**
   * Update a portfolio item
   */
  updateItem: async (itemId: string, updates: Partial<PortfolioItem>): Promise<PortfolioItem | null> => {
    await loadFromStorage();
    if (!portfolioStore) portfolioStore = {};

    for (const uid of Object.keys(portfolioStore)) {
      const list = portfolioStore[uid];
      const idx = list.findIndex(i => i.id === itemId);
      if (idx >= 0) {
        const item = list[idx];
        Object.assign(item, updates);
        await saveToStorage();
        return item;
      }
    }
    return null;
  },

  /**
   * Delete a portfolio item (optimistic update)
   */
  deleteItem: async (itemId: string): Promise<{ success: boolean; error?: string }> => {
    await loadFromStorage();
    if (!portfolioStore) portfolioStore = {};

    for (const uid of Object.keys(portfolioStore)) {
      const list = portfolioStore[uid];
      const index = list.findIndex(i => i.id === itemId);
      if (index === -1) continue;

      const deletedItem = list[index];
      list.splice(index, 1);
      portfolioStore[uid] = list;
      await saveToStorage();

      // Simulate network delay - could fail in real scenario
      return new Promise((resolve) => {
        setTimeout(() => {
          // Simulate 5% failure rate
          if (Math.random() < 0.05) {
            // Rollback
            list.splice(index, 0, deletedItem);
            portfolioStore![uid] = list;
            saveToStorage();
            resolve({ success: false, error: 'Network error' });
          } else {
            resolve({ success: true });
          }
        }, 300);
      });
    }

    return { success: false, error: 'Item not found' };
  },

  /**
   * Reorder portfolio items for a user
   * @param userId - User ID
   * @param itemIds - Array of item IDs in the new order
   */
  reorderItems: async (userId: string, itemIds: string[]): Promise<PortfolioItem[]> => {
    await loadFromStorage();
    if (!portfolioStore) portfolioStore = {};

    const list = portfolioStore[userId] || [];
    
    // Create a map of id -> item for quick lookup
    const itemMap = new Map(list.map(item => [item.id, item]));
    
    // Reorder based on the provided itemIds
    const reordered: PortfolioItem[] = [];
    for (const id of itemIds) {
      const item = itemMap.get(id);
      if (item) {
        reordered.push(item);
        itemMap.delete(id);
      }
    }
    
    // Append any items not in the itemIds list (shouldn't happen, but defensive)
    for (const item of itemMap.values()) {
      reordered.push(item);
    }
    
    portfolioStore[userId] = reordered;
    await saveToStorage();
    return reordered;
  },

  /**
   * Get count of portfolio items for a user
   */
  getItemCount: async (userId: string): Promise<number> => {
    await loadFromStorage();
    const map = portfolioStore || {};
    return (map[userId] || []).length;
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
    console.warn('[portfolio-service] Failed to generate video thumbnail:', error);
    return undefined;
  }
}
