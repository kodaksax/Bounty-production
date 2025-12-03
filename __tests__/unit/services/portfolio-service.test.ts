// Define mock storage type
interface MockAsyncStorage {
  storage: Record<string, string>;
  getItem: jest.Mock<Promise<string | null>, [string]>;
  setItem: jest.Mock<Promise<void>, [string, string]>;
  clear: () => void;
}

// Mock AsyncStorage
const mockAsyncStorage: MockAsyncStorage = {
  storage: {} as Record<string, string>,
  getItem: jest.fn((key: string) => Promise.resolve(mockAsyncStorage.storage[key] || null)),
  setItem: jest.fn((key: string, value: string) => {
    mockAsyncStorage.storage[key] = value;
    return Promise.resolve();
  }),
  clear: () => { mockAsyncStorage.storage = {}; },
};

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);

// Mock expo-video-thumbnails
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

// Import portfolio service after mocks are set up
// We need to use a dynamic require to get fresh instances
let portfolioService: typeof import('../../../lib/services/portfolio-service').portfolioService;
let generateVideoThumbnail: typeof import('../../../lib/services/portfolio-service').generateVideoThumbnail;
let MAX_PORTFOLIO_ITEMS: typeof import('../../../lib/services/portfolio-service').MAX_PORTFOLIO_ITEMS;

const STORAGE_KEY = 'bountyexpo:portfolio_items_v1';

