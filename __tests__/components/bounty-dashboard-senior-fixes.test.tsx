/**
 * Senior-first poster audit ("The Garage Test", 2026-11-14): the poster's job
 * page fixes.
 *
 *  1. "Contact support" opens the real support form with the job attached,
 *     not the Post-a-Bounty composer at /tabs/need-help-screen.
 *  2. The Payment card claims money is held only when the server says it is.
 *     An unhired pay-when-you-choose job says "You haven't paid anything yet",
 *     and the poster is never named as the one who gets paid.
 *  3. "Review & release payment" opens PosterReviewModal, with its own
 *     warning and slide-to-confirm, instead of review-and-verify's one-tap
 *     release. Nothing is released by opening it.
 *  6. "Leave a review" opens the rating step, not the payout receipt, and not
 *     twice for the same hunter. A rating_reminder (?openReview=true) does the same.
 *  8. "Cancel and refund" only when money was collected; otherwise "Take
 *     this job down". Both run the same cancel service.
 *
 * QA follow-ups (2026-11-15):
 *  A. If the funding read fails, getBountyFundingRequirement answers "already
 *     funded". On an at_accept job that is re-read and shown as unknown, never
 *     as paid. The take-down still acts on planCancelRefund's plan, unchanged.
 *  C. The Applications card says how paying works only when it's known.
 *  D. The take-down confirmation and result match "Take this job down".
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { resolveBountyLifecycle } from '../../lib/utils/bounty-lifecycle';
import { lightTheme } from '../../lib/themes/lightTheme';

let mockBounty: any;
let mockLifecycleArgs: Record<string, unknown> = {};
let mockOtherParty: { id: string | null; name: string | null; avatar: string | null };
let mockParams: Record<string, string> = { bountyId: 'b1' };
let mockApplicationCount = 0;
const mockFundingRequirement = jest.fn();
const mockPush = jest.fn();
const mockPlan = jest.fn();
const mockCancel = jest.fn();
const mockHasRated = jest.fn();
const mockApproveAndRelease = jest.fn();
const mockRefresh = jest.fn();

jest.mock('expo-image', () => ({ Image: () => null }));
// The latest focus callback, so a test can "come back" to the page.
let mockFocusCallback: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = require('react');
    useEffect(() => {
      mockFocusCallback = cb;
      cb();
    }, [cb]);
  },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
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
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ refundEscrow: jest.fn() }) }));
jest.mock('../../lib/utils/bounty-visibility', () => ({ markBountyRemovedLocally: jest.fn() }));
jest.mock('../../lib/services/bounty-cancel-refund', () => ({
  ...jest.requireActual('../../lib/services/bounty-cancel-refund'),
  planCancelRefund: (...a: unknown[]) => mockPlan(...a),
  cancelAndRefundBounty: (...a: unknown[]) => mockCancel(...a),
}));
jest.mock('../../lib/services/bounty-funding-service', () => ({
  getBountyFundingRequirement: (...a: unknown[]) => mockFundingRequirement(...a),
}));
jest.mock('../../lib/services/ratings', () => ({
  ratingsService: { hasRated: (...a: unknown[]) => mockHasRated(...a) },
}));
// The money-moving call. Nothing on this page may reach it directly.
jest.mock('../../lib/services/completion-approval', () => ({
  approveAndRelease: (...a: unknown[]) => mockApproveAndRelease(...a),
}));
jest.mock('../../hooks/useBountyLifecycle', () => ({
  useBountyLifecycle: () => ({
    bounty: mockBounty,
    role: 'poster',
    state: resolveBountyLifecycle({ bounty: mockBounty, role: 'poster', ...mockLifecycleArgs } as any),
    otherParty: mockOtherParty,
    applicationCount: mockApplicationCount,
    submission: null,
    hasDispute: !!mockLifecycleArgs.hasDispute,
    disputeId: mockLifecycleArgs.hasDispute ? 'd1' : null,
    hasCancellationRequest: false,
    cancellationRequestedByRole: null,
    isLoading: false,
    error: null,
    notFound: false,
    refresh: mockRefresh,
  }),
}));
jest.mock('../../lib/services/message-service', () => ({ messageService: { getOrCreateConversation: jest.fn() } }));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../components/edit-posting-modal', () => ({ EditPostingModal: () => null }));
// Stands in for the real modal (covered in poster-review-modal-start-on-rating
// .test.tsx); here only whether it opens, and how, matters.
jest.mock('../../components/poster-review-modal', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    PosterReviewModal: (p: any) =>
      p.visible ? (
        <>
          <Text testID="poster-review-modal">{`review:${p.bountyId}:${p.hunterId}:${p.startOnRating ? 'rating' : 'review'}`}</Text>
          <TouchableOpacity testID="poster-review-modal-close" onPress={p.onClose} />
        </>
      ) : null,
  };
});

// The offers section's hire hooks (pay sheet, accept, decline) have their
// own suites; here the page only needs its offers list and gate state.
jest.mock('../../hooks/usePosterJobOffers', () => ({
  usePosterJobOffers: () => ({
    offers: [],
    loadState: 'ready',
    reload: jest.fn(),
    gate: { active: false },
    choose: jest.fn().mockResolvedValue({ accepted: false, reason: 'declined_payment' }),
    pass: jest.fn(),
    ask: jest.fn(),
    askingRequestId: null,
    isAskBusy: false,
  }),
}));
jest.mock('../../lib/services/poster-job-activity', () => {
  const empty = { offers: null, hiredAt: null, lastHelperMessageAt: null, lastPosterMessageAt: null, messagesKnown: false };
  return { EMPTY_POSTER_JOB_ACTIVITY: empty, getPosterJobActivity: jest.fn().mockResolvedValue(empty) };
});
jest.mock('../../components/accept-funding-gate', () => ({ AcceptFundingGate: () => null }));

import BountyDashboard from '../../app/postings/[bountyId]/index';

const OPEN_AT_ACCEPT = {
  id: 'b1',
  title: 'Remove old furniture from my garage',
  description: 'Three chairs and a sofa.',
  amount: 60,
  is_for_honor: false,
  status: 'open',
  funding_mode: 'at_accept',
  accepted_by: null,
  poster_id: 'poster-1',
  created_at: new Date().toISOString(),
};

function lastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons: buttons ?? [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockParams = { bountyId: 'b1' };
  mockBounty = { ...OPEN_AT_ACCEPT };
  mockLifecycleArgs = {};
  mockOtherParty = { id: null, name: null, avatar: null };
  mockApplicationCount = 0;
  // A real server reply for this at_accept job: nothing funded.
  mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: false });
  mockPlan.mockResolvedValue({ refundAmount: 0, destination: null });
  mockCancel.mockResolvedValue({ refundAmount: 0, destination: null });
  mockHasRated.mockResolvedValue(false);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

describe('Fix 1: Contact support', () => {
  it('opens the real support form with the job id, not the job composer', () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'in_progress', accepted_by: 'hunter-1' };
    mockLifecycleArgs = { hasDispute: true };
    render(<BountyDashboard />);
    fireEvent.press(screen.getByTestId('poster-get-help'));
    fireEvent.press(screen.getByTestId('get-help-support'));
    expect(mockPush).toHaveBeenCalledTimes(1);
    const [target] = mockPush.mock.calls[0];
    expect(target).toEqual({
      pathname: '/support/contact',
      params: { bountyId: 'b1', bountyTitle: 'Remove old furniture from my garage' },
    });
    expect(JSON.stringify(mockPush.mock.calls)).not.toContain('need-help-screen');
  });

  it('"Have Bounty help me" opens the same form as a ready-written request', () => {
    render(<BountyDashboard />);
    fireEvent.press(screen.getByTestId('poster-get-help'));
    fireEvent.press(screen.getByTestId('get-help-assist'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/support/contact',
      params: { bountyId: 'b1', bountyTitle: 'Remove old furniture from my garage', topic: 'assist' },
    });
  });

  it('Get help is on the page in every state, without opening a menu', () => {
    for (const status of ['open', 'in_progress', 'completed']) {
      mockBounty = { ...OPEN_AT_ACCEPT, status, accepted_by: status === 'open' ? null : 'hunter-1' };
      const { unmount } = render(<BountyDashboard />);
      expect(screen.getByLabelText('Get help with this job')).toBeTruthy();
      unmount();
    }
  });
});

describe('Fix 2: Payment card', () => {
  it('an unhired pay-when-you-choose job says nothing has been paid, never "escrow"', async () => {
    render(<BountyDashboard />);
    expect(await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.")).toBeTruthy();
    expect(screen.getByText('Not charged yet')).toBeTruthy();
    expect(screen.queryByText(/escrow/i)).toBeNull();
    expect(screen.queryByText(/held/i)).toBeNull();
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ id: 'b1' }));
  });

  it('says it is checking, not "held", while the server read is in flight', () => {
    mockPlan.mockReturnValue(new Promise(() => {}));
    render(<BountyDashboard />);
    expect(screen.getByText('Checking your payment…')).toBeTruthy();
    expect(screen.queryByText(/escrow/i)).toBeNull();
    expect(screen.queryByText(/held/i)).toBeNull();
  });

  it('a failed read claims neither way', async () => {
    mockPlan.mockRejectedValue(new Error('offline'));
    render(<BountyDashboard />);
    expect(await screen.findByText(/couldn't check your payment/i)).toBeTruthy();
    expect(screen.queryByText(/held/i)).toBeNull();
    expect(screen.queryByText(/haven't paid anything/)).toBeNull();
  });

  it('a job that really was paid for keeps the truthful escrow line, naming no recipient', async () => {
    mockBounty = { ...OPEN_AT_ACCEPT, funding_mode: 'at_post' };
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
    // Even if the "other party" resolved to the poster themself, they are not named.
    mockOtherParty = { id: 'poster-1', name: 'poster_username', avatar: null };
    render(<BountyDashboard />);
    expect(await screen.findByText("You've already paid $60. Bounty holds it until you approve the finished work.")).toBeTruthy();
    expect(screen.getByText('Held by Bounty')).toBeTruthy();
    const { within } = require('@testing-library/react-native');
    expect(within(screen.getByTestId('bounty-payment-state')).queryByText(/poster_username/)).toBeNull();
  });

  it('a hired job says Bounty holds the money until approval, naming the person chosen', () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'in_progress', accepted_by: 'hunter-1' };
    mockOtherParty = { id: 'hunter-1', name: 'ana_hunts', avatar: null };
    render(<BountyDashboard />);
    expect(screen.getByText('Bounty is holding your $60. ana_hunts is paid only after you approve the work.')).toBeTruthy();
    expect(screen.queryByText(/escrow/i)).toBeNull();
    // Past the open stage the server read isn't needed.
    expect(mockPlan).not.toHaveBeenCalled();
  });

  it('a completed job says the money went to the hunter', () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'completed', accepted_by: 'hunter-1' };
    mockOtherParty = { id: 'hunter-1', name: 'ana_hunts', avatar: null };
    render(<BountyDashboard />);
    expect(screen.getByText('Released to ana_hunts')).toBeTruthy();
    expect(screen.getByText('Your $60 was released to ana_hunts.')).toBeTruthy();
  });
});

describe('Fix 3: completion review', () => {
  it('opens PosterReviewModal (its own confirmation) and releases nothing on the tap', () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'in_progress', accepted_by: 'hunter-1' };
    mockLifecycleArgs = { submissionStatus: 'pending' };
    render(<BountyDashboard />);
    expect(screen.queryByTestId('poster-review-modal')).toBeNull();
    fireEvent.press(screen.getByLabelText('Check the work'));
    expect(screen.getByTestId('poster-review-modal').props.children).toBe('review:b1:hunter-1:review');
    expect(mockPush).not.toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/postings/[bountyId]/review-and-verify' })
    );
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });
});

describe('Fix 6: Leave a review', () => {
  const completed = () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'completed', accepted_by: 'hunter-1' };
    mockOtherParty = { id: 'hunter-1', name: 'ana_hunts', avatar: null };
  };

  it('opens the rating step, not the payout receipt', async () => {
    completed();
    render(<BountyDashboard />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Leave a review for ana_hunts'));
    });
    expect(mockHasRated).toHaveBeenCalledWith('poster-1', 'b1', 'hunter-1');
    expect(screen.getByTestId('poster-review-modal').props.children).toBe('review:b1:hunter-1:rating');
    expect(mockPush).not.toHaveBeenCalledWith(expect.objectContaining({ pathname: '/postings/[bountyId]/payout' }));
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('does not ask again once this hunter was rated for this job', async () => {
    completed();
    mockHasRated.mockResolvedValue(true);
    render(<BountyDashboard />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Leave a review for ana_hunts'));
    });
    expect(screen.queryByTestId('poster-review-modal')).toBeNull();
    expect(lastAlert().title).toBe('Already reviewed');
  });

  it('a failed check opens nothing and says to try again', async () => {
    completed();
    mockHasRated.mockRejectedValue(new Error('offline'));
    render(<BountyDashboard />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Leave a review for ana_hunts'));
    });
    expect(screen.queryByTestId('poster-review-modal')).toBeNull();
    expect(lastAlert().title).toBe("Couldn't open the review");
  });

  it('a finished job the poster already reviewed says thank you instead of offering it again', async () => {
    completed();
    mockHasRated.mockResolvedValue(true);
    render(<BountyDashboard />);
    expect(await screen.findByText(/Thank you for leaving a review/)).toBeTruthy();
    expect(screen.queryByLabelText('Leave a review for ana_hunts')).toBeNull();
  });

  it('?openReview=true (rating_reminder) opens the rating step on its own', async () => {
    completed();
    mockParams = { bountyId: 'b1', openReview: 'true' };
    render(<BountyDashboard />);
    expect(await screen.findByTestId('poster-review-modal')).toBeTruthy();
    expect(screen.getByTestId('poster-review-modal').props.children).toBe('review:b1:hunter-1:rating');
  });

  it('?openReview=true does nothing on a job that is not finished', async () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'in_progress', accepted_by: 'hunter-1' };
    mockParams = { bountyId: 'b1', openReview: 'true' };
    render(<BountyDashboard />);
    await act(async () => {});
    expect(screen.queryByTestId('poster-review-modal')).toBeNull();
    expect(mockHasRated).not.toHaveBeenCalled();
  });
});

describe('Fix 8: take-down wording', () => {
  it('an unfunded job says "Take this job down" and never "Cancel and refund"', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    expect(screen.queryByText('Cancel and refund')).toBeNull();
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Take this job down'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const confirm = lastAlert();
    // Fix D: the confirmation matches the button.
    expect(confirm.title).toBe('Take this job down?');
    expect(confirm.message).toContain("You haven't been charged for it, so there's nothing to refund.");
    const go = confirm.buttons.find((b: any) => b.style === 'destructive');
    expect(go.text).toBe('Take it down');
    expect(mockCancel).not.toHaveBeenCalled();
    await act(async () => {
      go.onPress();
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(mockCancel.mock.calls[0][2]).toEqual({ refundAmount: 0, destination: null });
    await waitFor(() => expect(lastAlert().title).toBe('Job taken down'));
  });

  it('the confirmation re-reads on tap and acts on the fresh answer, not the one on screen', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    // Paid for in the meantime (e.g. on another device).
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: true });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Take this job down'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(lastAlert().title).toBe('Cancel and refund?');
    await act(async () => {
      lastAlert().buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(mockCancel.mock.calls[0][2]).toEqual({ refundAmount: 60, destination: 'wallet' });
  });

  it('a funded job keeps "Cancel and refund" and the same cancel service', async () => {
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: true });
    render(<BountyDashboard />);
    expect(await screen.findByLabelText('Cancel and refund')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Cancel and refund'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(lastAlert().message).toContain('$60 goes back to your Bounty balance.');
    await act(async () => {
      lastAlert().buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(mockCancel.mock.calls[0][2]).toEqual({ refundAmount: 60, destination: 'wallet' });
  });

  it('a for-honor job has no money to refund either', () => {
    mockBounty = { ...OPEN_AT_ACCEPT, is_for_honor: true, amount: 0 };
    render(<BountyDashboard />);
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    expect(mockPlan).not.toHaveBeenCalled();
  });
});

describe('A: a failed funding read is never shown as payment', () => {
  // planCancelRefund leans toward refunding when the funding read fails, so it
  // reports a refund; the re-read gets the client fallback, which says at_post.
  beforeEach(() => {
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_post', alreadyFunded: true });
  });

  it('the Payment card and button say neither "held" nor "refund"', async () => {
    render(<BountyDashboard />);
    expect(await screen.findByText(/couldn't check your payment/i)).toBeTruthy();
    expect(screen.queryByText(/held/i)).toBeNull();
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();
    expect(mockFundingRequirement).toHaveBeenCalledWith('b1');
  });

  it('the confirmation hedges, but the take-down acts on the same plan as before', async () => {
    render(<BountyDashboard />);
    await screen.findByText(/couldn't check your payment/i);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Take this job down'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const confirm = lastAlert();
    expect(confirm.title).toBe('Take this job down?');
    expect(confirm.message).toContain("We couldn't confirm whether you've been charged for it.");
    expect(confirm.message).toContain('If you were, $60 goes back to your Bounty balance.');
    await act(async () => {
      confirm.buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    // Behavior unchanged: the refund is still attempted, exactly as planned.
    expect(mockCancel.mock.calls[0][2]).toEqual({ refundAmount: 60, destination: 'wallet' });
  });

  it('a confirmed charge on an at_accept job is shown as held, with refund wording', async () => {
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: true });
    render(<BountyDashboard />);
    expect(await screen.findByText(/already paid \$60/)).toBeTruthy();
    expect(screen.getByLabelText('Cancel and refund')).toBeTruthy();
  });

  it('an at_post job is not re-read (its fallback and real answers agree)', async () => {
    mockBounty = { ...OPEN_AT_ACCEPT, funding_mode: 'at_post' };
    render(<BountyDashboard />);
    expect(await screen.findByText(/already paid \$60/)).toBeTruthy();
    expect(mockFundingRequirement).not.toHaveBeenCalled();
  });
});

describe('C: offers on the job page', () => {
  beforeEach(() => {
    mockApplicationCount = 3;
  });

  it('unpaid: says who offered and that nothing has been charged yet', async () => {
    render(<BountyDashboard />);
    expect(screen.getByText('3 people offered to help')).toBeTruthy();
    expect(screen.getByLabelText('Compare the 3 offers')).toBeTruthy();
    expect(
      await screen.findByText(
        "You haven't paid anything yet. When you choose someone, you'll see the exact amount before you pay."
      )
    ).toBeTruthy();
  });

  it('paid up front: says so, and never "haven\'t paid"', async () => {
    mockBounty = { ...OPEN_AT_ACCEPT, funding_mode: 'at_post' };
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
    render(<BountyDashboard />);
    expect(await screen.findByText(/already paid \$60/)).toBeTruthy();
    expect(screen.queryByText(/haven't paid/)).toBeNull();
  });

  it('checking: makes no payment claim', () => {
    mockPlan.mockReturnValue(new Promise(() => {}));
    render(<BountyDashboard />);
    expect(screen.getByText('Checking your payment…')).toBeTruthy();
    expect(screen.queryByText(/haven't paid|already paid|held/i)).toBeNull();
  });

  it('"Compare the 3 offers" stays on this job instead of leaving for the inbox', () => {
    render(<BountyDashboard />);
    fireEvent.press(screen.getByLabelText('Compare the 3 offers'));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByTestId('poster-offers')).toBeTruthy();
  });
});

describe('QA pass 2: resilience (2026-11-15)', () => {
  it('coming back to the page re-reads it; the first focus does not double the initial load', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    expect(mockRefresh).not.toHaveBeenCalled();
    // e.g. back from Requests after accepting an offer.
    await act(async () => {
      mockFocusCallback?.();
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('a failed payment read offers "Check again", which re-reads and shows the real answer', async () => {
    mockPlan.mockRejectedValueOnce(new Error('offline'));
    render(<BountyDashboard />);
    expect(await screen.findByText(/couldn't check your payment/i)).toBeTruthy();
    const retry = screen.getByLabelText('Check payment again');
    expect(retry.props.accessibilityRole ?? 'button').toBe('button');
    await act(async () => {
      fireEvent.press(retry);
    });
    expect(await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.")).toBeTruthy();
    expect(screen.queryByLabelText('Check payment again')).toBeNull();
    expect(mockPlan).toHaveBeenCalledTimes(2);
  });

  it('"Check again" only appears when the read failed', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    expect(screen.queryByLabelText('Check payment again')).toBeNull();
  });

  it('a double tap on "Take this job down" reads once and shows one confirmation', async () => {
    let resolvePlan: (v: unknown) => void = () => {};
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    mockPlan.mockClear();
    mockPlan.mockReturnValue(new Promise(r => { resolvePlan = r; }));
    const button = screen.getByLabelText('Take this job down');
    fireEvent.press(button);
    fireEvent.press(button);
    await act(async () => {
      resolvePlan({ refundAmount: 0, destination: null });
    });
    expect(mockPlan).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
    expect(lastAlert().title).toBe('Take this job down?');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('a failed take-down check says nothing changed and does not cancel', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    mockPlan.mockRejectedValue(new Error('offline'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Take this job down'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(lastAlert().title).toBe("Can't take this job down right now");
    expect(lastAlert().message).toContain('nothing was changed');
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('closing the review sheet any way re-reads the page, so it never shows a stale "Review & release"', async () => {
    mockBounty = { ...OPEN_AT_ACCEPT, status: 'in_progress', accepted_by: 'hunter-1' };
    mockLifecycleArgs = { submissionStatus: 'pending' };
    render(<BountyDashboard />);
    fireEvent.press(screen.getByLabelText('Check the work'));
    expect(screen.getByTestId('poster-review-modal')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('poster-review-modal-close'));
    });
    expect(screen.queryByTestId('poster-review-modal')).toBeNull();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('the payment status line is a polite live region (announced when "Checking…" resolves)', async () => {
    render(<BountyDashboard />);
    await screen.findByText("You haven't paid anything yet. You only pay when you choose someone.");
    expect(screen.getByTestId('bounty-payment-state').props.accessibilityLiveRegion).toBe('polite');
  });
});
