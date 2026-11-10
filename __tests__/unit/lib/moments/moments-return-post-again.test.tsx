/**
 * MomentsProvider side of "Post again" on the return moment: a returning
 * poster's inactive_user_return is queued with her latest bounty, and tapping
 * "Post again" runs startPostAgain with source 'moment_return'. A hunter's is
 * queued exactly as before and opens the feed.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

let mockProfile: Record<string, unknown> = {};
jest.mock('../../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
}));
jest.mock('../../../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({ profile: mockProfile }),
}));

const mockFetchLatest = jest.fn();
jest.mock('../../../../hooks/useLatestPostedBounty', () => ({
  fetchLatestPostedBounty: (...args: unknown[]) => mockFetchLatest(...args),
}));

const mockStartPostAgain = jest.fn((_options: unknown) => Promise.resolve('opened'));
jest.mock('../../../../lib/post-again/start-post-again', () => ({
  startPostAgain: (options: unknown) => mockStartPostAgain(options),
}));

jest.mock('../../../../lib/moments/eligibilityFixFlag', () => ({
  useMomentsEligibilityFixEnabled: () => true,
}));
jest.mock('../../../../lib/moments/backfill', () => ({
  backfillEventMoments: jest.fn(() => Promise.resolve()),
}));

let mockStates = new Map();
jest.mock('../../../../lib/moments/momentsService', () => ({
  momentsService: {
    fetchStates: jest.fn(() => Promise.resolve(new Map(mockStates))),
    markShown: jest.fn(() => Promise.resolve(true)),
    markDismissed: jest.fn(() => Promise.resolve(true)),
    markCompleted: jest.fn(() => Promise.resolve()),
    markExpired: jest.fn(() => Promise.resolve()),
    markSnoozed: jest.fn(() => Promise.resolve()),
    markStarted: jest.fn(() => Promise.resolve()),
    enqueue: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('../../../../lib/moments/referral-service', () => ({
  referralService: { isReferralAvailable: () => false, shareInvite: jest.fn() },
}));
jest.mock('../../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('../../../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve({ status: 'granted' })),
    requestPermission: jest.fn(() => Promise.resolve({ granted: true })),
  },
}));
jest.mock('../../../../lib/services/notification-service', () => ({
  notificationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve('granted')),
    requestPermissionsAndRegisterToken: jest.fn(() => Promise.resolve('token')),
  },
}));

let mockBountyCount = 1;
jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn((table: string) => ({
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
      select: jest.fn(() => ({
        eq: jest.fn(() =>
          Promise.resolve({ count: table === 'bounties' ? mockBountyCount : 0, error: null })
        ),
      })),
    })),
  },
}));

import { MomentsProvider, useMoments } from '../../../../providers/moments-provider';
import { momentsService } from '../../../../lib/moments/momentsService';
import { resetSessionRecordsForTests } from '../../../../lib/moments/sessionTracking';

const DAY_MS = 24 * 60 * 60 * 1000;
const storage = new Map<string, string>();
let latest: ReturnType<typeof useMoments> | null = null;

function Probe() {
  latest = useMoments();
  return null;
}

function returnRow(metadata: Record<string, unknown>) {
  return {
    momentType: 'inactive_user_return',
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata,
  };
}

function enqueueCalls() {
  return (momentsService.enqueue as jest.Mock).mock.calls.filter(
    ([, type]) => type === 'inactive_user_return'
  );
}

async function acceptActive() {
  const realNow = Date.now();
  const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 5_000);
  await act(async () => {
    await latest!.accept();
  });
  spy.mockRestore();
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  resetSessionRecordsForTests();
  latest = null;
  mockBountyCount = 1;
  mockStates = new Map();
  mockFetchLatest.mockResolvedValue({ id: 'b-1', title: 'Haul away yard trash' });
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(storage.get(k) ?? null)
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    storage.set(k, v);
    return Promise.resolve();
  });
  storage.set('@bounty_moments_session_count:user-1', '6');
  mockProfile = {
    created_at: new Date(Date.now() - 90 * DAY_MS).toISOString(),
    avatar: 'a.png',
    about: 'bio',
    location: 'Austin, TX',
    skills: [],
    id_verification_status: 'verified',
    stripe_connect_charges_enabled: true,
    stripe_connect_payouts_enabled: true,
    primary_role: 'poster',
    balance: 0,
    last_session_at: new Date(Date.now() - 30 * DAY_MS).toISOString(),
  };
});

function renderShell() {
  return render(
    <MomentsProvider activeScreen="bounty">
      <Probe />
    </MomentsProvider>
  );
}

describe('a returning poster with a past bounty', () => {
  it('is queued a "Welcome back" that carries her latest bounty', async () => {
    renderShell();
    await waitFor(() => expect(enqueueCalls()).toHaveLength(1));
    expect(mockFetchLatest).toHaveBeenCalledWith('user-1');
    expect(enqueueCalls()[0][2]).toEqual({
      daysSinceLastSession: 30,
      postAgainBountyId: 'b-1',
      postAgainTitle: 'Haul away yard trash',
    });
  });

  it('falls back to the general welcome when the lookup fails', async () => {
    mockFetchLatest.mockRejectedValue(new Error('offline'));
    renderShell();
    await waitFor(() => expect(enqueueCalls()).toHaveLength(1));
    expect(enqueueCalls()[0][2]).toEqual({ daysSinceLastSession: 30 });
  });

  it('taps "Post again" into the composer with that bounty', async () => {
    mockStates = new Map([
      [
        'inactive_user_return',
        returnRow({ postAgainBountyId: 'b-1', postAgainTitle: 'Haul away yard trash' }),
      ],
    ]);
    renderShell();
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('inactive_user_return'));
    expect(latest?.activeContent?.primaryLabel).toBe('Post again');

    await acceptActive();
    expect(mockStartPostAgain).toHaveBeenCalledWith({
      bountyId: 'b-1',
      userId: 'user-1',
      source: 'moment_return',
    });
    expect(mockPush).not.toHaveBeenCalled();
    expect(momentsService.markStarted).toHaveBeenCalledWith('user-1', 'inactive_user_return');
  });
});

describe('hunters', () => {
  beforeEach(() => {
    mockProfile = { ...mockProfile, primary_role: 'hunter' };
  });

  it('are queued the same "Welcome back" as before, with no bounty lookup', async () => {
    renderShell();
    await waitFor(() => expect(enqueueCalls()).toHaveLength(1));
    expect(enqueueCalls()[0][2]).toEqual({ daysSinceLastSession: 30 });
    expect(mockFetchLatest).not.toHaveBeenCalled();
  });

  it('still open the feed from it, even if the row names a bounty', async () => {
    mockStates = new Map([['inactive_user_return', returnRow({ postAgainBountyId: 'b-1' })]]);
    renderShell();
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('inactive_user_return'));
    expect(latest?.activeContent?.primaryLabel).toBe('See what’s new');
    await acceptActive();
    expect(mockPush).toHaveBeenCalledWith('/tabs/bounty-app');
    expect(mockStartPostAgain).not.toHaveBeenCalled();
  });
});