describe('portfolio-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAsyncStorage.clear();
    // Reset module to get fresh in-memory store
    jest.resetModules();
    // Re-require to get fresh module state
    const service = require('../../../lib/services/portfolio-service');
    portfolioService = service.portfolioService;
    generateVideoThumbnail = service.generateVideoThumbnail;
    MAX_PORTFOLIO_ITEMS = service.MAX_PORTFOLIO_ITEMS;
  });

  describe('MAX_PORTFOLIO_ITEMS', () => {
    it('should be set to 10', () => {
      expect(MAX_PORTFOLIO_ITEMS).toBe(10);
    });
  });

  describe('generateVideoThumbnail', () => {
    it('should generate a thumbnail for a video', async () => {
      const mockUri = 'file:///test-thumbnail.jpg';
      // Need to get fresh reference after module reset
      const VT = require('expo-video-thumbnails');
      VT.getThumbnailAsync.mockResolvedValue({ uri: mockUri });

      const result = await generateVideoThumbnail('file:///test-video.mp4');
      
      expect(result).toBe(mockUri);
      expect(VT.getThumbnailAsync).toHaveBeenCalledWith(
        'file:///test-video.mp4',
        { time: 0, quality: 0.7 }
      );
    });

    it('should use custom time parameter', async () => {
      const mockUri = 'file:///test-thumbnail.jpg';
      const VT = require('expo-video-thumbnails');
      VT.getThumbnailAsync.mockResolvedValue({ uri: mockUri });

      await generateVideoThumbnail('file:///test-video.mp4', 5000);
      
      expect(VT.getThumbnailAsync).toHaveBeenCalledWith(
        'file:///test-video.mp4',
        { time: 5000, quality: 0.7 }
      );
    });

    it('should return undefined on error', async () => {
      const VT = require('expo-video-thumbnails');
      VT.getThumbnailAsync.mockRejectedValue(new Error('Failed'));

      const result = await generateVideoThumbnail('file:///test-video.mp4');
      
      expect(result).toBeUndefined();
    });
  });

  describe('portfolioService.getItems', () => {
    it('should return empty array for user with no items', async () => {
      const items = await portfolioService.getItems('test-user');
      
      expect(items).toEqual([]);
    });

    it('should return items sorted by createdAt descending', async () => {
      const mockData = {
        'test-user': [
          { id: '1', userId: 'test-user', type: 'image', url: 'url1', createdAt: '2024-01-01T00:00:00Z' },
          { id: '2', userId: 'test-user', type: 'image', url: 'url2', createdAt: '2024-01-03T00:00:00Z' },
          { id: '3', userId: 'test-user', type: 'image', url: 'url3', createdAt: '2024-01-02T00:00:00Z' },
        ]
      };
      mockAsyncStorage.storage[STORAGE_KEY] = JSON.stringify(mockData);

      const items = await portfolioService.getItems('test-user');
      
      expect(items[0].id).toBe('2'); // Most recent
      expect(items[1].id).toBe('3');
      expect(items[2].id).toBe('1'); // Oldest
    });
  });

  describe('portfolioService.addItem', () => {
    it('should add an item and return it with id and createdAt', async () => {
      const newItem = await portfolioService.addItem({
        userId: 'test-user',
        type: 'image',
        url: 'https://example.com/image.jpg',
      });
      
      expect(newItem.id).toBeDefined();
      expect(newItem.id.startsWith('p')).toBe(true);
      expect(newItem.createdAt).toBeDefined();
      expect(newItem.userId).toBe('test-user');
      expect(newItem.type).toBe('image');
      expect(newItem.url).toBe('https://example.com/image.jpg');
    });
  });

  describe('portfolioService.getItemCount', () => {
    it('should return 0 for user with no items', async () => {
      const count = await portfolioService.getItemCount('test-user');
      
      expect(count).toBe(0);
    });

    it('should return correct count for user with items', async () => {
      const mockData = {
        'test-user': [
          { id: '1', userId: 'test-user', type: 'image', url: 'url1', createdAt: '2024-01-01T00:00:00Z' },
          { id: '2', userId: 'test-user', type: 'image', url: 'url2', createdAt: '2024-01-02T00:00:00Z' },
        ]
      };
      mockAsyncStorage.storage[STORAGE_KEY] = JSON.stringify(mockData);

      const count = await portfolioService.getItemCount('test-user');
      
      expect(count).toBe(2);
    });
  });

  describe('portfolioService.canAddItem', () => {
    it('should return true when user has fewer than MAX_PORTFOLIO_ITEMS', async () => {
      const mockData = {
        'test-user': Array(9).fill(null).map((_, i) => ({
          id: `${i}`,
          userId: 'test-user',
          type: 'image',
          url: `url${i}`,
          createdAt: new Date().toISOString(),
        }))
      };
      mockAsyncStorage.storage[STORAGE_KEY] = JSON.stringify(mockData);

      const canAdd = await portfolioService.canAddItem('test-user');
      
      expect(canAdd).toBe(true);
    });

    it('should return false when user has MAX_PORTFOLIO_ITEMS', async () => {
      const mockData = {
        'test-user': Array(10).fill(null).map((_, i) => ({
          id: `${i}`,
          userId: 'test-user',
          type: 'image',
          url: `url${i}`,
          createdAt: new Date().toISOString(),
        }))
      };
      mockAsyncStorage.storage[STORAGE_KEY] = JSON.stringify(mockData);

      const canAdd = await portfolioService.canAddItem('test-user');
      
      expect(canAdd).toBe(false);
    });
  });

  describe('portfolioService.reorderItems', () => {
    it('should reorder items according to provided order', async () => {
      const mockData = {
        'test-user': [
          { id: 'a', userId: 'test-user', type: 'image', url: 'url1', createdAt: '2024-01-01T00:00:00Z' },
          { id: 'b', userId: 'test-user', type: 'image', url: 'url2', createdAt: '2024-01-02T00:00:00Z' },
          { id: 'c', userId: 'test-user', type: 'image', url: 'url3', createdAt: '2024-01-03T00:00:00Z' },
        ]
      };
      mockAsyncStorage.storage[STORAGE_KEY] = JSON.stringify(mockData);

      const reordered = await portfolioService.reorderItems('test-user', ['c', 'a', 'b']);
      
      expect(reordered[0].id).toBe('c');
      expect(reordered[1].id).toBe('a');
      expect(reordered[2].id).toBe('b');
    });
  });
});
