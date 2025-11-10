import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BountySearchFilters, RecentSearch, UserSearchFilters } from '../types';

const RECENT_SEARCHES_KEY = '@bountyexpo:recent_searches';
const MAX_RECENT_SEARCHES = 10;

export const recentSearchService = {
  /**
   * Get all recent searches
   */
  async getRecentSearches(): Promise<RecentSearch[]> {
    try {
      const data = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
      if (!data) return [];
      const searches = JSON.parse(data) as RecentSearch[];
      // Sort by timestamp, most recent first
      return searches.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch (error) {
      console.error('Error loading recent searches:', error);
      return [];
    }
  },

  /**
   * Save a search to recent searches
   */
  async saveSearch(
    type: 'bounty' | 'user',
    query: string,
    filters?: BountySearchFilters | UserSearchFilters
  ): Promise<void> {
    try {
      // Don't save empty queries
      if (!query.trim()) return;

      const searches = await this.getRecentSearches();
      
      // Check if this exact search already exists
      const existingIndex = searches.findIndex(
        s => s.type === type && s.query.toLowerCase() === query.toLowerCase()
      );

      // Remove existing duplicate if found
      if (existingIndex !== -1) {
        searches.splice(existingIndex, 1);
      }

      // Add new search at the beginning
      const newSearch: RecentSearch = {
        id: `${type}_${Date.now()}`,
        type,
        query: query.trim(),
        filters,
        timestamp: new Date().toISOString(),
      };

      searches.unshift(newSearch);

      // Keep only the most recent searches
      const trimmedSearches = searches.slice(0, MAX_RECENT_SEARCHES);

      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(trimmedSearches));
    } catch (error) {
      console.error('Error saving recent search:', error);
    }
  },

  /**
   * Remove a specific recent search
   */
  async removeSearch(searchId: string): Promise<void> {
    try {
      const searches = await this.getRecentSearches();
      const filtered = searches.filter(s => s.id !== searchId);
      await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error removing recent search:', error);
    }
  },

  /**
   * Clear all recent searches
   */
  async clearAll(): Promise<void> {
    try {
      await AsyncStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch (error) {
      console.error('Error clearing recent searches:', error);
    }
  },

  /**
   * Get recent searches by type
   */
  async getRecentSearchesByType(type: 'bounty' | 'user'): Promise<RecentSearch[]> {
    const searches = await this.getRecentSearches();
    return searches.filter(s => s.type === type);
  },
};
