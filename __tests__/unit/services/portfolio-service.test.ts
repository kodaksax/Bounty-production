jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

jest.mock('../../../lib/services/attachment-service', () => ({
  attachmentService: {
    delete: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(),
}));

import { attachmentService } from '../../../lib/services/attachment-service';
import { generateVideoThumbnail, MAX_PORTFOLIO_ITEMS, portfolioService } from '../../../lib/services/portfolio-service';
import { supabase } from '../../../lib/supabase';

/**
 * Minimal thenable chainable query-builder mock: every method returns
 * `this` so call chains of any shape resolve, and awaiting the builder
 * itself resolves to `result` -- the same pattern the real supabase-js
 * client's PostgrestFilterBuilder follows.
 */
function makeQueryBuilder(result: { data?: any; error?: any; count?: number }) {
  const builder: any = {
    select: jest.fn(() => builder),
    insert: jest.fn(() => builder),
    update: jest.fn(() => builder),
    delete: jest.fn(() => builder),
    eq: jest.fn(() => builder),
    order: jest.fn(() => builder),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    single: jest.fn(() => Promise.resolve(result)),
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

const mockFrom = supabase.from as jest.Mock;
const mockRpc = supabase.rpc as jest.Mock;

describe('portfolio-service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('MAX_PORTFOLIO_ITEMS', () => {
    it('is set to 5', () => {
      expect(MAX_PORTFOLIO_ITEMS).toBe(5);
    });
  });

  describe('generateVideoThumbnail', () => {
    it('generates a thumbnail for a video', async () => {
      const mockUri = 'file:///test-thumbnail.jpg';
      const VT = require('expo-video-thumbnails');
      VT.getThumbnailAsync.mockResolvedValue({ uri: mockUri });

      const result = await generateVideoThumbnail('file:///test-video.mp4');

      expect(result).toBe(mockUri);
    });

    it('returns undefined on error', async () => {
      const VT = require('expo-video-thumbnails');
      VT.getThumbnailAsync.mockRejectedValue(new Error('Failed'));

      const result = await generateVideoThumbnail('file:///test-video.mp4');

      expect(result).toBeUndefined();
    });
  });

  describe('portfolioService.getItems', () => {
    it('returns empty array for a user with no items', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ data: [], error: null }));

      const items = await portfolioService.getItems('test-user');

      expect(items).toEqual([]);
      expect(mockFrom).toHaveBeenCalledWith('portfolio_items');
    });

    it('maps DB rows (snake_case) to PortfolioItem (camelCase) in server order', async () => {
      mockFrom.mockReturnValue(
        makeQueryBuilder({
          data: [
            { id: '1', user_id: 'test-user', type: 'image', url: 'url1', thumbnail_url: null, title: null, description: null, category: null, file_name: null, mime_type: null, size_bytes: null, position: 0, created_at: '2024-01-01T00:00:00Z' },
            { id: '2', user_id: 'test-user', type: 'image', url: 'url2', thumbnail_url: null, title: null, description: null, category: null, file_name: null, mime_type: null, size_bytes: null, position: 1, created_at: '2024-01-02T00:00:00Z' },
          ],
          error: null,
        })
      );

      const items = await portfolioService.getItems('test-user');

      expect(items.map((i) => i.id)).toEqual(['1', '2']);
      expect(items[0].userId).toBe('test-user');
    });

    it('returns empty array (not throw) on a query error', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ data: null, error: { message: 'boom' } }));

      const items = await portfolioService.getItems('test-user');

      expect(items).toEqual([]);
    });
  });

  describe('portfolioService.addItem', () => {
    it('inserts and returns the mapped item when under the limit', async () => {
      mockFrom.mockImplementation((table: string) => {
        if (table === 'portfolio_items') {
          const builder = makeQueryBuilder({ count: 0, error: null });
          // Second call in addItem is the insert().select().single() chain.
          builder.single = jest.fn(() =>
            Promise.resolve({
              data: {
                id: 'p1',
                user_id: 'test-user',
                type: 'image',
                url: 'https://example.com/image.jpg',
                thumbnail_url: null,
                title: null,
                description: null,
                category: null,
                file_name: null,
                mime_type: null,
                size_bytes: null,
                position: 0,
                created_at: '2024-01-01T00:00:00Z',
              },
              error: null,
            })
          );
          return builder;
        }
        return makeQueryBuilder({ data: null, error: null });
      });

      const item = await portfolioService.addItem({
        userId: 'test-user',
        type: 'image',
        url: 'https://example.com/image.jpg',
      });

      expect(item.id).toBe('p1');
      expect(item.userId).toBe('test-user');
      expect(item.url).toBe('https://example.com/image.jpg');
    });

    it('throws before inserting once the user is at MAX_PORTFOLIO_ITEMS', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ count: MAX_PORTFOLIO_ITEMS, error: null }));

      await expect(
        portfolioService.addItem({ userId: 'test-user', type: 'image', url: 'url' })
      ).rejects.toThrow(`Maximum of ${MAX_PORTFOLIO_ITEMS} portfolio items allowed`);
    });
  });

  describe('portfolioService.getItemCount / canAddItem', () => {
    it('returns 0 / true for a user with no items', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ count: 0, error: null }));

      expect(await portfolioService.getItemCount('test-user')).toBe(0);
      expect(await portfolioService.canAddItem('test-user')).toBe(true);
    });

    it('returns false once at the max', async () => {
      mockFrom.mockReturnValue(makeQueryBuilder({ count: MAX_PORTFOLIO_ITEMS, error: null }));

      expect(await portfolioService.canAddItem('test-user')).toBe(false);
    });
  });

  describe('portfolioService.deleteItem', () => {
    it('deletes the row and best-effort deletes the storage object', async () => {
      mockFrom.mockImplementation((table: string) => {
        const builder = makeQueryBuilder({ data: null, error: null });
        builder.maybeSingle = jest.fn(() =>
          Promise.resolve({
            data: {
              id: 'p1',
              user_id: 'test-user',
              type: 'image',
              url: 'https://x.supabase.co/storage/v1/object/public/portfolio_pictures/test-user/p1.jpg',
              thumbnail_url: null,
              title: null,
              description: null,
              category: null,
              file_name: null,
              mime_type: null,
              size_bytes: null,
              position: 0,
              created_at: '2024-01-01T00:00:00Z',
            },
            error: null,
          })
        );
        return builder;
      });

      const result = await portfolioService.deleteItem('p1');

      expect(result.success).toBe(true);
      expect(attachmentService.delete).toHaveBeenCalledWith(
        'https://x.supabase.co/storage/v1/object/public/portfolio_pictures/test-user/p1.jpg'
      );
    });

    it('reports failure without touching storage when the row delete fails', async () => {
      mockFrom.mockImplementation(() => {
        const builder = makeQueryBuilder({ data: null, error: { message: 'db down' } });
        builder.maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
        return builder;
      });

      const result = await portfolioService.deleteItem('p1');

      expect(result).toEqual({ success: false, error: 'db down' });
      expect(attachmentService.delete).not.toHaveBeenCalled();
    });
  });

  describe('portfolioService.reorderItems', () => {
    it('calls the reorder_portfolio_items RPC once and returns items in the new order', async () => {
      mockRpc.mockResolvedValue({
        data: [
          { id: 'c', user_id: 'test-user', type: 'image', url: 'url3', thumbnail_url: null, title: null, description: null, category: null, file_name: null, mime_type: null, size_bytes: null, position: 0, created_at: '2024-01-03T00:00:00Z' },
          { id: 'a', user_id: 'test-user', type: 'image', url: 'url1', thumbnail_url: null, title: null, description: null, category: null, file_name: null, mime_type: null, size_bytes: null, position: 1, created_at: '2024-01-01T00:00:00Z' },
          { id: 'b', user_id: 'test-user', type: 'image', url: 'url2', thumbnail_url: null, title: null, description: null, category: null, file_name: null, mime_type: null, size_bytes: null, position: 2, created_at: '2024-01-02T00:00:00Z' },
        ],
        error: null,
      });

      const reordered = await portfolioService.reorderItems('test-user', ['c', 'a', 'b']);

      expect(mockRpc).toHaveBeenCalledTimes(1);
      expect(mockRpc).toHaveBeenCalledWith('reorder_portfolio_items', { p_item_ids: ['c', 'a', 'b'] });
      expect(reordered.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    });

    it('throws and does not swallow an error from the RPC', async () => {
      mockRpc.mockResolvedValue({ data: null, error: { message: 'db down' } });

      await expect(portfolioService.reorderItems('test-user', ['c', 'a', 'b'])).rejects.toThrow('db down');
    });
  });
});
