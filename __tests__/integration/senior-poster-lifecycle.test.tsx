/**
 * Senior poster lifecycle, end to end on the job page (QA pass 2, 2026-11-15).
 *
 * The REAL job page (app/postings/[bountyId]), the REAL PosterReviewModal, the
 * REAL lifecycle resolver and the REAL payment-architecture helpers. Only the
 * service layer is mocked, plus a fake "server" (mockServer) the test advances
 * between steps the way another screen would (accepting an offer in Requests,
 * the hunter submitting). Returning to the page is a focus event, and the page
 * must re-read on it.
 *
 * Nothing here moves money: approveAndRelease, cancelAndRefundBounty and
 * submitRating are jest mocks. The tests assert WHEN the page would call them.
 *
 * 2026-11-16 (second pass): the offers are on the job page itself, rendered
 * by the REAL ApplicantCard. Choosing someone goes through usePosterJobOffers,
 * mocked here only at its boundary: its `choose` stands in for the pay sheet
 * plus fn_accept_bounty_request and returns the outcome the real hook returns.
 * "You've chosen …" must appear only for an accepted outcome.
 *
 * Steps covered elsewhere:
 *  - Profile → own job opens /postings/<id>: profile-bounty-history-ownership.test.tsx
 *  - Inbox applicant rows have no delete: inbox-applicant-row-delete.test.tsx
 *  - The chat's offer banner count: bounty-thread-offer-count.test.tsx
 *  - The pay sheet and acceptance transaction: use-accept-request-funding.test.tsx
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

// ── Fake server state, advanced by the test ────────────────────────────────
type ServerSnapshot = {
  bounty: any;
  args: Record<string, unknown>;
  otherParty: { id: string | null; name: string | null; avatar: string | null };
  applicationCount: number;
  submission: any;
};
let mockServer: ServerSnapshot;
let mockFocusCallback: (() => void) | null = null;
let mockRefreshCount = 0;

const mockPush = jest.fn();
const mockPlan = jest.fn();
const mockCancel = jest.fn();
const mockFundingRequirement = jest.fn();
const mockHasRated = jest.fn();
const mockApproveAndRelease = jest.fn();
const mockGetSubmissionForReview = jest.fn();
const mockSubmitRating = jest.fn();

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1' }),
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/postings/b1',
  useGlobalSearchParams: () => ({}),
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
jest.mock('../../lib/wallet-context', () => ({
  useWallet: () => ({ refundEscrow: jest.fn(), releaseFunds: jest.fn() }),
}));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
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
  ratingsService: {
    hasRated: (...a: unknown[]) => mockHasRated(...a),
    getAggregatedStats: jest.fn().mockResolvedValue({ averageRating: 0, ratingCount: 0 }),
  },
}));
jest.mock('../../lib/services/completion-approval', () => ({
  approveAndRelease: (...a: unknown[]) => mockApproveAndRelease(...a),
}));
jest.mock('../../lib/services/completion-service', () => ({
  completionService: {
    getSubmissionForReview: (...a: unknown[]) => mockGetSubmissionForReview(...a),
    submitRating: (...a: unknown[]) => mockSubmitRating(...a),
    approveSubmission: jest.fn(),
    requestRevision: jest.fn(),
  },
}));
jest.mock('lib/services/userProfile', () => ({
  userProfileService: { getProfile: jest.fn().mockResolvedValue({ id: 'hunter-1', username: 'ana_hunts' }) },
}));
jest.mock('../../lib/utils/data-utils', () => ({
  ...jest.requireActual('../../lib/utils/data-utils'),
  getCurrentUserId: () => 'poster-1',
}));
jest.mock('../../lib/services/message-service', () => ({ messageService: { getOrCreateConversation: jest.fn() } }));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../components/edit-posting-modal', () => ({ EditPostingModal: () => null }));
jest.mock('../../components/attachment-viewer-modal', () => ({ AttachmentViewerModal: () => null }));
// The lifecycle hook, backed by mockServer: it re-reads on refresh(), like the
// real one re-fetching. Its state goes through the REAL resolver.
jest.mock('../../hooks/useBountyLifecycle', () => {
  const R = require('react');
  const { resolveBountyLifecycle } = jest.requireActual('../../lib/utils/bounty-lifecycle');
  return {
    useBountyLifecycle: () => {
      const [snap, setSnap] = R.useState(() => mockServer);
      // A re-fetch returns a new bounty object, as bountyService.getById does.
      const refresh = R.useCallback(async () => {
        mockRefreshCount += 1;
        setSnap({ ...mockServer, bounty: { ...mockServer.bounty } });
      }, []);
      return {
        bounty: snap.bounty,
        role: 'poster',
        state: resolveBountyLifecycle({
          bounty: snap.bounty,
          role: 'poster',
          applicationCount: snap.applicationCount,
          ...snap.args,
        }),
        otherParty: snap.otherParty,
        applicationCount: snap.applicationCount,
        submission: snap.submission,
        isLoading: false,
        error: null,
        notFound: false,
        refresh,
      };
    },
  };
});

// The global react-native mock has no Animated.add / PanResponder, which the
// slide-to-confirm builds on. Inert stand-ins; the confirm itself is driven
// through the control's accessibility action (its non-drag alternative).
{
  const RN = require('react-native');
  const value = () => ({ setValue: jest.fn(), interpolate: jest.fn(() => 0), addListener: jest.fn(), removeAllListeners: jest.fn(), stopAnimation: jest.fn() });
  RN.Animated = RN.Animated ?? {};
  RN.Animated.Value = RN.Animated.Value ?? jest.fn(value);
  RN.Animated.add = jest.fn(value);
  RN.Animated.spring = RN.Animated.spring ?? jest.fn(() => ({ start: jest.fn() }));
  RN.Animated.timing = RN.Animated.timing ?? jest.fn(() => ({ start: jest.fn() }));
  RN.Animated.View = RN.Animated.View ?? 'Animated.View';
  RN.PanResponder = RN.PanResponder ?? { create: () => ({ panHandlers: {} }) };
}

// The offers on this job, and the hire boundary. mockChoose stands in for the
// pay sheet + fn_accept_bounty_request and resolves like useAcceptRequest.
let mockOffers: any[] = [];
const mockChoose = jest.fn();
const mockPass = jest.fn();
const mockAsk = jest.fn();
jest.mock('../../hooks/usePosterJobOffers', () => ({
  usePosterJobOffers: () => ({
    offers: mockOffers,
    loadState: 'ready',
    reload: jest.fn(),
    gate: { active: false },
    choose: (...a: unknown[]) => mockChoose(...a),
    pass: (...a: unknown[]) => mockPass(...a),
    ask: (...a: unknown[]) => mockAsk(...a),
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

const BASE = {
  id: 'b1',
  title: 'Remove old furniture from my garage',
  description: 'Three chairs and a sofa.',
  amount: 60,
  is_for_honor: false,
  poster_id: 'poster-1',
  payment_architecture_version: 1,
  created_at: new Date().toISOString(),
};
const HUNTER = { id: 'hunter-1', name: 'ana_hunts', avatar: null };

function offer(id: string, hunterId: string, username: string, profile: Record<string, unknown>, message: string) {
  return {
    id,
    bounty_id: 'b1',
    hunter_id: hunterId,
    status: 'pending',
    message,
    created_at: new Date().toISOString(),
    profile: { username, ...profile },
    bounty: { ...BASE, funding_mode: 'at_accept' },
  };
}
const THREE_OFFERS = [
  offer('r1', 'hunter-1', 'ana_hunts', { hunterCompleted: 4, averageRating: 4.8, ratingCount: 5, stripe_identity_status: 'verified' }, 'I have a van and can come Saturday.'),
  offer('r2', 'hunter-2', 'ben_fixes', { hunterCompleted: 1, averageRating: 5, ratingCount: 1 }, 'Happy to help this week.'),
  offer('r3', 'hunter-3', 'cara_helps', {}, 'I can lift heavy things.'),
];
const NO_ONE = { id: null, name: null, avatar: null };
const PENDING_SUBMISSION = {
  id: 's1',
  bounty_id: 'b1',
  hunter_id: 'hunter-1',
  status: 'pending',
  message: 'All cleared out.',
  proof_items: [],
  submitted_at: new Date().toISOString(),
};

function alerts(): any[][] {
  return (Alert.alert as jest.Mock).mock.calls;
}
function lastAlert() {
  const calls = alerts();
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons: buttons ?? [] };
}

/**
 * Tap "Choose <name>", check the confirmation asks first (nothing is chosen
 * yet), then confirm it.
 */
