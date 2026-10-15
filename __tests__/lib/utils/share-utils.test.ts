/**
 * Unit tests for lib/utils/share-utils.ts — covers URL/message building for
 * bounty and profile shares, privacy-safe bounty copy, and observable
 * share outcomes (completed/presented/cancelled/link copied)
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

const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(global, 'navigator');
const originalClipboardDescriptor =
  typeof global.navigator !== 'undefined'
    ? Object.getOwnPropertyDescriptor(global.navigator, 'clipboard')
    : undefined;

function installClipboardMock() {
  const writeText = jest.fn().mockResolvedValue(undefined);

  if (typeof global.navigator === 'undefined') {
    Object.defineProperty(global, 'navigator', {
      value: {},
      writable: true,
      configurable: true,
    });
  }

  Object.defineProperty(global.navigator, 'clipboard', {
    value: { writeText },
    writable: true,
    configurable: true,
  });

  return writeText;
}

function restoreNavigator() {
  if (typeof global.navigator !== 'undefined') {
    if (originalClipboardDescriptor) {
      Object.defineProperty(global.navigator, 'clipboard', originalClipboardDescriptor);
    } else {
      delete (global.navigator as typeof global.navigator & { clipboard?: Clipboard }).clipboard;
    }
  }

  if (originalNavigatorDescriptor) {
    Object.defineProperty(global, 'navigator', originalNavigatorDescriptor);
  } else {
    delete (global as typeof globalThis & { navigator?: Navigator }).navigator;
  }
}

describe('share-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPlatformOS = 'ios';
    mockShare.mockResolvedValue({ action: 'sharedAction' });
  });

  afterEach(() => {
    restoreNavigator();
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
      expect(mockTrackEvent).toHaveBeenCalledWith('share_presented', expect.objectContaining({
        content_type: 'bounty',
      }));
      expect(mockTrackEvent).not.toHaveBeenCalledWith('share_completed', expect.anything());
    });

    it('never includes raw bounty fields in messages, titles or analytics', async () => {
      await shareBounty({
        id: '1',
        title: 'Contact Alice at alice@example.test',
        amount: 250,
        description: 'Call 555-555-0123 at 123 Private Street',
        category: 'Private category',
        location: '123 Private Street',
        posterName: 'Alice',
      });
      const payload = JSON.stringify([mockShare.mock.calls, mockTrackEvent.mock.calls]);
      for (const secret of ['alice@example.test', '555-555-0123', 'Private Street', 'Private category', 'Alice', '$250']) {
        expect(payload).not.toContain(secret);
      }
      expect(mockShare.mock.calls[0][0].message).toContain('post a task of your own');
    });

    it('preserves privacy for honor bounties too', async () => {
      await shareBounty({ id: '1', title: 'Private title', amount: 0, isForHonor: true });
      expect(mockShare.mock.calls[0][0].message).not.toContain('Private title');
    });

    it('tracks post-publish placement without inventing a social destination', async () => {
      await shareBounty({ id: '1', title: 'Task', amount: 10, surface: 'post_publish' });
      expect(mockTrackEvent).toHaveBeenCalledWith('bounty_shared', {
        content_id: '1', content_type: 'bounty', surface: 'post_publish',
      });
    });

    it('tracks bounty_shared before presenting the share sheet, then share_completed on success', async () => {
      await shareBounty({ id: '1', title: 'Task', amount: 10 });
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'bounty_shared',
        expect.objectContaining({ content_id: '1' })
      );
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'share_completed',
        expect.objectContaining({ content_id: '1', completion_scope: 'native_activity' })
      );
    });

    it('tracks share_cancelled when the user dismisses the share sheet', async () => {
      mockShare.mockResolvedValue({ action: 'dismissedAction' });
      await shareBounty({ id: '1', title: 'Task', amount: 10 });
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'share_cancelled',
        expect.objectContaining({ content_id: '1' })
      );
      expect(mockTrackEvent).not.toHaveBeenCalledWith('share_completed', expect.anything());
    });

    it('does not report completion when sharing fails', async () => {
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockShare.mockRejectedValueOnce(new Error('Share unavailable'));
      try {
        expect(await shareBounty({ id: '1', title: 'Task', amount: 10 })).toBeUndefined();
        expect(mockTrackEvent).not.toHaveBeenCalledWith('share_completed', expect.anything());
      } finally {
        log.mockRestore();
      }
    });

    it('reports link display, not copy, when no clipboard exists', async () => {
      mockPlatformOS = 'web';
      installClipboardMock();
      delete (global.navigator as { clipboard?: Clipboard }).clipboard;
      expect(await shareBounty({ id: '1', title: 'Task', amount: 10 })).toBe('link_displayed');
      expect(mockTrackEvent).not.toHaveBeenCalledWith('share_link_copied', expect.anything());
      expect(mockShare).not.toHaveBeenCalled();
    });

    it('does not report a copy after a rejected clipboard write', async () => {
      mockPlatformOS = 'web';
      installClipboardMock().mockRejectedValueOnce(new Error('Permission denied'));
      const log = jest.spyOn(console, 'error').mockImplementation(() => {});
      try {
        expect(await shareBounty({ id: '1', title: 'Task', amount: 10 })).toBeUndefined();
        expect(mockTrackEvent).not.toHaveBeenCalledWith('share_link_copied', expect.anything());
      } finally {
        log.mockRestore();
      }
    });
  });

  describe('shareProfile', () => {
    it('builds a bountyfinder.app/profile/:id link', async () => {
      await shareProfile({ id: 'user1', name: 'Alex Doe' });
      const [content] = mockShare.mock.calls[0];
      expect(content.url).toBe('https://bountyfinder.app/profile/user1');
    });

    it('includes rating and completed-bounty stats when provided', async () => {
      await shareProfile({
        id: 'user1',
        name: 'Alex Doe',
        averageRating: 4.8,
        ratingCount: 32,
        completedCount: 12,
      });
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

      if (!global.navigator) {
        Object.defineProperty(global, 'navigator', {
          value: {},
          writable: true,
          configurable: true,
        });
      }

      const previousClipboard = Object.getOwnPropertyDescriptor(global.navigator, 'clipboard');
      Object.defineProperty(global.navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      });

      try {
        await shareProfile({ id: 'user1', name: 'Alex Doe' });
      } finally {
        if (previousClipboard) {
          Object.defineProperty(global.navigator, 'clipboard', previousClipboard);
        } else {
          delete (global.navigator as { clipboard?: { writeText: typeof writeText } }).clipboard;
        }
      }

      expect(writeText).toHaveBeenCalledWith('https://bountyfinder.app/profile/user1');
      expect(mockShare).not.toHaveBeenCalled();
      expect(mockTrackEvent).toHaveBeenCalledWith(
        'share_link_copied',
        expect.objectContaining({ content_id: 'user1' })
      );
    });
  });
});
