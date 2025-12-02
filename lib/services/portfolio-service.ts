import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PortfolioItem } from '../types';

// In-memory cache: map of userId -> PortfolioItem[]
let portfolioStore: Record<string, PortfolioItem[]> | null = null;

const STORAGE_KEY = 'bountyexpo:portfolio_items_v1';

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
   */
  addItem: async (item: Omit<PortfolioItem, 'id' | 'createdAt'>): Promise<PortfolioItem> => {
    await loadFromStorage();
    if (!portfolioStore) portfolioStore = {};

    const newItem: PortfolioItem = {
      ...item,
      id: `p${Date.now()}`,
      createdAt: new Date().toISOString(),
    };

    const list = portfolioStore[item.userId] || [];
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
};
