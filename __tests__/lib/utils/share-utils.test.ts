/**
 * Unit tests for lib/utils/share-utils.ts — covers URL/message building for
 * bounty and profile shares, the reward-vs-honor branch, description
 * truncation, and that share outcomes (completed/cancelled/link copied)
 * are tracked via analyticsService.
 */

const mockTrackEvent = jest.fn().mockResolvedValue(undefined);
jest.mock('../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...args: unknown[]) => mockTrackEvent(...args) },
}));

const mockShare = jest.fn().mockResolvedValue({ action: 'sharedAction' });
const mockAlert = jest.fn();
let mockPlatformOS: 'ios' | 'android' | 'web' = 'ios';

jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatformOS;
    },
  },
  Alert: { alert: (...args: unknown[]) => mockAlert(...args) },
  Share: {
    share: (...args: unknown[]) => mockShare(...args),
    sharedAction: 'sharedAction',
    dismissedAction: 'dismissedAction',
  },
}));

import { shareBounty, shareProfile } from '../../../lib/utils/share-utils';

describe('share-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockShare.mockResolvedValue({ action: 'sharedAction' });
  });

  describe('shareBounty', () => {
    it('builds a bountyfinder.app/bounty/:id link (singular path) and includes it as the iOS url', async () => {
      await shareBounty({ id: 'abc123', title: 'Mow my lawn', amount: 40 });

      expect(mockShare).toHaveBeenCalledTimes(1);
      const [content] = mockShare.mock.calls[0];
      expect(content.url).toBe('https://bountyfinder.app/bounty/abc123');
      expect(content.message).toContain('https://bountyfinder.app/bounty/abc123');
    });

    it('omits the separate url param on Android (embedded in message only)', async () => {
      mockPlatformOS = 'android';
      await shareBounty({ id: 'abc123', title: 'Mow my lawn', amount: 40 });

      const [content] = mockShare.mock.calls[0];
      expect(content.url).toBeUndefined();
      expect(content.message).toContain('https://bountyfinder.app/bounty/abc123');
    });

    it('shows a dollar reward line for normal bounties', async () => {
      await shareBounty({ id: '1', title: 'Task', amount: 250 });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain('$250 reward');
    });

    it('shows "For Honor" instead of a dollar amount when isForHonor is true', async () => {
      await shareBounty({ id: '1', title: 'Task', amount: 0, isForHonor: true });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain('For Honor');
      expect(content.message).not.toContain('$0');
    });

    it('truncates a long description to 140 characters with an ellipsis', async () => {
      const longDescription = 'x'.repeat(200);
      await shareBounty({ id: '1', title: 'Task', amount: 10, description: longDescription });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain(`${'x'.repeat(140)}...`);
      expect(content.message).not.toContain('x'.repeat(141));
    });

    it('includes category, location, and poster name when provided', async () => {
      await shareBounty({
        id: '1',
        title: 'Task',
        amount: 10,
        category: 'Design',
        location: 'Remote',
        posterName: '@alex',
      });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain('Design • Remote');
      expect(content.message).toContain('Posted by @alex');
    });

    it('tracks bounty_shared before presenting the share sheet, then share_completed on success', async () => {
      await shareBounty({ id: '1', title: 'Task', amount: 10 });
      expect(mockTrackEvent).toHaveBeenCalledWith('bounty_shared', expect.objectContaining({ content_id: '1' }));
      expect(mockTrackEvent).toHaveBeenCalledWith('share_completed', expect.objectContaining({ content_id: '1' }));
    });

    it('tracks share_cancelled when the user dismisses the share sheet', async () => {
      mockShare.mockResolvedValue({ action: 'dismissedAction' });
      await shareBounty({ id: '1', title: 'Task', amount: 10 });
      expect(mockTrackEvent).toHaveBeenCalledWith('share_cancelled', expect.objectContaining({ content_id: '1' }));
      expect(mockTrackEvent).not.toHaveBeenCalledWith('share_completed', expect.anything());
    });
  });

  describe('shareProfile', () => {
    it('builds a bountyfinder.app/profile/:id link', async () => {
      await shareProfile({ id: 'user1', name: 'Alex Doe' });
      const [content] = mockShare.mock.calls[0];
      expect(content.url).toBe('https://bountyfinder.app/profile/user1');
    });

    it('includes rating and completed-bounty stats when provided', async () => {
      await shareProfile({ id: 'user1', name: 'Alex Doe', averageRating: 4.8, ratingCount: 32, completedCount: 12 });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain('⭐ 4.8 (32)');
      expect(content.message).toContain('12 bounties completed');
    });

    it('falls back to @username when no display name is given', async () => {
      await shareProfile({ id: 'user1', username: 'alexdoe' });
      const [content] = mockShare.mock.calls[0];
      expect(content.message).toContain('@alexdoe');
    });

    it('on web, copies the link instead of invoking the native share sheet', async () => {
      mockPlatformOS = 'web';
      const writeText = jest.fn().mockResolvedValue(undefined);
      // @ts-expect-error test shim for the web clipboard API
      global.navigator.clipboard = { writeText };

      await shareProfile({ id: 'user1', name: 'Alex Doe' });

      expect(writeText).toHaveBeenCalledWith('https://bountyfinder.app/profile/user1');
      expect(mockShare).not.toHaveBeenCalled();
      expect(mockTrackEvent).toHaveBeenCalledWith('share_link_copied', expect.objectContaining({ content_id: 'user1' }));
    });
  });
});
