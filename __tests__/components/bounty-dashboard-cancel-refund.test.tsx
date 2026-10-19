/**
 * SBA-10 (4): the poster's bounty screen offers "Cancel and refund" next to
 * "Edit details" on an open bounty nobody has been hired for, confirms in the
 * app with the amount and where it goes, and runs the shared refund-then-delete
 * path (lib/services/bounty-cancel-refund.ts).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { resolveBountyLifecycle } from '../../lib/utils/bounty-lifecycle';
import { darkTheme } from '../../lib/themes/darkTheme';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockTheme: any = lightTheme;
let mockBounty: any;
let mockApplicationCount = 0;
const mockRefresh = jest.fn();
const mockPlan = jest.fn();
const mockCancel = jest.fn();
const mockMarkRemoved = jest.fn();
const mockRefundEscrow = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: mockBack, canGoBack: () => true }),
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('../../lib/themes/AppThemeContext', () => ({
  useAppThemeContext: () => ({ theme: mockTheme }),
}));
jest.mock('../../lib/context/BackgroundColorContext', () => ({
  useBackgroundColor: () => ({ pushColor: jest.fn(), popColor: jest.fn() }),
}));
jest.mock('../../hooks/use-auth-context', () => ({
  useAuthContext: () => ({ session: { user: { id: 'poster-1' } }, isLoading: false }),
}));
jest.mock('../../hooks/useBountyExactLocation', () => ({
  useBountyExactLocation: () => ({ exact: null }),
  formatExactAddress: () => null,
}));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refundEscrow: mockRefundEscrow }) }));
jest.mock('../../lib/utils/bounty-visibility', () => ({
  markBountyRemovedLocally: (...a: unknown[]) => mockMarkRemoved(...a),
}));
jest.mock('../../lib/services/bounty-cancel-refund', () => {
  const actual = jest.requireActual('../../lib/services/bounty-cancel-refund');
  return {
    ...actual,
    planCancelRefund: (...a: unknown[]) => mockPlan(...a),
    cancelAndRefundBounty: (...a: unknown[]) => mockCancel(...a),
  };
});
jest.mock('../../hooks/useBountyLifecycle', () => ({
  useBountyLifecycle: () => ({
    bounty: mockBounty,
    role: 'poster',
    state: resolveBountyLifecycle({
      bounty: mockBounty,
      role: 'poster',
      applicationCount: mockApplicationCount,
    }),
    otherParty: { id: null, name: null, avatar: null },
    applicationCount: mockApplicationCount,
    submission: null,
    isLoading: false,
    error: null,
    notFound: false,
    refresh: mockRefresh,
  }),
}));
jest.mock('../../lib/services/message-service', () => ({
  messageService: { getOrCreateConversation: jest.fn() },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));

import BountyDashboard from '../../app/postings/[bountyId]/index';

function openMoreActions() {
  fireEvent.press(screen.getByLabelText('More actions'));
}

/** The buttons of the most recent Alert.alert call. */
function lastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons: buttons ?? [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockTheme = lightTheme;
  mockApplicationCount = 0;
  mockBounty = {
    id: 'b1',
    title: 'Fix a fence',
    description: 'Two broken panels.',
    amount: 40,
    is_for_honor: false,
    status: 'open',
    accepted_by: null,
    poster_id: 'poster-1',
    created_at: new Date().toISOString(),
  };
  mockPlan.mockResolvedValue({ refundAmount: 40, destination: 'wallet' });
  mockCancel.mockResolvedValue({ refundAmount: 40, destination: 'wallet' });
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

describe('BountyDashboard — Cancel and refund', () => {
  it.each([
    ['light', lightTheme],
    ['dark', darkTheme],
  ])('sits next to Edit details on an open, unhired bounty (%s theme)', (_n, theme) => {
    mockTheme = theme;
    render(<BountyDashboard />);
    openMoreActions();
    expect(screen.getByLabelText('Edit details')).toBeTruthy();
    expect(screen.getByLabelText('Cancel and refund')).toBeTruthy();
  });

  it('is still offered once hunters have applied (editing is not)', () => {
    mockApplicationCount = 2;
    render(<BountyDashboard />);
    openMoreActions();
    expect(screen.getByLabelText('Cancel and refund')).toBeTruthy();
    expect(screen.queryByLabelText('Edit details')).toBeNull();
  });

  it('confirms in the app with the refund amount and destination, then cancels', async () => {
    render(<BountyDashboard />);
    openMoreActions();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cancel and refund'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const confirm = lastAlert();
    expect(confirm.title).toBe('Cancel and refund?');
    expect(confirm.message).toContain('$40 goes back to your Bounty balance.');
    expect(mockCancel).not.toHaveBeenCalled();

    const go = confirm.buttons.find((b: any) => b.style === 'destructive');
    expect(go.text).toBe('Cancel and refund');
    await act(async () => {
      go.onPress();
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalled());
    const [bountyArg, depsArg, planArg] = mockCancel.mock.calls[0];
    expect(bountyArg.id).toBe('b1');
    expect(depsArg.refundEscrow).toBe(mockRefundEscrow);
    expect(planArg).toEqual({ refundAmount: 40, destination: 'wallet' });
    expect(mockMarkRemoved).toHaveBeenCalledWith('b1');
    expect(lastAlert().title).toBe('Bounty cancelled');
    expect(lastAlert().message).toContain('$40 is on its way back to your Bounty balance');
  });

  it('"Keep it" does nothing', async () => {
    render(<BountyDashboard />);
    openMoreActions();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cancel and refund'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const keep = lastAlert().buttons.find((b: any) => b.style === 'cancel');
    expect(keep.text).toBe('Keep it');
    expect(keep.onPress).toBeUndefined();
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('a failed refund leaves the bounty live and says nothing was lost', async () => {
    const { BountyRefundFailedError } = jest.requireActual('../../lib/services/bounty-cancel-refund');
    mockCancel.mockRejectedValue(new BountyRefundFailedError(new Error('owner_refund_in_progress')));
    render(<BountyDashboard />);
    openMoreActions();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cancel and refund'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    await act(async () => {
      lastAlert().buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    await waitFor(() => expect(lastAlert().title).toBe('Refund failed'));
    expect(lastAlert().message).toContain('nothing was lost');
    expect(mockMarkRemoved).not.toHaveBeenCalled();
  });

  it('is not offered once a hunter is hired', () => {
    mockBounty = { ...mockBounty, status: 'in_progress', accepted_by: 'hunter-1' };
    render(<BountyDashboard />);
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();
    if (screen.queryByLabelText('More actions')) openMoreActions();
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();
  });

  it('says "Cancel bounty" with no refund promise for a for-honor bounty', async () => {
    mockBounty = { ...mockBounty, is_for_honor: true, amount: 0 };
    mockPlan.mockResolvedValue({ refundAmount: 0, destination: null });
    render(<BountyDashboard />);
    openMoreActions();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cancel bounty'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(lastAlert().message).toContain('no money is involved');
  });
});
