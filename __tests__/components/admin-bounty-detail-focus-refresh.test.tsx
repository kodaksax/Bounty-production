/**
 * The admin bounty screen stays mounted in the admin Stack while an admin
 * settles escrow on another screen. Returning to it has to re-read the financial
 * summary, or the cached escrowHoldReason keeps guarded actions disabled after
 * the server would allow them (PR #959 review).
 */
import { act, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockFetchBounty = jest.fn();
const mockFetchRelations = jest.fn();
const mockFetchDetail = jest.fn();
let mockFocus: () => void = () => undefined;

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => ({ id: 'bounty-1' }),
    // Like the real hook: runs when the screen gains focus, which includes mount.
    useFocusEffect: (cb: () => void) => {
      mockFocus = cb;
      useEffect(() => cb(), [cb]);
    },
  };
});
jest.mock('../../hooks/use-app-theme', () => ({ useAppTheme: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {}, isSupabaseConfigured: true }));
jest.mock('../../components/admin/AdminHeader', () => ({ AdminHeader: () => null }));
jest.mock('../../components/admin/AdminStatusBadge', () => ({ AdminStatusBadge: () => null }));
jest.mock('../../components/admin/AdminAttachmentGallery', () => ({
  AdminAttachmentGallery: () => null,
}));
jest.mock('../../lib/admin/adminDataClient', () => ({
  AdminModerationError: class AdminModerationError extends Error {},
  adminDataClient: {
    fetchAdminBountyById: (...a: unknown[]) => mockFetchBounty(...a),
    fetchBountyRelations: (...a: unknown[]) => mockFetchRelations(...a),
  },
}));
jest.mock('../../lib/admin/commandCenterClient', () => ({
  ...jest.requireActual('../../lib/admin/commandCenterClient'),
  commandCenterClient: { fetchBountyDetail: (...a: unknown[]) => mockFetchDetail(...a) },
}));

import AdminBountyDetailScreen from '../../app/admin/bounty/[id]/index';

const HELD_COPY = /Money is still held/;
const LOADING_COPY = 'Loading bounty…';

const BOUNTY = {
  id: 'bounty-1',
  title: 'Fix a fence',
  status: 'in_progress',
  amount: 50,
  user_id: 'poster-1',
  createdAt: '2026-10-01T00:00:00.000Z',
};
const RELATIONS = {
  requestCount: 1,
  pendingRequestCount: 0,
  transactionCount: 1,
  completionSubmissionCount: 0,
  disputeCount: 1,
};

function detail(escrowHoldReason: string | null) {
  return {
    financial: {
      financialStatus: escrowHoldReason ? 'escrow_held' : 'refunded',
      escrowHoldReason,
      escrowAmount: 50,
      releaseAmount: 0,
      refundAmount: escrowHoldReason ? 0 : 50,
      stripeConfirmed: true,
    },
  };
}

async function renderHeldScreen() {
  const screen = render(<AdminBountyDetailScreen />);
  await waitFor(() => expect(screen.getByText(HELD_COPY)).toBeTruthy());
  return screen;
}

describe('AdminBountyDetailScreen focus refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchBounty.mockResolvedValue(BOUNTY);
    mockFetchRelations.mockResolvedValue(RELATIONS);
    mockFetchDetail.mockResolvedValue(detail('wallet_escrow'));
  });

  it('loads once on mount, not once per effect', async () => {
    await renderHeldScreen();
    expect(mockFetchBounty).toHaveBeenCalledTimes(1);
    expect(mockFetchDetail).toHaveBeenCalledTimes(1);
  });

  it('unlocks guarded actions when the hold was settled while away', async () => {
    const screen = await renderHeldScreen();

    mockFetchDetail.mockResolvedValue(detail(null));
    await act(async () => mockFocus());

    await waitFor(() => expect(screen.queryByText(HELD_COPY)).toBeNull());
    expect(mockFetchDetail).toHaveBeenCalledTimes(2);
  });

  it('keeps the record on screen during the refresh', async () => {
    const screen = await renderHeldScreen();

    let finish: (value: typeof BOUNTY) => void = () => undefined;
    mockFetchBounty.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await act(async () => mockFocus());

    expect(screen.queryByText(LOADING_COPY)).toBeNull();
    expect(screen.getByText(HELD_COPY)).toBeTruthy();

    await act(async () => finish(BOUNTY));
  });

  it('keeps the screen and the hold when the refresh fails', async () => {
    const screen = await renderHeldScreen();

    mockFetchBounty.mockRejectedValueOnce(new Error('network down'));
    await act(async () => mockFocus());
    expect(screen.getByText(HELD_COPY)).toBeTruthy();

    mockFetchDetail.mockRejectedValueOnce(new Error('rpc down'));
    await act(async () => mockFocus());
    expect(screen.getByText(HELD_COPY)).toBeTruthy();
  });

  it('ignores a slow response from an earlier focus', async () => {
    const screen = await renderHeldScreen();

    let finishEarlier: (value: unknown) => void = () => undefined;
    mockFetchBounty.mockImplementationOnce(() => Promise.resolve(BOUNTY));
    mockFetchDetail.mockImplementationOnce(
      () => new Promise((resolve) => (finishEarlier = resolve))
    );
    await act(async () => mockFocus());

    mockFetchDetail.mockResolvedValueOnce(detail(null));
    await act(async () => mockFocus());
    await waitFor(() => expect(screen.queryByText(HELD_COPY)).toBeNull());

    await act(async () => finishEarlier(detail('wallet_escrow')));
    expect(screen.queryByText(HELD_COPY)).toBeNull();
  });
});
