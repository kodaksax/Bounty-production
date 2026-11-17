/**
 * Second-pass senior audit (2026-11-16): hiring from the chat.
 *
 * On 14 Nov a persona hired from this screen, watched a spinner and quit,
 * unsure whether she had hired anyone (the hire had saved). The chat now
 * shows "You've chosen …" — but only when useAcceptRequest reports a
 * server-confirmed acceptance. And the poster's red "Raise dispute" chip is
 * a neutral "Get help" that opens the same help sheet as the job page.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockThread: any;
const mockHandleAccept = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1', role: 'poster', with: 'h1' }),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../hooks/useBountyThread', () => ({ useBountyThread: () => mockThread }));
jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'poster-1' }));
jest.mock('../../hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: null }) }));
jest.mock('../../hooks/useAcceptFunding', () => ({
  useAcceptFunding: () => ({ gate: { active: false }, ensureFunded: jest.fn(), handleAcceptFailure: jest.fn() }),
}));
jest.mock('../../hooks/useAcceptRequest', () => ({
  useAcceptRequest: () => ({ handleAcceptRequest: (...a: unknown[]) => mockHandleAccept(...a) }),
}));
jest.mock('../../hooks/useRejectRequest', () => ({ useRejectRequest: () => ({ handleRejectRequest: jest.fn() }) }));
jest.mock('../../hooks/useApplicationDecisionVisit', () => ({
  useApplicationDecisionVisit: () => ({ markEngaged: jest.fn() }),
}));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refreshFromApi: jest.fn() }) }));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/services/application-withdrawal', () => ({
  discardApplication: jest.fn(),
  withdrawApplication: jest.fn(),
}));
jest.mock('../../lib/services/bounty-request-service', () => ({ bountyRequestService: { getAll: jest.fn() } }));
jest.mock('../../lib/services/supabase-messaging', () => ({
  getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv-1' }),
}));
jest.mock('../../lib/utils/hunter-hidden-bounties', () => ({ hideBountyForHunter: jest.fn() }));
jest.mock('../../lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/accept-funding-gate', () => ({ AcceptFundingGate: () => null }));
// The offer card: a Hire button that calls the screen's card action.
jest.mock('../../components/bounty-inbox/interactive-message-card', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    InteractiveMessageCard: ({ event, onAction }: any) => (
      <TouchableOpacity accessibilityLabel="Hire" onPress={() => onAction('accept_or_decline', event, 'accept')}>
        <Text>Hire</Text>
      </TouchableOpacity>
    ),
  };
});
jest.mock('../../components/bounty-inbox/submit-work-sheet', () => ({ SubmitWorkSheet: () => null }));
jest.mock('../../components/poster-review-modal', () => ({ PosterReviewModal: () => null }));
jest.mock('../../components/workflow-dispute-modal', () => ({ WorkflowDisputeModal: () => null }));
jest.mock('../../components/ui/screen-loader', () => ({ ScreenLoader: () => null }));
jest.mock('../../app/tabs/chat-detail-screen', () => ({
  ChatDetailScreen: ({ topBanner, timelineItems }: any) => (
    <>
      {topBanner}
      {timelineItems.map((i: any) => (
        <React.Fragment key={i.id}>{i.render()}</React.Fragment>
      ))}
    </>
  ),
}));

import BountyThreadRoute from '../../app/tabs/bounty-thread/[bountyId]';

function thread() {
  return {
    bounty: { id: 'b1', status: 'open', title: 'Clear the garage', amount: 60, poster_id: 'poster-1', accepted_by: null },
    request: { id: 'r1', bounty_id: 'b1', hunter_id: 'h1', status: 'pending' },
    submission: null,
    counterpart: { id: 'h1', name: 'Ana', avatar: null },
    pendingOfferCount: 1,
    events: [{ id: 'e1', at: new Date().toISOString(), yourTurn: true }],
    hasActiveDispute: false,
    dispute: null,
    cancellation: null,
    conversation: null,
    setConversation: jest.fn(),
    loading: false,
    error: null,
    refresh: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockThread = thread();
});

describe('hiring from the chat', () => {
  it('shows "You\'ve chosen Ana" after a server-confirmed hire', async () => {
    mockHandleAccept.mockResolvedValue({ accepted: true, bountyId: 'b1', hunterId: 'h1', hunterName: 'Ana', conversationId: null });
    render(<BountyThreadRoute />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Hire'));
    });
    expect(mockHandleAccept).toHaveBeenCalledWith('r1');
    expect(screen.getByText("You've chosen Ana")).toBeTruthy();
    expect(screen.getByLabelText('Back to the chat')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Back to the chat'));
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();
  });

  it('shows nothing like a hire when the poster backed out of the pay sheet', async () => {
    mockHandleAccept.mockResolvedValue({ accepted: false, reason: 'declined_payment' });
    render(<BountyThreadRoute />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Hire'));
    });
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();
  });

  it('a hook that returns nothing never crashes or confirms', async () => {
    mockHandleAccept.mockResolvedValue(undefined);
    render(<BountyThreadRoute />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Hire'));
    });
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();
  });
});

describe("the poster's chat tools", () => {
  it('has "Get help" instead of a red "Raise dispute" before anyone is hired', () => {
    render(<BountyThreadRoute />);
    expect(screen.getByLabelText('Get help')).toBeTruthy();
    expect(screen.queryByLabelText('Raise dispute')).toBeNull();
    expect(screen.getByLabelText('Job details')).toBeTruthy();
    expect(screen.queryByText('Manage bounty')).toBeNull();
  });

  it('"Get help" opens the help sheet; "I don\'t need this" goes to the job page, which owns taking it down', () => {
    render(<BountyThreadRoute />);
    fireEvent.press(screen.getByLabelText('Get help'));
    expect(screen.getByTestId('get-help-sheet')).toBeTruthy();
    fireEvent.press(screen.getByTestId('get-help-cancel_open'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: 'b1' } });
  });

  it('while the job is open the sheet makes no money claim (the chat has no charge read)', () => {
    render(<BountyThreadRoute />);
    fireEvent.press(screen.getByLabelText('Get help'));
    expect(screen.queryByTestId('get-help-money')).toBeNull();
  });
});
