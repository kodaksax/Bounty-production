/**
 * Regression test for the "Setup Payouts" modal reappearing on nearly every
 * button press within a session.
 *
 * Root cause: providers/moments-provider.tsx's dismiss/snooze/accept
 * handlers wrote the new status to Supabase but never updated the local
 * in-memory `states` map that eligibility is (re)computed from. That map
 * only ever changed on the next refresh() (mount or app-foreground) — so a
 * dismissal mid-session wasn't reflected yet, and the "compute next moment"
 * effect (which reruns on every buildContext change, e.g. every bottom-nav
 * tap) would immediately re-pick the just-dismissed moment. Fixed by
 * patching `states` locally alongside every momentsService write.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

// Extend the existing react-native mock (from jest.setup.js) with AppState
// rather than replacing the entire module — replacing it would drop View,
// Text, StyleSheet, etc. that @testing-library/react-native relies on. See
// __tests__/unit/hooks/useForegroundRefresh.test.ts for the same pattern.
beforeAll(() => {
  const rn = require('react-native') as any;
  if (!rn.AppState) {
    rn.AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) };
  }
});

// A fully-resolved profile on every OTHER moment so stripe_connect_onboarding
// is the only one left eligible: avatar/bio/location present, notifications/
// location permissions granted, identity already verified.
const mockProfile = {
  created_at: new Date().toISOString(),
  avatar: 'https://example.com/a.png',
  about: 'bio',
  location: 'NYC',
  skills: ['plumbing'],
  id_verification_status: 'verified',
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  primary_role: 'hunter',
  balance: 0,
  last_session_at: new Date().toISOString(),
};

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

jest.mock('../../../../lib/moments/sessionTracking', () => ({
  evaluateReturningUser: () => ({ isReturning: false, daysSinceLastSession: null }),
  getSessionCount: jest.fn(() => Promise.resolve(1)),
  incrementSessionCount: jest.fn(() => Promise.resolve(1)),
  shouldRecordSession: () => false,
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

jest.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(() => ({
      update: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ error: null })),
      })),
      // Backs fetchHasEngaged's two head-count queries (bounties/
      // bounty_requests) — mocked as "never engaged" by default so it
      // doesn't interfere with the first-session-suppression gate.
      select: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ count: 0, error: null })),
      })),
    })),
  },
}));

import { MomentsProvider, useMoments } from '../../../../providers/moments-provider';
import { analyticsService } from '../../../../lib/services/analytics-service';

let latest: ReturnType<typeof useMoments> | null = null;

function Capture() {
  latest = useMoments();
  return null;
}

function Root({ activeScreen }: { activeScreen: string }) {
  return (
    <MomentsProvider activeScreen={activeScreen}>
      <Capture />
    </MomentsProvider>
  );
}

describe('MomentsProvider — dismiss does not reopen on subsequent re-renders', () => {
  beforeEach(() => {
    latest = null;
  });

  it('keeps a dismissed moment closed across activeScreen changes (bottom-nav taps) within the same session', async () => {
    const { rerender } = render(<Root activeScreen="wallet" />);

    await waitFor(() => expect(latest?.activeMoment?.type).toBe('stripe_connect_onboarding'));

    await act(async () => {
      latest!.dismiss();
    });
    expect(latest?.activeMoment).toBeNull();

    // Simulate two bottom-nav taps (activeScreen changes) — the exact
    // trigger that used to resurrect the just-dismissed moment, since it
    // recreates MomentsProvider's buildContext and reruns eligibility
    // evaluation against what was, before the fix, a stale local snapshot.
    await act(async () => {
      rerender(<Root activeScreen="bounty" />);
    });
    expect(latest?.activeMoment).toBeNull();

    await act(async () => {
      rerender(<Root activeScreen="wallet" />);
    });
    expect(latest?.activeMoment).toBeNull();
  });

  it('does not immediately reopen after the user taps "Set up payouts" and backs out before finishing', async () => {
    const { rerender } = render(<Root activeScreen="wallet" />);

    await waitFor(() => expect(latest?.activeMoment?.type).toBe('stripe_connect_onboarding'));

    await act(async () => {
      await latest!.accept();
    });
    expect(latest?.activeMoment).toBeNull();

    // Simulate navigating back to the tab shell and tapping around —
    // without the accept-time snooze, 'shown' status has no cooldown (by
    // design, so the actively-displayed modal doesn't close itself) and
    // would reopen on the very next re-evaluation.
    await act(async () => {
      rerender(<Root activeScreen="bounty" />);
    });
    expect(latest?.activeMoment).toBeNull();

    await act(async () => {
      rerender(<Root activeScreen="wallet" />);
    });
    expect(latest?.activeMoment).toBeNull();
  });
});

// BNTY-09: enable_notifications was firing moment_shown ~7 times per user and
// complete_profile was flashing on/off within 300ms — traced to two gaps:
// (1) evaluateNextMoment could select a moment for one render before the
// separate, async auto-complete effect had a chance to mark it resolved, and
// (2) a duplicate MomentsProvider mount (e.g. a moment's own
// `router.push('/tabs/bounty-app')` stacking a second bounty-app screen on
// top of the one still mounted underneath) doubled every fetch/evaluate/
// present pass. These tests cover both fixes.
describe('MomentsProvider — a single activation presents at most once', () => {
  beforeEach(() => {
    latest = null;
    (analyticsService.trackEvent as jest.Mock).mockClear();
  });

  function shownEventsFor(momentType: string) {
    return (analyticsService.trackEvent as jest.Mock).mock.calls.filter(
      ([event, payload]) => event === 'moment_shown' && payload?.momentType === momentType
    );
  }

  it('emits moment_shown exactly once for a single activation, even as buildContext keeps recomputing', async () => {
    render(<Root activeScreen="wallet" />);

    await waitFor(() => expect(latest?.activeMoment?.type).toBe('stripe_connect_onboarding'));

    // Let any further passes (e.g. sessionCount resolving asynchronously,
    // which changes buildContext's identity) settle before asserting.
    await act(async () => {
      await Promise.resolve();
    });

    expect(shownEventsFor('stripe_connect_onboarding')).toHaveLength(1);
  });

  it('dedupes a duplicate provider mount so only one instance ever presents a moment', async () => {
    const first = render(<Root activeScreen="wallet" />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('stripe_connect_onboarding'));

    // Simulate the duplicate-mount bug: a second MomentsProvider mounts
    // (e.g. a second, stacked bounty-app screen instance) while the first
    // is still alive underneath.
    let second: ReturnType<typeof useMoments> | null = null;
    function CaptureSecond() {
      second = useMoments();
      return null;
    }
    const other = render(
      <MomentsProvider activeScreen="wallet">
        <CaptureSecond />
      </MomentsProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    // The demoted duplicate stays inert — it never becomes active on its own.
    expect(second?.activeMoment).toBeNull();
    expect(shownEventsFor('stripe_connect_onboarding')).toHaveLength(1);

    first.unmount();
    other.unmount();
  });
});