async function chooseAndConfirm(name: string) {
  const callsBefore = mockChoose.mock.calls.length;
  fireEvent.press(screen.getByLabelText(`Choose ${name}`));
  expect(lastAlert().title).toBe(`Choose ${name}?`);
  expect(mockChoose.mock.calls.length).toBe(callsBefore);
  await act(async () => {
    lastAlert().buttons.find((b: any) => b.text === `Choose ${name}`).onPress();
  });
}

/** Another screen changed the job; the poster comes back to this page. */
async function serverChangesAndPosterReturns(next: Partial<ServerSnapshot>) {
  mockServer = { ...mockServer, ...next };
  await act(async () => {
    mockFocusCallback?.();
  });
}

const UNPAID_WITH_OFFERS =
  "You haven't paid anything yet. When you choose someone, you'll see the exact amount before you pay.";
// "Approve and pay $60.00", or "Mark as done" for an unpaid job.
const APPROVE_BUTTON = /^(Approve and pay \$\d|Mark as done$)/;

beforeEach(() => {
  jest.clearAllMocks();
  mockOffers = [];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockFocusCallback = null;
  mockRefreshCount = 0;
  mockHasRated.mockResolvedValue(false);
  mockSubmitRating.mockResolvedValue(undefined);
  mockGetSubmissionForReview.mockResolvedValue(PENDING_SUBMISSION);
});

