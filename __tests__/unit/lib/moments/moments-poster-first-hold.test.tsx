/**
 * Poster-first moments through MomentsProvider:
 *  - a new poster's first session shows nothing but the posting moment;
 *  - the composer's publish signal releases the held moments straight away and
 *    the notification ask follows;
 *  - an unpublished poster coming back isn't queued a "Welcome back";
 *  - the poster role is recovered from the auth service when the in-memory
 *    profile has lost it, and a hunter's isn't.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

let mockProfile: Record<string, unknown> = {};
let mockStoredRole: string | null = null;

jest.mock('../../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('../../../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({ profile: mockProfile }),
}));

jest.mock('../../../../lib/services/auth-profile-service', () => ({
  authProfileService: { getPrimaryRoleForAnalytics: () => mockStoredRole },
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
    getPermissionStatus: jest.fn(() => Promise.resolve({ status: 'undetermined' })),
    requestPermission: jest.fn(() => Promise.resolve({ granted: true })),
  },
}));

jest.mock('../../../../lib/services/notification-service', () => ({
  notificationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve('undetermined')),
    requestPermissionsAndRegisterToken: jest.fn(() => Promise.resolve('token')),
  },
}));

let mockBountyCount = 0;
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
import { analyticsService } from '../../../../lib/services/analytics-service';
import { momentsService } from '../../../../lib/moments/momentsService';
import {
  notifyBountyPublished,
  resetPublishSignalForTests,
} from '../../../../lib/moments/publishSignal';
import { resetSessionRecordsForTests } from '../../../../lib/moments/sessionTracking';

const storage = new Map<string, string>();
let latest: ReturnType<typeof useMoments> | null = null;

function Probe() {
  latest = useMoments();
  return null;
}

function shownMoments(): string[] {
  return (analyticsService.trackEvent as jest.Mock).mock.calls
    .filter(([name]) => name === 'moment_shown')
    .map(([, props]) => props.momentType);
}

function enqueued(): string[] {
  return (momentsService.enqueue as jest.Mock).mock.calls.map(([, type]) => type);
}

const flush = () =>
  act(async () => {
    await new Promise(resolve => setImmediate(resolve));
  });

function pending(type: string) {
  return {
    momentType: type,
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata: {},
  };
}

function renderOn(activeScreen: string) {
  return render(
    <MomentsProvider activeScreen={activeScreen}>
      <Probe />
    </MomentsProvider>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  resetSessionRecordsForTests();
  resetPublishSignalForTests();
  latest = null;
  mockStoredRole = null;
  mockBountyCount = 0;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(storage.get(k) ?? null)
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    storage.set(k, v);
    return Promise.resolve();
  });
  // The 14 Oct poster: just onboarded, no photo, no bio, unverified, money
  // already in the wallet, no permission answered. Every moment she was sent
  // through has a reason to show.
  mockProfile = {
    created_at: new Date(Date.now() - 2 * DAY_MS).toISOString(),
    avatar: null,
    about: null,
    location: null,
    skills: [],
    id_verification_status: 'unverified',
    stripe_connect_charges_enabled: false,
    stripe_connect_payouts_enabled: false,
    primary_role: 'poster',
    balance: 0,
    last_session_at: null,
  };
  // What the backfill and the composer would have queued for her.
  mockStates = new Map([
    ['post_first_bounty', pending('post_first_bounty')],
    ['fund_wallet', pending('fund_wallet')],
  ]);
});

describe("a new poster's first session", () => {
  it('shows nothing but the posting moment, however much else is waiting', async () => {
    renderOn('wallet');
    await flush();
    await flush();
    expect(shownMoments()).toEqual([]);
    expect(latest?.activeMoment).toBeNull();
  });

  it('on a later visit shows post_first_bounty and only that', async () => {
    storage.set('@bounty_moments_session_count:user-1', '4');
    mockProfile = { ...mockProfile, last_session_at: new Date().toISOString() };
    renderOn('bounty');
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('post_first_bounty'));
    expect(shownMoments()).toEqual(['post_first_bounty']);
  });

  it('holds a poster whose in-memory profile lost the role', async () => {
    // updateProfile drops primary_role from the cached profile.
    mockProfile = { ...mockProfile, primary_role: undefined, last_session_at: new Date().toISOString() };
    mockStoredRole = 'poster';
    storage.set('@bounty_moments_session_count:user-1', '4');
    mockStates = new Map([['fund_wallet', pending('fund_wallet')]]);
    renderOn('wallet');
    await flush();
    await flush();
    expect(shownMoments()).toEqual([]);
  });
});

describe('her first publish', () => {
  it('releases the held moments at once and asks about notifications first', async () => {
    renderOn('postings');
    await flush();
    await flush();
    expect(shownMoments()).toEqual([]);

    await act(async () => {
      notifyBountyPublished('user-1');
    });
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('enable_notifications'));
    expect(latest?.activeContent?.body).toContain('so you hear when someone applies');
    expect(shownMoments()).toEqual(['enable_notifications']);
  });

  it('stays released when a refresh runs before the bounty row is readable', async () => {
    renderOn('postings');
    await flush();
    await act(async () => {
      notifyBountyPublished('user-1');
    });
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('enable_notifications'));
    // An offline-queued publish: the head count still says zero.
    await act(async () => {
      await latest!.refresh();
    });
    expect(latest?.activeMoment?.type).toBe('enable_notifications');
  });

  it("ignores another user's publish", async () => {
    renderOn('postings');
    await flush();
    await act(async () => {
      notifyBountyPublished('someone-else');
    });
    await flush();
    expect(shownMoments()).toEqual([]);
  });
});

describe('a returning poster', () => {
  const longAgo = () => new Date(Date.now() - 30 * DAY_MS).toISOString();

  it('with no bounty is not queued a "Welcome back"', async () => {
    mockProfile = { ...mockProfile, last_session_at: longAgo() };
    renderOn('bounty');
    await flush();
    await flush();
    expect(enqueued()).not.toContain('inactive_user_return');
  });

  it('with a past bounty is', async () => {
    mockBountyCount = 1;
    mockProfile = { ...mockProfile, last_session_at: longAgo() };
    renderOn('bounty');
    await flush();
    await flush();
    expect(enqueued()).toContain('inactive_user_return');
  });
});

describe('hunters', () => {
  it('are queued a "Welcome back" as before', async () => {
    mockProfile = { ...mockProfile, primary_role: 'hunter', last_session_at: new Date(Date.now() - 30 * DAY_MS).toISOString() };
    renderOn('bounty');
    await flush();
    await flush();
    expect(enqueued()).toContain('inactive_user_return');
  });

  it('see their moments with no bounty published', async () => {
    mockProfile = { ...mockProfile, primary_role: 'hunter', last_session_at: new Date().toISOString() };
    storage.set('@bounty_moments_session_count:user-1', '4');
    mockStates = new Map();
    renderOn('bounty');
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('enable_notifications'));
    expect(latest?.activeContent?.title).toBe('Know the moment money is nearby');
  });

  it("aren't turned into a poster by a stored role when the profile lost theirs", async () => {
    // Only 'poster' is recovered from the auth service; a lost hunter role
    // stays "no role", exactly as before.
    mockProfile = { ...mockProfile, primary_role: undefined, last_session_at: new Date().toISOString() };
    mockStoredRole = 'hunter';
    storage.set('@bounty_moments_session_count:user-1', '4');
    mockStates = new Map();
    renderOn('bounty');
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('enable_notifications'));
  });
});
