/**
 * Senior-first poster audit (2026-11-14), fix 7: the chat banner for one
 * applicant hard-coded the bounty's offer count to 1. It now shows the
 * bounty's real pending-offer count from useBountyThread.
 */
import { render, screen } from '@testing-library/react-native';
import React from 'react';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockThread: any;

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1', role: 'poster', with: 'h1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../hooks/useBountyThread', () => ({ useBountyThread: () => mockThread }));
jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => 'poster-1' }));
jest.mock('../../hooks/use-auth-context', () => ({ useAuthContext: () => ({ session: null }) }));
jest.mock('../../hooks/useAcceptFunding', () => ({
  useAcceptFunding: () => ({ gate: { active: false }, ensureFunded: jest.fn(), handleAcceptFailure: jest.fn() }),
}));
jest.mock('../../hooks/useAcceptRequest', () => ({ useAcceptRequest: () => ({ handleAcceptRequest: jest.fn() }) }));
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
jest.mock('../../lib/services/supabase-messaging', () => ({}));
jest.mock('../../lib/utils/hunter-hidden-bounties', () => ({ hideBountyForHunter: jest.fn() }));
jest.mock('../../lib/toast', () => ({ showToast: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../components/accept-funding-gate', () => ({ AcceptFundingGate: () => null }));
jest.mock('../../components/bounty-inbox/interactive-message-card', () => ({ InteractiveMessageCard: () => null }));
jest.mock('../../components/bounty-inbox/submit-work-sheet', () => ({ SubmitWorkSheet: () => null }));
jest.mock('../../components/poster-review-modal', () => ({ PosterReviewModal: () => null }));
jest.mock('../../components/workflow-dispute-modal', () => ({ WorkflowDisputeModal: () => null }));
jest.mock('../../components/ui/screen-loader', () => ({ ScreenLoader: () => null }));
// The chat itself isn't under test; render only the banner it is handed.
jest.mock('../../app/tabs/chat-detail-screen', () => ({
  ChatDetailScreen: ({ topBanner }: { topBanner: React.ReactNode }) => <>{topBanner}</>,
}));

import BountyThreadRoute from '../../app/tabs/bounty-thread/[bountyId]';

function threadWith(pendingOfferCount: number | null, requestStatus = 'pending') {
  return {
    bounty: { id: 'b1', status: 'open', title: 'Clear the garage', amount: 60, poster_id: 'poster-1', accepted_by: null },
    request: { id: 'r1', bounty_id: 'b1', hunter_id: 'h1', status: requestStatus },
    submission: null,
    counterpart: { id: 'h1', name: 'Ana', avatar: null },
    pendingOfferCount,
    events: [],
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

describe('Bounty thread offer count', () => {
  it('shows the bounty\'s real count: three offers say three', () => {
    mockThread = threadWith(3);
    render(<BountyThreadRoute />);
    expect(screen.getByText('3 hunters applied')).toBeTruthy();
    expect(screen.queryByText('1 hunter applied')).toBeNull();
  });

  it('one offer says one', () => {
    mockThread = threadWith(1);
    render(<BountyThreadRoute />);
    expect(screen.getByText('1 hunter applied')).toBeTruthy();
  });

  it("after passing on this hunter, the others' offers still count", () => {
    mockThread = threadWith(2, 'rejected');
    render(<BountyThreadRoute />);
    expect(screen.getByText('2 hunters applied')).toBeTruthy();
  });

  it('if the count could not be read, the offer on screen still counts', () => {
    mockThread = threadWith(null);
    render(<BountyThreadRoute />);
    expect(screen.getByText('1 hunter applied')).toBeTruthy();
  });
});
