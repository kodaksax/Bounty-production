jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { followService } from '../../../lib/services/follow-service';
import { supabase } from '../../../lib/supabase';

const validUserId = '123e4567-e89b-42d3-a456-426614174000';

describe('followService UUID validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not query UUID columns with an empty ID', async () => {
    await expect(followService.isFollowing(validUserId, '')).resolves.toBe(false);
    await expect(followService.getFollowerCount('')).resolves.toBe(0);
    await expect(followService.getFollowingCount('')).resolves.toBe(0);
    await expect(followService.getFollowers('')).resolves.toEqual([]);
    await expect(followService.getFollowing('')).resolves.toEqual([]);
    await expect(followService.follow(validUserId, '')).resolves.toEqual({
      success: false,
      error: 'A valid user is required.',
    });
    await expect(followService.unfollow(validUserId, '')).resolves.toEqual({
      success: false,
      error: 'A valid user is required.',
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });
});
