jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn(),
}));

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { blockingService } from '../../../lib/services/blocking-service';
import { supabase } from '../../../lib/supabase';
import { getCurrentUserId } from '../../../lib/utils/data-utils';

describe('blockingService', () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  test('blockUser requires authentication', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue(undefined);
    const res = await blockingService.blockUser('id-1');
    expect(res.success).toBe(false);
    expect(res.error).toBe('User not authenticated');
  });

  test('blockUser cannot block yourself', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue('me');
    const res = await blockingService.blockUser('me');
    expect(res.success).toBe(false);
    expect(res.error).toBe('Cannot block yourself');
  });

  test('blockUser handles unique constraint (already blocked)', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue('me');
    (supabase.from as jest.Mock).mockReturnValue({
      insert: async () => ({ error: { code: '23505' } }),
    });
    const res = await blockingService.blockUser('them');
    expect(res.success).toBe(false);
    expect(res.error).toBe('User is already blocked');
  });

  test('blockUser success path', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue('me');
    (supabase.from as jest.Mock).mockReturnValue({ insert: async () => ({ error: null }) });
    const res = await blockingService.blockUser('them');
    expect(res.success).toBe(true);
  });

  test('isUserBlocked returns false when not authenticated', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue(undefined);
    const res = await blockingService.isUserBlocked('someone');
    expect(res.isBlocked).toBe(false);
  });

  test('isUserBlocked returns false on PGRST116 (no rows)', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue('me');
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          }),
        }),
      }),
    });
    const res = await blockingService.isUserBlocked('someone');
    expect(res.isBlocked).toBe(false);
  });

  test('getBlockedUsers requires authentication', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue(undefined);
    const res = await blockingService.getBlockedUsers();
    expect(res.success).toBe(false);
    expect(res.error).toBe('User not authenticated');
  });

  test('getBlockedUsers returns data', async () => {
    (getCurrentUserId as jest.Mock).mockReturnValue('me');
    const data = [{ blocker_id: 'me', blocked_id: 'them' }];
    const profiles = [{ id: 'them', username: 'blocked-user', avatar: 'avatar.png' }];

    (supabase.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'blocked_users') {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data, error: null }),
          }),
        };
      }

      if (table === 'public_profiles') {
        return {
          select: () => ({
            in: () => Promise.resolve({ data: profiles, error: null }),
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    });

    const res = await blockingService.getBlockedUsers();

    expect(res.success).toBe(true);
    expect(res.blockedUsers).toEqual([
      {
        blocker_id: 'me',
        blocked_id: 'them',
        profiles: profiles[0],
      },
    ]);
  });
});
