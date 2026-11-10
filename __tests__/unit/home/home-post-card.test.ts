/**
 * Who gets the home "Post a job" card (lib/home/home-post-card.ts), and the
 * one-row lookup behind "has posted" / "Post again"
 * (hooks/useLatestPostedBounty.ts).
 */
const mockQuery: Record<string, jest.Mock> = {};
let mockResult: { data: unknown; error: unknown } = { data: [], error: null };
jest.mock('../../../lib/supabase', () => {
  const chain: any = {};
  for (const m of ['select', 'eq', 'neq', 'order']) {
    mockQuery[m] = jest.fn(() => chain);
    chain[m] = mockQuery[m];
  }
  mockQuery.limit = jest.fn(() => Promise.resolve(mockResult));
  chain.limit = mockQuery.limit;
  mockQuery.from = jest.fn(() => chain);
  return { supabase: { from: mockQuery.from } };
});

import { fetchLatestPostedBounty } from '../../../hooks/useLatestPostedBounty';
import { shouldShowHomePostCard } from '../../../lib/home/home-post-card';

describe('shouldShowHomePostCard', () => {
  it.each([
    ['poster', false, true],
    ['poster', true, true],
    ['hunter', true, true],
    ['both', true, true],
    [null, true, true],
    [undefined, true, true],
    ['hunter', false, false],
    ['both', false, false],
    [null, false, false],
    [undefined, false, false],
  ] as const)('role %s, has posted %s -> %s', (primaryRole, hasPosted, expected) => {
    expect(shouldShowHomePostCard({ primaryRole, hasPosted })).toBe(expected);
  });
});

describe('fetchLatestPostedBounty', () => {
  beforeEach(() => {
    Object.values(mockQuery).forEach(m => m.mockClear());
    mockResult = { data: [], error: null };
  });

  it("asks for one row: the viewer's newest bounty that wasn't removed", async () => {
    mockResult = { data: [{ id: 42, title: '  Fix my sink  ' }], error: null };
    await expect(fetchLatestPostedBounty('u-1')).resolves.toEqual({
      id: '42',
      title: 'Fix my sink',
    });
    expect(mockQuery.from).toHaveBeenCalledWith('bounties');
    expect(mockQuery.eq).toHaveBeenCalledWith('poster_id', 'u-1');
    expect(mockQuery.neq).toHaveBeenCalledWith('status', 'deleted');
    expect(mockQuery.order).toHaveBeenNthCalledWith(1, 'created_at', { ascending: false });
    expect(mockQuery.limit).toHaveBeenCalledWith(1);
  });

  it('returns null for someone who never posted', async () => {
    await expect(fetchLatestPostedBounty('u-1')).resolves.toBeNull();
  });

  it('throws on a query error, so the caller keeps what it knew', async () => {
    mockResult = { data: null, error: { message: 'boom' } };
    await expect(fetchLatestPostedBounty('u-1')).rejects.toThrow('boom');
  });
});