afterEach(() => {
  (Alert.alert as jest.Mock).mockRestore?.();
});

describe('Unfunded job (pay when you choose): open → hired → submitted → released → rated', () => {
  beforeEach(() => {
    mockServer = {
      bounty: { ...BASE, status: 'open', funding_mode: 'at_accept', accepted_by: null },
      args: {},
      otherParty: NO_ONE,
      applicationCount: 3,
      submission: null,
    };
    mockOffers = THREE_OFFERS;
    // A real server reply: nothing funded yet.
    mockPlan.mockResolvedValue({ refundAmount: 0, destination: null });
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: false });
  });

  it('walks the whole job, releasing only after the explicit confirmation', async () => {
    render(<BountyDashboard />);

    // ── 1. Open, 3 offers, nothing paid ────────────────────────────────────
    expect(await screen.findByText(UNPAID_WITH_OFFERS)).toBeTruthy();
    expect(screen.getAllByText('3 people offered to help').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();

    // ── 2. All three offers on this page, with what is known about each ────
    fireEvent.press(screen.getByLabelText('Compare the 3 offers'));
    expect(mockPush).not.toHaveBeenCalled();
    const offers = screen.getByTestId('poster-offers');
    expect(within(offers).getByText('ana_hunts')).toBeTruthy();
    expect(within(offers).getByText('4 jobs done on Bounty')).toBeTruthy();
    expect(within(offers).getByText('★ 4.8 from 5 reviews')).toBeTruthy();
    expect(within(offers).getByText('I have a van and can come Saturday.')).toBeTruthy();
    // One review is too few to show an average (MIN_RATING_SAMPLE).
    expect(within(offers).getByText('1 job done on Bounty')).toBeTruthy();
    expect(within(offers).queryByText(/★ 5\.0/)).toBeNull();
    expect(within(offers).getByText('New to Bounty')).toBeTruthy();
    expect(within(offers).getAllByLabelText(/^View .*'s profile and reviews$/).length).toBe(3);
    // No marketplace jargon on the cards.
    expect(within(offers).queryByText(/hunter|bounty applicant|escrow/i)).toBeNull();

    // ── 3. "Not this time" asks first, and removes only that offer ────────
    fireEvent.press(within(offers).getByLabelText("Not this time: remove cara_helps's offer"));
    expect(lastAlert().title).toBe('Not this time?');
    expect(lastAlert().message).toContain('Your job stays open');
    expect(mockPass).not.toHaveBeenCalled();
    mockPass.mockResolvedValue(true);
    await act(async () => {
      lastAlert().buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    expect(mockPass).toHaveBeenCalledWith('r3');
    expect(mockCancel).not.toHaveBeenCalled();
    mockOffers = THREE_OFFERS.slice(0, 2);
    await serverChangesAndPosterReturns({ applicationCount: 2 });
    expect(await screen.findByLabelText('Compare the 2 offers')).toBeTruthy();

    // ── 4. Choosing someone: no confirmation screen until the server says yes
    mockChoose.mockResolvedValueOnce({ accepted: false, reason: 'declined_payment' });
    await chooseAndConfirm('ana_hunts');
    expect(mockChoose).toHaveBeenCalledWith('r1');
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();

    mockChoose.mockImplementationOnce(async () => {
      // The acceptance transaction: hired, and the job charged at accept.
      mockServer = {
        ...mockServer,
        bounty: { ...mockServer.bounty, status: 'in_progress', accepted_by: 'hunter-1' },
        otherParty: HUNTER,
        applicationCount: 0,
      };
      mockOffers = [];
      return { accepted: true, bountyId: 'b1', hunterId: 'hunter-1', hunterName: 'ana_hunts', conversationId: 'conv-1' };
    });
    await chooseAndConfirm('ana_hunts');
    expect(await screen.findByTestId('hire-confirmation')).toBeTruthy();
    expect(screen.getByText("You've chosen ana_hunts")).toBeTruthy();
    expect(screen.getByText('Agree on a day and time for the work.')).toBeTruthy();
    expect(within(screen.getByTestId('hire-confirmation')).getByLabelText('Message ana_hunts')).toBeTruthy();
    fireEvent.press(screen.getByTestId('hire-confirmation-done'));
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();

    // The page re-read: no stale "You haven't paid", no take-down, the money
    // is held for the person chosen, and they are shown as doing the job.
    expect(
      await screen.findByText('Bounty is holding your $60. ana_hunts is paid only after you approve the work.')
    ).toBeTruthy();
    expect(screen.queryByText(/haven't paid anything/)).toBeNull();
    expect(screen.queryByLabelText('Take this job down')).toBeNull();
    expect(screen.getByTestId('bounty-manage-locked')).toBeTruthy();
    expect(screen.getByTestId('poster-helper-card')).toBeTruthy();
    expect(screen.getByText('ana_hunts is doing the job')).toBeTruthy();

    // ── 5. The hunter submits ──────────────────────────────────────────────
    await serverChangesAndPosterReturns({
      args: { submissionStatus: 'pending', submittedAt: PENDING_SUBMISSION.submitted_at },
      submission: PENDING_SUBMISSION,
    });
    const review = 'Check the work';

    // ── 6. Open the review: nothing is released by opening it ─────────────
    fireEvent.press(await screen.findByLabelText(review));
    expect(await screen.findByText(APPROVE_BUTTON)).toBeTruthy();
    expect(mockGetSubmissionForReview).toHaveBeenCalledWith('b1', 'hunter-1');
    // The hunter's message, in the sheet (the page's Submitted work card has it too).
    expect(screen.getAllByText('All cleared out.').length).toBeGreaterThanOrEqual(2);
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    // ── 7. The irreversible step, then backing out of it ──────────────────
    fireEvent.press(screen.getByText(APPROVE_BUTTON));
    expect(screen.getByText('Pay ana_hunts $60.00?')).toBeTruthy();
    expect(
      screen.getByText('Only approve if the job is finished. Approving marks the job as done and releases $60.00 to ana_hunts.')
    ).toBeTruthy();
    expect(screen.getByText('Once you approve, this cannot be undone.')).toBeTruthy();
    fireEvent.press(screen.getByText('Back to review'));
    expect(screen.getByText(APPROVE_BUTTON)).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    // ── 8. Explicit confirmation releases, exactly once ───────────────────
    mockApproveAndRelease.mockResolvedValue(true);
    fireEvent.press(screen.getByText(APPROVE_BUTTON));
    await act(async () => {
      fireEvent(screen.getByLabelText('Slide to approve and pay'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });
    await waitFor(() => expect(mockApproveAndRelease).toHaveBeenCalledTimes(1));
    expect(mockApproveAndRelease.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bountyId: 'b1', hunterId: 'hunter-1', amount: 60, isForHonor: false, architecture: 'v1' })
    );
    expect(await screen.findByText('Work approved. $60.00 has been released to ana_hunts.')).toBeTruthy();

    // ── 9. Rating ──────────────────────────────────────────────────────────
    expect(screen.getByText('Rate ana_hunts')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('5 stars'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Submit review'));
    });
    await waitFor(() => expect(mockSubmitRating).toHaveBeenCalledTimes(1));
    expect(mockSubmitRating.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bounty_id: 'b1', to_user_id: 'hunter-1', rating: 5 })
    );
    expect(lastAlert().title).toBe('Thanks for your review');

    // ── 10. Back on the job: its final state ──────────────────────────────
    mockServer = {
      ...mockServer,
      bounty: { ...mockServer.bounty, status: 'completed' },
      args: { submissionStatus: 'approved' },
      submission: { ...PENDING_SUBMISSION, status: 'approved' },
    };
    const refreshesBefore = mockRefreshCount;
    await act(async () => {
      lastAlert().buttons.find((b: any) => b.text === 'OK').onPress();
    });
    expect(mockRefreshCount).toBeGreaterThan(refreshesBefore);
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();
    expect(await screen.findByText('Released to ana_hunts')).toBeTruthy();
    expect(screen.getByText('Your $60 was released to ana_hunts.')).toBeTruthy();
    expect(within(screen.getByTestId('bounty-payment-state')).queryByText(/escrow/i)).toBeNull();

    // ── 11. Leave a review again: already done, nothing reopens ───────────
    mockHasRated.mockResolvedValue(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Leave a review for ana_hunts'));
    });
    expect(lastAlert().title).toBe('Already reviewed');
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();
    // Only the one release, ever.
    expect(mockApproveAndRelease).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
  });

  it('while a hire is being confirmed, the page says so instead of still showing the offers (16 Nov swarm)', async () => {
    let finish: (v: unknown) => void = () => {};
    mockChoose.mockReturnValueOnce(new Promise(r => (finish = r)));
    render(<BountyDashboard />);
    await screen.findByText(UNPAID_WITH_OFFERS);
    await chooseAndConfirm('ana_hunts');
    expect(screen.getByTestId('poster-choosing')).toBeTruthy();
    expect(screen.getByText('Choosing ana_hunts…')).toBeTruthy();
    // Nothing on screen still says the job is waiting on the poster.
    expect(screen.queryByText('3 people offered to help')).toBeNull();
    expect(screen.queryByLabelText('Compare the 3 offers')).toBeNull();
    await act(async () => {
      finish({ accepted: true, bountyId: 'b1', hunterId: 'hunter-1', hunterName: 'ana_hunts', conversationId: null });
    });
    expect(screen.queryByTestId('poster-choosing')).toBeNull();
    expect(screen.getByText("You've chosen ana_hunts")).toBeTruthy();
  });

  it('a hire that does not go through leaves the "Choosing" screen and shows no confirmation', async () => {
    mockChoose.mockResolvedValueOnce({ accepted: false, reason: 'failed' });
    render(<BountyDashboard />);
    await screen.findByText(UNPAID_WITH_OFFERS);
    await chooseAndConfirm('ana_hunts');
    expect(screen.queryByTestId('poster-choosing')).toBeNull();
    expect(screen.queryByTestId('hire-confirmation')).toBeNull();
    expect(screen.getByLabelText('Compare the 3 offers')).toBeTruthy();
  });

  it('a release that does not confirm is never shown as paid, and the page re-reads on close', async () => {
    mockServer = {
      ...mockServer,
      bounty: { ...mockServer.bounty, status: 'in_progress', accepted_by: 'hunter-1' },
      otherParty: HUNTER,
      applicationCount: 0,
      args: { submissionStatus: 'pending' },
      submission: PENDING_SUBMISSION,
    };
    mockApproveAndRelease.mockResolvedValue(false);
    render(<BountyDashboard />);
    fireEvent.press(await screen.findByLabelText('Check the work'));
    fireEvent.press(await screen.findByText(APPROVE_BUTTON));
    await act(async () => {
      fireEvent(screen.getByLabelText('Slide to approve and pay'), 'accessibilityAction', {
        nativeEvent: { actionName: 'activate' },
      });
    });
    await waitFor(() => expect(lastAlert().title).toBe('Payment not confirmed'));
    expect(screen.queryByText(/has been released/)).toBeNull();
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();

    const refreshesBefore = mockRefreshCount;
    fireEvent.press(screen.getByLabelText('Back to previous step'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Close'));
    });
    expect(mockRefreshCount).toBe(refreshesBefore + 1);
    // Still awaiting review: the job page did not move on by itself.
    expect(screen.getByLabelText('Check the work')).toBeTruthy();
  });
});

describe('Funded job (paid up front): open with money held → take-down kept behind a confirmation', () => {
  beforeEach(() => {
    mockServer = {
      bounty: { ...BASE, status: 'open', funding_mode: 'at_post', accepted_by: null },
      args: {},
      otherParty: NO_ONE,
      applicationCount: 1,
      submission: null,
    };
    mockPlan.mockResolvedValue({ refundAmount: 60, destination: 'wallet' });
  });

  it('says the money is held, and "Keep it" changes nothing', async () => {
    render(<BountyDashboard />);
    expect(
      await screen.findByText("You've already paid $60. Bounty holds it until you approve the finished work.")
    ).toBeTruthy();
    expect(screen.getByText('Held by Bounty')).toBeTruthy();
    expect(screen.queryByText(/haven't paid/)).toBeNull();
    const cancel = screen.getByLabelText('Cancel and refund');
    await act(async () => {
      fireEvent.press(cancel);
    });
    await waitFor(() => expect(lastAlert().title).toBe('Cancel and refund?'));
    expect(lastAlert().message).toContain('$60 goes back to your Bounty balance.');
    const keep = lastAlert().buttons.find((b: any) => b.text === 'Keep it');
    expect(keep.style).toBe('cancel');
    keep.onPress?.();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('a failed money read on return shows "Check again", never a stale answer', async () => {
    render(<BountyDashboard />);
    await screen.findByText(/already paid \$60/);
    mockPlan.mockRejectedValueOnce(new Error('offline'));
    await serverChangesAndPosterReturns({});
    expect(await screen.findByText(/couldn't check your payment/i)).toBeTruthy();
    expect(screen.queryByText(/already paid|held by bounty/i)).toBeNull();
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check payment again'));
    });
    expect(await screen.findByText(/already paid \$60/)).toBeTruthy();
  });
});

describe('For-honor job: no money anywhere in the flow', () => {
  it('has no Payment card and confirms completion as "mark complete"', async () => {
    mockServer = {
      bounty: { ...BASE, amount: 0, is_for_honor: true, status: 'in_progress', accepted_by: 'hunter-1' },
      args: { submissionStatus: 'pending' },
      otherParty: HUNTER,
      applicationCount: 0,
      submission: PENDING_SUBMISSION,
    };
    render(<BountyDashboard />);
    expect(screen.queryByTestId('bounty-payment-state')).toBeNull();
    expect(mockPlan).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByLabelText('Check the work'));
    fireEvent.press(await screen.findByText(APPROVE_BUTTON));
    expect(screen.getByLabelText('Slide to mark complete')).toBeTruthy();
    expect(screen.queryByText(/escrow release/)).toBeNull();
  });
});
