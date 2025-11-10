import type { UserProfile, UserSearchFilters, SearchResult } from '../types';
import { isSupabaseConfigured, supabase } from '../supabase';
import { logger } from '../utils/error-logger';

export const userSearchService = {
  /**
   * Search users with advanced filtering and sorting
   */
  async searchUsers(filters: UserSearchFilters): Promise<SearchResult<UserProfile>> {
    try {
      if (!isSupabaseConfigured) {
        // Return mock data when Supabase is not configured
        return {
          results: [],
          total: 0,
          page: Math.floor((filters.offset || 0) / (filters.limit || 20)) + 1,
          pageSize: filters.limit || 20,
          hasMore: false,
        };
      }

      const limit = filters.limit ?? 20;
      const offset = filters.offset ?? 0;

      let query = supabase
        .from('profiles')
        .select('*', { count: 'exact' });

      // Apply keyword search on username, name, bio
      if (filters.keywords) {
        const keyword = filters.keywords.trim();
        query = query.or(
          `username.ilike.%${keyword}%,email.ilike.%${keyword}%,about.ilike.%${keyword}%`
        );
      }

      // Location filter
      if (filters.location) {
        // Assuming profiles table might have a location field in the future
        // For now, we'll search in the 'about' field
        query = query.ilike('about', `%${filters.location}%`);
      }

      // Skills filter - search in about/bio for skills
      if (filters.skills && filters.skills.length > 0) {
        const skillsConditions = filters.skills
          .map(skill => `about.ilike.%${skill}%`)
          .join(',');
        query = query.or(skillsConditions);
      }

      // Apply sorting
      switch (filters.sortBy) {
        case 'date_desc':
          query = query.order('created_at', { ascending: false });
          break;
        case 'followers_desc':
          // Note: This would require a followers count field or subquery
          // For now, fallback to creation date
          query = query.order('created_at', { ascending: false });
          break;
        case 'relevance':
        default:
          query = query.order('created_at', { ascending: false });
          break;
      }

      query = query.range(offset, offset + limit - 1);

      const { data, error, count } = await query;

      if (error) {
        logger.error('User search error', { error, filters });
        throw new Error(error.message || 'Failed to search users');
      }

      // Transform data to UserProfile format
      const profiles: UserProfile[] = (data || []).map((item: any) => ({
        id: item.id,
        username: item.username || `@user_${item.id.slice(0, 8)}`,
        name: item.email?.split('@')[0],
        avatar: item.avatar,
        bio: item.about,
        joinDate: item.created_at,
        skills: [], // Would need to be populated from a skills table
        languages: [],
        verificationStatus: 'unverified' as const,
        followerCount: 0,
        followingCount: 0,
      }));

      const total = count || 0;
      const page = Math.floor(offset / limit) + 1;
      const hasMore = offset + limit < total;

      return {
        results: profiles,
        total,
        page,
        pageSize: limit,
        hasMore,
      };
    } catch (error) {
      logger.error('searchUsers failed', { error, filters });
      return {
        results: [],
        total: 0,
        page: 1,
        pageSize: filters.limit || 20,
        hasMore: false,
      };
    }
  },

  /**
   * Get user by username
   */
  async getUserByUsername(username: string): Promise<UserProfile | null> {
    try {
      if (!isSupabaseConfigured) {
        return null;
      }

      // Remove @ if present
      const cleanUsername = username.startsWith('@') ? username.slice(1) : username;

      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .or(`username.eq.${cleanUsername},username.eq.@${cleanUsername}`)
        .single();

      if (error || !data) {
        return null;
      }

      return {
        id: data.id,
        username: data.username || `@user_${data.id.slice(0, 8)}`,
        name: data.email?.split('@')[0],
        avatar: data.avatar,
        bio: data.about,
        joinDate: data.created_at,
        skills: [],
        languages: [],
        verificationStatus: 'unverified' as const,
        followerCount: 0,
        followingCount: 0,
      };
    } catch (error) {
      logger.error('getUserByUsername failed', { username, error });
      return null;
    }
  },

  /**
   * Get user suggestions based on query
   */
  async getUserSuggestions(query: string, limit: number = 5): Promise<UserProfile[]> {
    if (!query.trim()) return [];

    const result = await this.searchUsers({
      keywords: query,
      limit,
      offset: 0,
    });

    return result.results;
  },
};
