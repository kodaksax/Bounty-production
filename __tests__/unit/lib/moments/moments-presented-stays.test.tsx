/**
 * A presented moment stays on screen until the user answers it.
 *
 * With `moments-eligibility-fix` off, an event-triggered moment went ineligible
 * as soon as it was marked 'shown' and the next moment replaced it in the same
 * sheet, about 20ms later. The flag-off cases pin that behaviour so turning the
 * flag off really does restore today's app.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeAll(() => {
  const rn = require('react-native') as any;
  if (!rn.AppState) {
    rn.AppState = { currentState: 'active', addEventListener: jest.fn(() => ({ remove: jest.fn() })) };
  }
});

let mockFlagOn = false;
jest.mock('../../../../lib/moments/eligibilityFixFlag', () => ({
  useMomentsEligibilityFixEnabled: () => mockFlagOn,
}));

// Complete on every state-derived moment, so only what a test enqueues is left.
const mockProfile = {
  created_at: new Date().toISOString(),
  avatar: 'https://example.com/a.png',
  about: 'bio',
  location: 'NYC',
  skills: ['plumbing'],
  id_verification_status: 'verified',
  stripe_connect_charges_enabled: false,
  stripe_connect_payouts_enabled: false,
  primary_role: 'poster',
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

let mockStates = new Map<string, any>();
jest.mock('../../../../lib/moments/momentsService', () => ({
  momentsService: {
    fetchStates: jest.fn(() => Promise.resolve(mockStates)),
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
  effectiveLastSessionAt: (_userId: string, profileValue: string | null) => profileValue,
  noteSessionRecorded: jest.fn(),
  evaluateReturningUser: () => ({ isReturning: false, daysSinceLastSession: null }),
  getSessionCount: jest.fn(() => Promise.resolve(2)),
  incrementSessionCount: jest.fn(() => Promise.resolve(2)),
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
      update: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
      select: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ count: 0, error: null })) })),
    })),
  },
}));

import { momentsService } from '../../../../lib/moments/momentsService';
import { MomentsProvider, useMoments } from '../../../../providers/moments-provider';

let latest: ReturnType<typeof useMoments> | null = null;
// With the flag off a moment is gone before a test can reach it, so hold on to
// the button as it was while the moment was up.
let acceptPostFirstBounty: (() => Promise<void>) | null = null;
function Capture() {
  latest = useMoments();
  if (latest.activeMoment?.type === 'post_first_bounty') acceptPostFirstBounty = latest.accept;
  return null;
}

const mockOpenComposer = jest.fn();
function Root({ activeScreen = 'bounty' }: { activeScreen?: string }) {
  return (
    <MomentsProvider activeScreen={activeScreen} onOpenComposer={mockOpenComposer}>
      <Capture />
    </MomentsProvider>
  );
}

function row(momentType: string, overrides: Record<string, unknown> = {}) {
  return {
    momentType,
    status: 'pending',
    shownCount: 0,
    firstShownAt: null,
    lastShownAt: null,
    dismissedAt: null,
    completedAt: null,
    snoozedUntil: null,
    metadata: {},
    ...overrides,
  };
}

function queue(...rows: ReturnType<typeof row>[]) {
  mockStates = new Map(rows.map(r => [r.momentType, r]));
}

let dateNowSpy: jest.SpyInstance | null = null;
function elapse(ms: number) {
  const target = Date.now() + ms;
  if (dateNowSpy) dateNowSpy.mockImplementation(() => target);
  else dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => target);
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  latest = null;
  acceptPostFirstBounty = null;
  mockStates = new Map();
  jest.clearAllMocks();
});

afterEach(() => {
  dateNowSpy?.mockRestore();
  dateNowSpy = null;
});

describe('with moments-eligibility-fix on', () => {
  beforeEach(() => {
    mockFlagOn = true;
  });

  it('keeps a presented moment on screen, through tab changes, until the user dismisses it', async () => {
    queue(row('post_first_bounty'), row('fund_wallet'));
    const { rerender } = render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('post_first_bounty'));
    await settle();
    expect(latest?.activeMoment?.type).toBe('post_first_bounty');

    await act(async () => {
      rerender(<Root activeScreen="wallet" />);
    });
    await settle();
    expect(latest?.activeMoment?.type).toBe('post_first_bounty');
    expect(momentsService.markShown).toHaveBeenCalledTimes(1);

    elapse(1000);
    await act(async () => {
      latest!.dismiss();
    });
    await settle();
    expect(momentsService.markDismissed).toHaveBeenCalledTimes(1);
    // Only now may the next one come up.
    expect(latest?.activeMoment?.type).toBe('fund_wallet');
  });

  it('is not replaced by a higher-priority moment that arrives while it is up', async () => {
    queue(row('fund_wallet'));
    render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('fund_wallet'));

    // post_first_bounty (priority 5) outranks fund_wallet (priority 15).
    queue(row('fund_wallet', { status: 'shown', shownCount: 1 }), row('post_first_bounty'));
    await act(async () => {
      await latest!.refresh();
    });
    await settle();
    expect(latest?.activeMoment?.type).toBe('fund_wallet');
  });

  it('does not expire a moment on its last allowed show while it is on screen', async () => {
    queue(row('inactive_user_return'));
    render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('inactive_user_return'));
    await settle();

    expect(latest?.activeMoment?.type).toBe('inactive_user_return');
    expect(momentsService.markExpired).not.toHaveBeenCalled();
  });

  it('asks again next session when a moment was presented and never answered', async () => {
    queue(row('post_first_bounty', { status: 'shown', shownCount: 1 }));
    render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('post_first_bounty'));
  });

  it('expires a moment that used its last show in an earlier session and was never answered', async () => {
    queue(row('inactive_user_return', { status: 'shown', shownCount: 1 }));
    render(<Root />);
    await waitFor(() => expect(momentsService.markExpired).toHaveBeenCalledTimes(1));
    expect(latest?.activeMoment).toBeNull();
  });

  it('closes once snoozed', async () => {
    queue(row('post_first_bounty'));
    render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('post_first_bounty'));
    await settle();

    await act(async () => {
      latest!.snooze(24);
    });
    await settle();
    expect(latest?.activeMoment).toBeNull();
  });

  it('opens the composer attributed to the moment instead of the legacy screen', async () => {
    queue(row('post_first_bounty'));
    render(<Root />);
    await waitFor(() => expect(latest?.activeMoment?.type).toBe('post_first_bounty'));
    await settle();

    elapse(1000);
    await act(async () => {
      await latest!.accept();
    });

    expect(mockOpenComposer).toHaveBeenCalledWith('moment_post_first_bounty');
    expect(mockPush).not.toHaveBeenCalled();
    expect(momentsService.markStarted).toHaveBeenCalledWith('user-1', 'post_first_bounty');
    expect(latest?.activeMoment).toBeNull();
  });
});

describe('with moments-eligibility-fix off', () => {
  beforeEach(() => {
    mockFlagOn = false;
  });

  it('runs through every queued moment without waiting for an answer', async () => {
    queue(row('post_first_bounty'), row('fund_wallet'));
    render(<Root />);
    await waitFor(() => expect(momentsService.markShown).toHaveBeenCalledTimes(2));
    await settle();

    expect(momentsService.markShown).toHaveBeenNthCalledWith(1, 'user-1', 'post_first_bounty');
    expect(momentsService.markShown).toHaveBeenNthCalledWith(2, 'user-1', 'fund_wallet');
    expect(momentsService.markDismissed).not.toHaveBeenCalled();
    expect(latest?.activeMoment).toBeNull();
  });

  it('expires a moment on its last allowed show', async () => {
    queue(row('inactive_user_return'));
    render(<Root />);
    await waitFor(() => expect(momentsService.markExpired).toHaveBeenCalledTimes(1));
  });

  it('does not ask again next session', async () => {
    queue(row('post_first_bounty', { status: 'shown', shownCount: 1 }));
    render(<Root />);
    await settle();
    await settle();
    expect(latest?.activeMoment).toBeNull();
  });

  it('keeps the legacy route for the post_first_bounty button', async () => {
    queue(row('post_first_bounty'));
    render(<Root />);
    await waitFor(() => expect(acceptPostFirstBounty).not.toBeNull());
    await settle();

    elapse(1000);
    await act(async () => {
      await acceptPostFirstBounty!();
    });

    expect(mockPush).toHaveBeenCalledWith('/tabs/postings-screen?deliberateTap=1');
    expect(mockOpenComposer).not.toHaveBeenCalled();
  });
});
