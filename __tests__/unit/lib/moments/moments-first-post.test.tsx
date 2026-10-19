/**
 * SBA-06: nothing may interrupt a new poster's first Post tap, and "Later" on
 * a prompt the Post tap ran into carries on to the composer.
 *
 * Root cause covered here: MomentsProvider decided "new session?" from the
 * profile's last_session_at, but never re-read the profile after writing that
 * column. For a brand-new user it stayed null for the whole first sitting, so
 * every AppState 'active' (an OS permission dialog, the payment sheet, a quick
 * app switch) counted as another session. The second count unlocked the
 * ID-verification and permission prompts minutes after onboarding — on native
 * as well as web. Uses the real sessionTracking module over an in-memory
 * AsyncStorage so the count is what the app would actually persist.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

let mockProfile: Record<string, unknown> = {};

jest.mock('../../../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'user-1' } } }),
}));

jest.mock('../../../../hooks/useAuthProfile', () => ({
  useAuthProfile: () => ({ profile: mockProfile }),
}));

jest.mock('../../../../lib/moments/backfill', () => ({
  backfillEventMoments: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../../../lib/moments/momentsService', () => ({
  momentsService: {
    fetchStates: jest.fn(() => Promise.resolve(new Map())),
    markShown: jest.fn(() => Promise.resolve()),
    markDismissed: jest.fn(() => Promise.resolve()),
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

let mockLocationStatus = 'undetermined';
let mockNotificationStatus = 'undetermined';
jest.mock('../../../../lib/services/location-service', () => ({
  locationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve({ status: mockLocationStatus })),
    requestPermission: jest.fn(() => Promise.resolve({ granted: true })),
  },
}));

jest.mock('../../../../lib/services/notification-service', () => ({
  notificationService: {
    getPermissionStatus: jest.fn(() => Promise.resolve(mockNotificationStatus)),
    requestPermissionsAndRegisterToken: jest.fn(() => Promise.resolve('token')),
  },
}));

const mockProfileUpdates: string[] = [];
jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn((patch: { last_session_at?: string }) => {
        if (patch.last_session_at) mockProfileUpdates.push(patch.last_session_at);
        return { eq: jest.fn(() => Promise.resolve({ error: null })) };
      }),
      // fetchEngagement's head counts: never posted, never applied.
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));

import { MomentsProvider, useMoments } from '../../../../providers/moments-provider';
import { analyticsService } from '../../../../lib/services/analytics-service';
import {
  getSessionCount,
  resetSessionRecordsForTests,
} from '../../../../lib/moments/sessionTracking';

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

/** Every AppState listener the provider registered, fired with `state`. */
async function fireAppState(state: string) {
  const calls = (AppState.addEventListener as jest.Mock).mock.calls;
  await act(async () => {
    for (const [event, listener] of calls) {
      if (event === 'change') listener(state);
    }
    await Promise.resolve();
  });
}

const flush = () => act(async () => {
  await new Promise(resolve => setImmediate(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  storage.clear();
  mockProfileUpdates.length = 0;
  resetSessionRecordsForTests();
  latest = null;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((k: string) =>
    Promise.resolve(storage.get(k) ?? null)
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation((k: string, v: string) => {
    storage.set(k, v);
    return Promise.resolve();
  });
  mockLocationStatus = 'undetermined';
  mockNotificationStatus = 'undetermined';
  // A poster straight out of onboarding: no session recorded yet, nothing
  // verified, no permissions answered, no location saved.
  mockProfile = {
    created_at: new Date().toISOString(),
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
});

describe('a new poster’s first sitting', () => {
  it('counts one session however many times the app comes back to the foreground', async () => {
    render(
      <MomentsProvider activeScreen="bounty">
        <Probe />
      </MomentsProvider>
    );
    await flush();
    await waitFor(() => expect(mockProfileUpdates).toHaveLength(1));

    // An OS permission dialog, the payment sheet, an app switch: each one is
    // an 'active' transition with the profile still holding null.
    for (let i = 0; i < 3; i++) {
      await fireAppState('active');
      await flush();
    }

    expect(await getSessionCount('user-1')).toBe(1);
    expect(mockProfileUpdates).toHaveLength(1);
    expect(shownMoments()).toEqual([]);
    expect(latest?.activeMoment).toBeNull();
  });

  it('never offers ID verification before the first published bounty, even with strong reasons', async () => {
    // A later session, on the wallet screen, with a large balance — all three
    // of identity_verification's own triggers.
    storage.set('@bounty_moments_session_count:user-1', '4');
    mockProfile = { ...mockProfile, balance: 500, last_session_at: new Date().toISOString() };
    mockNotificationStatus = 'granted';
    mockLocationStatus = 'granted';
    mockProfile = { ...mockProfile, avatar: 'a.png', about: 'bio', location: 'Austin, TX' };

    render(
      <MomentsProvider activeScreen="wallet">
        <Probe />
      </MomentsProvider>
    );
    await flush();
    await flush();

    expect(shownMoments()).not.toContain('identity_verification');
  });
});

describe('"Later" on a prompt the Post tap ran into', () => {
  // A returning poster with notifications still unanswered, so
  // enable_notifications is the one eligible prompt.
  beforeEach(() => {
    storage.set('@bounty_moments_session_count:user-1', '3');
    mockProfile = {
      ...mockProfile,
      avatar: 'a.png',
      about: 'bio',
      location: 'Austin, TX',
      last_session_at: new Date().toISOString(),
    };
    mockLocationStatus = 'granted';
  });

  async function presentAndDismiss(activeScreen: string, targetScreen: string) {
    const onContinueTo = jest.fn();
    render(
      <MomentsProvider activeScreen={activeScreen} targetScreen={targetScreen} onContinueTo={onContinueTo}>
        <Probe />
      </MomentsProvider>
    );
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('enable_notifications'));
    // Past MIN_MOMENT_VISIBLE_MS, so the tap counts.
    const realNow = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 5_000);
    await act(async () => {
      latest!.dismiss();
    });
    spy.mockRestore();
    return onContinueTo;
  }

  it('continues into the composer when the prompt opened on the way to Post', async () => {
    const onContinueTo = await presentAndDismiss('bounty', 'postings');
    expect(onContinueTo).toHaveBeenCalledWith('postings');
  });

  it('leaves the user where they are when the prompt had nothing to do with Post', async () => {
    const onContinueTo = await presentAndDismiss('bounty', 'bounty');
    expect(onContinueTo).not.toHaveBeenCalled();
  });
});
