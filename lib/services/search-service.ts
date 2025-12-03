import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Bounty } from './database.types';
import type {
  AutocompleteSuggestion,
  BountySearchFilters,
  SavedSearch,
  TrendingBounty,
} from '../types';
import { bountyService } from './bounty-service';
import { userSearchService } from './user-search-service';
import { isSupabaseConfigured, supabase } from '../supabase';
import { logger } from '../utils/error-logger';

const SAVED_SEARCHES_KEY = '@bountyexpo:saved_searches';
const SEARCH_FILTERS_KEY = '@bountyexpo:last_search_filters';
const DEBOUNCE_DELAY = 500;

// Common skills for autocomplete suggestions
const COMMON_SKILLS = [
  'React', 'React Native', 'JavaScript', 'TypeScript', 'Node.js',
  'Python', 'Java', 'Swift', 'Kotlin', 'Go',
  'Design', 'UI/UX', 'Graphic Design', 'Writing', 'Marketing',
  'Data Entry', 'Customer Support', 'Photography', 'Video Editing',
  'Translation', 'Research', 'Virtual Assistant', 'SEO', 'Social Media',
];

export const searchService = {
  /**
   * Get autocomplete suggestions based on query
   * Searches bounty titles, user names, and skills
   */
  async getAutocompleteSuggestions(
    query: string,
    limit: number = 8
  ): Promise<AutocompleteSuggestion[]> {
    if (!query.trim()) return [];

    const q = query.toLowerCase().trim();
    const suggestions: AutocompleteSuggestion[] = [];

    try {
      // Search bounties
      const bountyResults = await bountyService.search(q, { limit: 3 });
      bountyResults.forEach((bounty: Bounty) => {
        suggestions.push({
          id: `bounty_${bounty.id}`,
          type: 'bounty',
          text: bounty.title || 'Untitled',
          subtitle: bounty.amount != null ? `$${bounty.amount}` : 'For Honor',
          icon: 'work',
        });
      });

      // Search users
      const userResults = await userSearchService.getUserSuggestions(q, 3);
      userResults.forEach((user) => {
        suggestions.push({
          id: `user_${user.id}`,
          type: 'user',
          text: user.username,
          subtitle: user.bio?.slice(0, 50) || undefined,
          icon: 'person',
        });
      });

      // Search skills
      const matchingSkills = COMMON_SKILLS
        .filter((skill) => skill.toLowerCase().includes(q))
        .slice(0, 2);
      matchingSkills.forEach((skill) => {
        suggestions.push({
          id: `skill_${skill}`,
          type: 'skill',
          text: skill,
          subtitle: 'Skill',
          icon: 'star',
        });
      });

      return suggestions.slice(0, limit);
    } catch (error) {
      logger.error('getAutocompleteSuggestions failed', { query, error });
      return [];
    }
  },

  /**
   * Get trending bounties based on views and applications
   */
  async getTrendingBounties(limit: number = 5): Promise<TrendingBounty[]> {
    try {
      if (!isSupabaseConfigured) {
        return [];
      }

      // Get recent open bounties (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: bounties, error } = await supabase
        .from('bounties')
        .select(`
          *,
          profiles!bounties_profiles_fkey (
            username,
            avatar
          )
        `)
        .eq('status', 'open')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        // Fallback to query without join
        const { data: bountiesNoJoin, error: noJoinError } = await supabase
          .from('bounties')
          .select('*')
          .eq('status', 'open')
          .gte('created_at', sevenDaysAgo.toISOString())
          .order('created_at', { ascending: false })
          .limit(20);

        if (noJoinError) {
          throw noJoinError;
        }

        return this.calculateTrendingScores(bountiesNoJoin || [], limit);
      }

      return this.calculateTrendingScores(bounties || [], limit);
    } catch (error) {
      logger.error('getTrendingBounties failed', { error });
      return [];
    }
  },

  /**
   * Calculate trending scores for bounties
   * Score based on: recency, amount, and simulated engagement
   */
  calculateTrendingScores(bounties: any[], limit: number): TrendingBounty[] {
    const now = Date.now();

    const scored = bounties.map((bounty) => {
      const createdAt = new Date(bounty.created_at).getTime();
      const ageHours = (now - createdAt) / (1000 * 60 * 60);

      // Recency boost (newer = higher score)
      const recencyScore = Math.max(0, 100 - ageHours * 2);

      // Amount boost
      const amountScore = bounty.amount ? Math.min(bounty.amount / 10, 50) : 10;

      // Simulated engagement (based on deterministic hash of id)
      const hash = String(bounty.id)
        .split('')
        .reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const viewCount = (hash % 50) + 10;
      const applicationCount = (hash % 10) + 1;
      const engagementScore = viewCount * 0.5 + applicationCount * 5;

      const trendingScore = recencyScore + amountScore + engagementScore;

      return {
        id: String(bounty.id),
        title: bounty.title || 'Untitled',
        description: bounty.description,
        amount: bounty.amount,
        isForHonor: bounty.is_for_honor,
        viewCount,
        applicationCount,
        trendingScore,
        createdAt: bounty.created_at,
        posterUsername: bounty.profiles?.username || bounty.username,
        posterAvatar: bounty.profiles?.avatar || bounty.poster_avatar,
      };
    });

    // Sort by trending score and return top results
    return scored
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, limit);
  },

  /**
   * Save a search for alerts
   */
  async saveSearch(
    userId: string,
    name: string,
    type: 'bounty' | 'user',
    query: string,
    filters?: BountySearchFilters,
    alertsEnabled: boolean = true
  ): Promise<SavedSearch> {
    const savedSearches = await this.getSavedSearches(userId);

    const newSearch: SavedSearch = {
      id: `saved_${Date.now()}`,
      userId,
      name,
      type,
      query,
      filters,
      alertsEnabled,
      createdAt: new Date().toISOString(),
    };

    savedSearches.push(newSearch);
    await AsyncStorage.setItem(
      `${SAVED_SEARCHES_KEY}_${userId}`,
      JSON.stringify(savedSearches)
    );

    return newSearch;
  },

  /**
   * Get all saved searches for a user
   */
  async getSavedSearches(userId: string): Promise<SavedSearch[]> {
    try {
      const data = await AsyncStorage.getItem(`${SAVED_SEARCHES_KEY}_${userId}`);
      if (!data) return [];
      return JSON.parse(data) as SavedSearch[];
    } catch (error) {
      logger.error('getSavedSearches failed', { userId, error });
      return [];
    }
  },

  /**
   * Delete a saved search
   */
  async deleteSavedSearch(userId: string, searchId: string): Promise<boolean> {
    try {
      const savedSearches = await this.getSavedSearches(userId);
      const filtered = savedSearches.filter((s) => s.id !== searchId);
      await AsyncStorage.setItem(
        `${SAVED_SEARCHES_KEY}_${userId}`,
        JSON.stringify(filtered)
      );
      return true;
    } catch (error) {
      logger.error('deleteSavedSearch failed', { userId, searchId, error });
      return false;
    }
  },

  /**
   * Toggle alerts for a saved search
   */
  async toggleSearchAlerts(
    userId: string,
    searchId: string,
    enabled: boolean
  ): Promise<boolean> {
    try {
      const savedSearches = await this.getSavedSearches(userId);
      const search = savedSearches.find((s) => s.id === searchId);
      if (search) {
        search.alertsEnabled = enabled;
        await AsyncStorage.setItem(
          `${SAVED_SEARCHES_KEY}_${userId}`,
          JSON.stringify(savedSearches)
        );
        return true;
      }
      return false;
    } catch (error) {
      logger.error('toggleSearchAlerts failed', { userId, searchId, error });
      return false;
    }
  },

  /**
   * Save last used search filters
   */
  async saveLastFilters(filters: BountySearchFilters): Promise<void> {
    try {
      await AsyncStorage.setItem(SEARCH_FILTERS_KEY, JSON.stringify(filters));
    } catch (error) {
      logger.error('saveLastFilters failed', { error });
    }
  },

  /**
   * Get last used search filters
   */
  async getLastFilters(): Promise<BountySearchFilters | null> {
    try {
      const data = await AsyncStorage.getItem(SEARCH_FILTERS_KEY);
      if (!data) return null;
      return JSON.parse(data) as BountySearchFilters;
    } catch (error) {
      logger.error('getLastFilters failed', { error });
      return null;
    }
  },

  /**
   * Check saved searches for new matching bounties
   * Returns matching bounty count for notification purposes
   */
  async checkSavedSearchesForNewBounties(
    userId: string
  ): Promise<{ searchId: string; name: string; count: number }[]> {
    try {
      const savedSearches = await this.getSavedSearches(userId);
      const alertSearches = savedSearches.filter((s) => s.alertsEnabled && s.type === 'bounty');

      const results: { searchId: string; name: string; count: number }[] = [];

      for (const search of alertSearches) {
        const lastNotified = search.lastNotifiedAt
          ? new Date(search.lastNotifiedAt)
          : new Date(search.createdAt);

        // Search for bounties created after last notification
        const filters = {
          ...(search.filters as BountySearchFilters || {}),
          keywords: search.query || undefined,
          status: ['open'],
          limit: 10,
        };

        const bounties = await bountyService.searchWithFilters(filters);

        // Filter to only new bounties
        const newBounties = bounties.filter((b: Bounty) => {
          const createdAt = (b as any).created_at;
          return createdAt && new Date(createdAt) > lastNotified;
        });

        if (newBounties.length > 0) {
          results.push({
            searchId: search.id,
            name: search.name,
            count: newBounties.length,
          });

          // Update last notified time
          search.lastNotifiedAt = new Date().toISOString();
        }
      }

      // Save updated searches with new lastNotifiedAt times
      await AsyncStorage.setItem(
        `${SAVED_SEARCHES_KEY}_${userId}`,
        JSON.stringify(savedSearches)
      );

      return results;
    } catch (error) {
      logger.error('checkSavedSearchesForNewBounties failed', { userId, error });
      return [];
    }
  },
};
