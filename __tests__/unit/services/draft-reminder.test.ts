/**
 * The 24h unfinished-post reminder (lib/services/draft-reminder.ts): a local
 * notification, re-armed by each edit, cancelled by publish/clear/sign-out,
 * at most one per draft, and never scheduled without permission or with
 * Marketplace push turned off.
 */
import type { BountyDraft } from 'app/hooks/useBountyDraft';

const mockPlatform = { OS: 'ios' };
jest.mock('react-native', () => ({ Platform: mockPlatform }));

const mockStore = new Map<string, string>();
jest.mock('lib/storage', () => {
  const storage = {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
  };
  return { storage, default: storage };
});

const mockCapture = jest.fn();
jest.mock('lib/posthog', () => ({ capture: (...args: unknown[]) => mockCapture(...args) }));

let mockPrefs: Record<string, boolean> = {};
jest.mock('lib/services/notification-service', () => ({
  notificationService: { getChannelPreferences: jest.fn(async () => mockPrefs) },
}));

const mockNotifications = {
  getPermissionsAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { DATE: 'date' },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
};
jest.mock('expo-notifications', () => mockNotifications);

import {
  DRAFT_REMINDER_DEBOUNCE_MS,
  DRAFT_REMINDER_DELAY_MS,
  cancelDraftReminder,
  draftReminderContent,
  draftReminderIdentifier,
  scheduleDraftReminder,
  scheduleDraftReminderSoon,
} from 'lib/services/draft-reminder';

const draft = (overrides: Partial<BountyDraft> = {}): BountyDraft => ({
  title: 'Walk my dog',
  description: 'Thirty minute walk around the block on Saturday morning',
  amount: 20,
  isForHonor: false,
  location: '123 Main St',
  workType: 'in_person',
  ...overrides,
});

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
let userSeq = 0;
let user = '';

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  mockPrefs = {};
  mockPlatform.OS = 'ios';
  mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: true, status: 'granted' });
  // A fresh user per test, so the module's per-user preference cache and
  // cancel generations never leak between tests.
  user = `user-${++userSeq}`;
});

describe('draftReminderContent', () => {
  it('counts the steps still to go from where the draft would resume', () => {
    expect(draftReminderContent(draft({ description: 'short' })).body).toBe(
      '"Walk my dog" is 3 steps from going live.'
    );
    expect(draftReminderContent(draft()).body).toBe('"Walk my dog" is 2 steps from going live.');
    expect(draftReminderContent(draft({ workType: 'online' })).body).toBe(
      '"Walk my dog" is 1 step from going live.'
    );
  });

  it('deep-links to the Post tab', () => {
    expect(draftReminderContent(draft()).data).toMatchObject({
      type: 'draft_reminder',
      deepLinkPath: '/tabs/bounty-app?tab=postings',
    });
  });
});

describe('scheduleDraftReminder', () => {
  it('schedules one replaceable reminder 24h out and reports it once', async () => {
    await scheduleDraftReminder(user, draft(), NOW);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const req = (mockNotifications.scheduleNotificationAsync.mock.calls[0] as any[])[0];
    expect(req.identifier).toBe(draftReminderIdentifier(user));
    expect(req.trigger).toEqual({
      type: 'date',
      date: new Date(NOW + DRAFT_REMINDER_DELAY_MS),
      channelId: 'bounties',
    });
    expect(req.content.title).toBe('Your bounty draft is waiting');
    expect(mockCapture).toHaveBeenCalledWith(
      'notification_generated',
      expect.objectContaining({ notification_type: 'draft_reminder', channels: ['local_push'] })
    );
  });

  it('re-arms from the latest edit without reporting a second reminder', async () => {
    await scheduleDraftReminder(user, draft(), NOW);
    await scheduleDraftReminder(user, draft({ workType: 'online' }), NOW + 60_000);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    const second = (mockNotifications.scheduleNotificationAsync.mock.calls[1] as any[])[0];
    expect(second.trigger.date).toEqual(new Date(NOW + 60_000 + DRAFT_REMINDER_DELAY_MS));
    expect(second.content.body).toContain('1 step');
    expect(mockCapture).toHaveBeenCalledTimes(1);
  });

  it('never re-arms a draft whose reminder has already gone out', async () => {
    await scheduleDraftReminder(user, draft(), NOW);
    await scheduleDraftReminder(user, draft(), NOW + DRAFT_REMINDER_DELAY_MS + 1);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('starts over for the next draft once the last one is cleared', async () => {
    await scheduleDraftReminder(user, draft(), NOW);
    await cancelDraftReminder(user);
    await scheduleDraftReminder(user, draft(), NOW + DRAFT_REMINDER_DELAY_MS + 1);

    expect(mockNotifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith(
      draftReminderIdentifier(user)
    );
    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(2);
    expect(mockCapture).toHaveBeenCalledTimes(2);
  });

  it('does nothing without notification permission, and never prompts', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValue({ granted: false, status: 'denied' });
    await scheduleDraftReminder(user, draft(), NOW);

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('respects Marketplace push being turned off', async () => {
    mockPrefs = { 'marketplace:push': false };
    await scheduleDraftReminder(user, draft(), NOW);

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('does nothing on web', async () => {
    mockPlatform.OS = 'web';
    await scheduleDraftReminder(user, draft(), NOW);

    expect(mockNotifications.getPermissionsAsync).not.toHaveBeenCalled();
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it('cannot re-arm a draft that was published while it was scheduling', async () => {
    let releasePermission: (v: unknown) => void = () => {};
    mockNotifications.getPermissionsAsync.mockReturnValue(
      new Promise((resolve) => {
        releasePermission = resolve;
      })
    );

    const scheduling = scheduleDraftReminder(user, draft(), NOW);
    await cancelDraftReminder(user);
    releasePermission({ granted: true });
    await scheduling;

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(mockCapture).not.toHaveBeenCalled();
  });
});

describe('scheduleDraftReminderSoon', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('schedules once per typing burst, with the last draft', async () => {
    scheduleDraftReminderSoon(user, draft({ title: 'W' }));
    scheduleDraftReminderSoon(user, draft({ title: 'Wa' }));
    scheduleDraftReminderSoon(user, draft({ title: 'Walk' }));
    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(DRAFT_REMINDER_DEBOUNCE_MS);

    expect(mockNotifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    const req = (mockNotifications.scheduleNotificationAsync.mock.calls[0] as any[])[0];
    expect(req.content.body).toContain('"Walk"');
  });

  it('is dropped by a cancel before it fires', async () => {
    scheduleDraftReminderSoon(user, draft());
    await cancelDraftReminder(user);
    await jest.advanceTimersByTimeAsync(DRAFT_REMINDER_DEBOUNCE_MS);

    expect(mockNotifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});
