/**
 * Unit tests for Search Service
 */

// Mock dependencies before imports
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          gte: jest.fn(() => ({
            order: jest.fn(() => ({
              limit: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        })),
      })),
    })),
  },
  isSupabaseConfigured: true,
}));

jest.mock('../../../lib/services/bounty-service', () => ({
  bountyService: {
    search: jest.fn(),
    searchWithFilters: jest.fn(),
  },
}));

jest.mock('../../../lib/services/user-search-service', () => ({
  userSearchService: {
    getUserSuggestions: jest.fn(),
  },
}));

jest.mock('../../../lib/utils/error-logger', () => ({
  logger: {
    error: jest.fn(),
    warning: jest.fn(),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchService } from '../../../lib/services/search-service';
import { bountyService } from '../../../lib/services/bounty-service';
import { userSearchService } from '../../../lib/services/user-search-service';

const mockAsyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockBountyService = bountyService as jest.Mocked<typeof bountyService>;
const mockUserSearchService = userSearchService as jest.Mocked<typeof userSearchService>;

describe('Search Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getAutocompleteSuggestions', () => {
    it('should return empty array for empty query', async () => {
      const result = await searchService.getAutocompleteSuggestions('');
      expect(result).toEqual([]);
    });

    it('should return empty array for whitespace query', async () => {
      const result = await searchService.getAutocompleteSuggestions('   ');
      expect(result).toEqual([]);
    });

    it('should return bounty suggestions when bounties match', async () => {
      mockBountyService.search.mockResolvedValue([
        { id: 1, title: 'React Developer Needed', amount: 100 } as any,
      ]);
      mockUserSearchService.getUserSuggestions.mockResolvedValue([]);

      const result = await searchService.getAutocompleteSuggestions('react');

      expect(result).toContainEqual(
        expect.objectContaining({
          type: 'bounty',
          text: 'React Developer Needed',
        })
      );
    });

    it('should return user suggestions when users match', async () => {
      mockBountyService.search.mockResolvedValue([]);
      mockUserSearchService.getUserSuggestions.mockResolvedValue([
        { id: 'user-1', username: 'reactdev', bio: 'React developer' } as any,
      ]);

      const result = await searchService.getAutocompleteSuggestions('react');

      expect(result).toContainEqual(
        expect.objectContaining({
          type: 'user',
          text: 'reactdev',
        })
      );
    });

    it('should return skill suggestions for matching skills', async () => {
      mockBountyService.search.mockResolvedValue([]);
      mockUserSearchService.getUserSuggestions.mockResolvedValue([]);

      const result = await searchService.getAutocompleteSuggestions('react');

      expect(result).toContainEqual(
        expect.objectContaining({
          type: 'skill',
          text: 'React',
        })
      );
    });

    it('should limit results to specified limit', async () => {
      mockBountyService.search.mockResolvedValue([
        { id: 1, title: 'Bounty 1', amount: 100 } as any,
        { id: 2, title: 'Bounty 2', amount: 200 } as any,
        { id: 3, title: 'Bounty 3', amount: 300 } as any,
      ]);
      mockUserSearchService.getUserSuggestions.mockResolvedValue([]);

      const result = await searchService.getAutocompleteSuggestions('bounty', 2);

      expect(result.length).toBeLessThanOrEqual(2);
    });
  });

  describe('Saved Searches', () => {
    const userId = 'test-user-id';

    describe('saveSearch', () => {
      it('should save a new search', async () => {
        mockAsyncStorage.getItem.mockResolvedValue(null);
        mockAsyncStorage.setItem.mockResolvedValue(undefined);

        const result = await searchService.saveSearch(
          userId,
          'My Search',
          'bounty',
          'react developer'
        );

        expect(result).toMatchObject({
          name: 'My Search',
          type: 'bounty',
          query: 'react developer',
          alertsEnabled: true,
        });
        expect(mockAsyncStorage.setItem).toHaveBeenCalled();
      });

      it('should append to existing searches', async () => {
        const existingSearches = [
          { id: 'existing-1', name: 'Existing', type: 'bounty', query: 'old', alertsEnabled: true, createdAt: '2023-01-01', userId },
        ];
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(existingSearches));
        mockAsyncStorage.setItem.mockResolvedValue(undefined);

        await searchService.saveSearch(userId, 'New Search', 'bounty', 'new query');

        const setItemCall = mockAsyncStorage.setItem.mock.calls[0];
        const savedData = JSON.parse(setItemCall[1]);
        expect(savedData).toHaveLength(2);
      });
    });

    describe('getSavedSearches', () => {
      it('should return empty array when no saved searches', async () => {
        mockAsyncStorage.getItem.mockResolvedValue(null);

        const result = await searchService.getSavedSearches(userId);

        expect(result).toEqual([]);
      });

      it('should return saved searches', async () => {
        const savedSearches = [
          { id: 'search-1', name: 'Search 1', type: 'bounty', query: 'test', alertsEnabled: true, createdAt: '2023-01-01', userId },
        ];
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(savedSearches));

        const result = await searchService.getSavedSearches(userId);

        expect(result).toHaveLength(1);
        expect(result[0].name).toBe('Search 1');
      });
    });

    describe('deleteSavedSearch', () => {
      it('should delete a saved search', async () => {
        const savedSearches = [
          { id: 'search-1', name: 'Search 1', type: 'bounty', query: 'test', alertsEnabled: true, createdAt: '2023-01-01', userId },
          { id: 'search-2', name: 'Search 2', type: 'bounty', query: 'test2', alertsEnabled: true, createdAt: '2023-01-02', userId },
        ];
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(savedSearches));
        mockAsyncStorage.setItem.mockResolvedValue(undefined);

        const result = await searchService.deleteSavedSearch(userId, 'search-1');

        expect(result).toBe(true);
        const setItemCall = mockAsyncStorage.setItem.mock.calls[0];
        const savedData = JSON.parse(setItemCall[1]);
        expect(savedData).toHaveLength(1);
        expect(savedData[0].id).toBe('search-2');
      });
    });

    describe('toggleSearchAlerts', () => {
      it('should toggle alerts on a saved search', async () => {
        const savedSearches = [
          { id: 'search-1', name: 'Search 1', type: 'bounty', query: 'test', alertsEnabled: true, createdAt: '2023-01-01', userId },
        ];
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(savedSearches));
        mockAsyncStorage.setItem.mockResolvedValue(undefined);

        const result = await searchService.toggleSearchAlerts(userId, 'search-1', false);

        expect(result).toBe(true);
        const setItemCall = mockAsyncStorage.setItem.mock.calls[0];
        const savedData = JSON.parse(setItemCall[1]);
        expect(savedData[0].alertsEnabled).toBe(false);
      });

      it('should return false for non-existent search', async () => {
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify([]));

        const result = await searchService.toggleSearchAlerts(userId, 'non-existent', false);

        expect(result).toBe(false);
      });
    });
  });

  describe('Filter Persistence', () => {
    describe('saveLastFilters', () => {
      it('should save filters to AsyncStorage', async () => {
        mockAsyncStorage.setItem.mockResolvedValue(undefined);

        const filters = { sortBy: 'date_desc' as const, status: ['open'] };
        await searchService.saveLastFilters(filters);

        expect(mockAsyncStorage.setItem).toHaveBeenCalledWith(
          '@bountyexpo:last_search_filters',
          JSON.stringify(filters)
        );
      });
    });

    describe('getLastFilters', () => {
      it('should return null when no saved filters', async () => {
        mockAsyncStorage.getItem.mockResolvedValue(null);

        const result = await searchService.getLastFilters();

        expect(result).toBeNull();
      });

      it('should return saved filters', async () => {
        const filters = { sortBy: 'date_desc', status: ['open'] };
        mockAsyncStorage.getItem.mockResolvedValue(JSON.stringify(filters));

        const result = await searchService.getLastFilters();

        expect(result).toEqual(filters);
      });
    });
  });

  describe('getTrendingBounties', () => {
    it('should return empty array when no bounties', async () => {
      const result = await searchService.getTrendingBounties(5);
      // Result depends on Supabase mock which returns empty array
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('calculateTrendingScores', () => {
    it('should calculate trending scores for bounties', () => {
      const bounties = [
        { id: '1', title: 'Bounty 1', amount: 100, created_at: new Date().toISOString() },
        { id: '2', title: 'Bounty 2', amount: 50, created_at: new Date(Date.now() - 86400000).toISOString() },
      ];

      const result = searchService.calculateTrendingScores(bounties, 2);

      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('trendingScore');
      expect(result[0]).toHaveProperty('title');
    });

    it('should sort by trending score descending', () => {
      const bounties = [
        { id: '1', title: 'Old Bounty', amount: 10, created_at: new Date(Date.now() - 86400000 * 3).toISOString() },
        { id: '2', title: 'New Bounty', amount: 100, created_at: new Date().toISOString() },
      ];

      const result = searchService.calculateTrendingScores(bounties, 2);

      // New bounty with higher amount should have higher score
      expect(result[0].title).toBe('New Bounty');
    });

    it('should limit results to specified count', () => {
      const bounties = [
        { id: '1', title: 'Bounty 1', amount: 100, created_at: new Date().toISOString() },
        { id: '2', title: 'Bounty 2', amount: 100, created_at: new Date().toISOString() },
        { id: '3', title: 'Bounty 3', amount: 100, created_at: new Date().toISOString() },
      ];

      const result = searchService.calculateTrendingScores(bounties, 2);

      expect(result).toHaveLength(2);
    });
  });
});
