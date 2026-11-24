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
 * Steps covered elsewhere (other screens, already unit-tested on this branch):
 *  - Profile → own job opens /postings/<id>: profile-bounty-history-ownership.test.tsx
 *  - Inbox applicant rows have no delete: inbox-applicant-row-delete.test.tsx
 *  - The chat's offer banner count, and after a pass: bounty-thread-offer-count.test.tsx,
 *    hooks/use-bounty-thread-offer-count.test.tsx
 *  - Accepting an offer (pay-at-accept gate) is the existing Requests flow; it
 *    is represented here only by its outcome on the server.
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

// ── Focus-first workspace dependencies (app/postings/[bountyId]) ──────────
// The workspace mounts the job thread's pay gate and accept/reject hooks for
// stage D, and reads the pair's conversation and the problem records. None
// of that is under test here, so they are inert.
jest.mock('../../components/accept-funding-gate', () => ({ AcceptFundingGate: () => null }));
jest.mock('../../hooks/useAcceptFunding', () => ({
  useAcceptFunding: () => ({ gate: { active: false }, ensureFunded: jest.fn(), handleAcceptFailure: jest.fn() }),
}));
jest.mock('../../hooks/useAcceptRequest', () => ({ useAcceptRequest: () => ({ handleAcceptRequest: jest.fn() }) }));
jest.mock('../../hooks/useRejectRequest', () => ({ useRejectRequest: () => ({ handleRejectRequest: jest.fn() }) }));
jest.mock('../../hooks/useRequestExpiryPolicy', () => ({
  useRequestExpiryPolicy: () => ({ expiryHours: 72, interactedExpiryHours: 168 }),
}));
jest.mock('../../hooks/useJobWorkspaceData', () => ({
  useJobConversation: () => ({ conversationId: null, lastFromOther: null, awaitingReplySince: null, loaded: true, reload: jest.fn() }),
  usePendingApplicants: () => ({ applicants: [], loaded: true, reload: jest.fn() }),
  useHireTime: () => null,
  useJobProblemRecords: () => ({ cancellation: null, dispute: null }),
}));
jest.mock('../../lib/services/focus-analytics', () => ({ trackWorkspacePrimaryTapped: jest.fn() }));
jest.mock('../../lib/my-jobs/side-labels-store', () => ({ useWorksBothSides: () => false }));
jest.mock('../../components/ui/app-modal', () => ({
  AppModal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => (visible ? children : null),
}));

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
function lastAlert(): { title: string; message: string; buttons: any[] } {
  // The designed confirmation (J.4) when it's showing, read like an alert.
  const dialog = screen.queryByTestId('confirm-dialog');
  if (dialog) {
    const text = (id: string) => {
      const node = screen.queryByTestId(id);
      if (!node) return '';
      const out: string[] = [];
      const walk = (n: any) => (typeof n === 'string' ? out.push(n) : (n?.children ?? []).forEach(walk));
      walk(node);
      return out.join(' ');
    };
    const yes = screen.getByTestId('confirm-dialog-yes');
    const no = screen.getByTestId('confirm-dialog-no');
    const all = text('confirm-dialog');
    return {
      title: text('confirm-dialog-title') || all,
      message: all,
      buttons: [
        { text: text('confirm-dialog-no').trim(), style: 'cancel', onPress: () => fireEvent.press(no) },
        { text: text('confirm-dialog-yes').trim(), style: 'destructive', onPress: () => fireEvent.press(yes) },
      ] as any[],
    };
  }
  const calls = alerts();
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons: buttons ?? [] };
}

/** Another screen changed the job; the poster comes back to this page. */
async function serverChangesAndPosterReturns(next: Partial<ServerSnapshot>) {
  mockServer = { ...mockServer, ...next };
  await act(async () => {
    mockFocusCallback?.();
  });
}

function primaryLabel(): string {
  const { resolveBountyLifecycle } = jest.requireActual('../../lib/utils/bounty-lifecycle');
  return resolveBountyLifecycle({
    bounty: mockServer.bounty,
    role: 'poster',
    applicationCount: mockServer.applicationCount,
    ...mockServer.args,
  }).primaryAction.label;
}

beforeEach(() => {
  jest.clearAllMocks();
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


/**
 * Edit and take-down sit under the workspace's collapsed "Other options"
 * (Focus-first handoff). Opens it when it is there; a no-op when the job
 * offers neither, so "not offered" assertions still see nothing.
 */
function openOtherOptions() {
  const toggle = screen.queryByTestId('bounty-manage-actions-toggle');
  if (toggle) fireEvent.press(toggle);
}

describe('Unfunded job (pay when you choose): open → hired → submitted → released → rated', () => {
  beforeEach(() => {
    mockServer = {
      bounty: { ...BASE, status: 'open', funding_mode: 'at_accept', accepted_by: null },
      args: {},
      otherParty: NO_ONE,
      applicationCount: 3,
      submission: null,
    };
    // A real server reply: nothing funded yet.
    mockPlan.mockResolvedValue({ refundAmount: 0, destination: null });
    mockFundingRequirement.mockResolvedValue({ bountyId: 'b1', fundingMode: 'at_accept', alreadyFunded: false });
  });

  it('walks the whole job, releasing only after the explicit confirmation', async () => {
    render(<BountyDashboard />);
    openOtherOptions();

    // ── 1. Open, 3 applicants, nothing paid ────────────────────────────────
    expect(await screen.findByText(/You haven't paid anything yet\./)).toBeTruthy();
    expect(screen.getByText(/You only pay when you choose someone\./)).toBeTruthy();
    expect(screen.getByText('3 people want to help.')).toBeTruthy();
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    expect(screen.queryByLabelText('Cancel and refund')).toBeNull();

    // ── 2. Review applicants: "See each person" shows them on this page, one
    //       at a time (Focus-first D), instead of leaving for Requests ───────
    fireEvent.press(screen.getByLabelText('See each person'));
    expect(mockPush).not.toHaveBeenCalled();

    // ── 3. Declined one elsewhere: the count follows on return ────────────
    await serverChangesAndPosterReturns({ applicationCount: 2 });
    expect(await screen.findByText('2 people want to help.')).toBeTruthy();

    // ── 4. Accepted ana_hunts elsewhere (charged at accept) ───────────────
    await serverChangesAndPosterReturns({
      bounty: { ...mockServer.bounty, status: 'in_progress', accepted_by: 'hunter-1' },
      otherParty: HUNTER,
      applicationCount: 0,
    });
    // The page re-read: no stale "You haven't paid", no take-down, the
    // work is underway, with the money described as held.
    expect(await screen.findByText(/Your \$60 is with Bounty\. Nobody is paid until you approve\./)).toBeTruthy();
    expect(screen.queryByText(/You haven't paid anything yet\./)).toBeNull();
    expect(screen.queryByLabelText('Take this job down')).toBeNull();
    expect(screen.getByTestId('bounty-manage-locked')).toBeTruthy();

    // ── 5. The hunter submits ──────────────────────────────────────────────
    await serverChangesAndPosterReturns({
      args: { submissionStatus: 'pending', submittedAt: PENDING_SUBMISSION.submitted_at },
      submission: PENDING_SUBMISSION,
    });
    const review = primaryLabel();
    expect(review).toBe('Review & release payment');

    // ── 6. Open the review: nothing is released by opening it ─────────────
    // The workspace names the resolver's review action in the handoff's words.
    // It opens straight on the design's review screen (I); the old "Review
    // Submission" view with "Proceed to Payout" no longer comes first.
    fireEvent.press(await screen.findByLabelText('Review the completed work'));
    expect(await screen.findByText('Is the job finished?')).toBeTruthy();
    expect(screen.queryByText('Proceed to Payout')).toBeNull();
    expect(mockGetSubmissionForReview).toHaveBeenCalledWith('b1', 'hunter-1');
    // The hunter's message, in the sheet (the page's Submitted work card has it too).
    expect(screen.getAllByText(/All cleared out\./).length).toBeGreaterThanOrEqual(2);
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    // ── 7. The irreversible step, then backing out of it ──────────────────
    expect(screen.getByText('Your $60 is released to ana_hunts')).toBeTruthy();
    expect(screen.getByText("This can't be undone")).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Approve and pay ana_hunts $60'));
    fireEvent.press(screen.getByLabelText('Back to previous step'));
    expect(screen.queryByLabelText('Yes, pay ana_hunts $60')).toBeNull();
    expect(screen.getByText('Is the job finished?')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    // ── 8. Explicit confirmation releases, exactly once ───────────────────
    mockApproveAndRelease.mockResolvedValue(true);
    fireEvent.press(screen.getByLabelText('Approve and pay ana_hunts $60'));
    expect(screen.getByText('Pay ana_hunts $60?')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Yes, pay ana_hunts $60'));
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
    expect(await screen.findByText('Done. Released to ana_hunts.')).toBeTruthy();
    expect(within(screen.getByTestId('bounty-payment-state')).getByText(/Released to ana_hunts/)).toBeTruthy();
    expect(within(screen.getByTestId('bounty-payment-state')).queryByText(/escrow/i)).toBeNull();

    // ── 11. Leave a review again: already done, nothing reopens ───────────
    mockHasRated.mockResolvedValue(true);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Send rating'));
    });
    expect(lastAlert().title).toBe('Already reviewed');
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();
    // Only the one release, ever.
    expect(mockApproveAndRelease).toHaveBeenCalledTimes(1);
    expect(mockCancel).not.toHaveBeenCalled();
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
    openOtherOptions();
    fireEvent.press(await screen.findByLabelText('Review the completed work'));
    await screen.findByText('Is the job finished?');
    fireEvent.press(screen.getByLabelText('Approve and pay ana_hunts $60'));
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Yes, pay ana_hunts $60'));
    });
    await waitFor(() => expect(lastAlert().title).toBe('Payment not confirmed'));
    expect(screen.queryByText(/has been released/)).toBeNull();
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();

    const refreshesBefore = mockRefreshCount;
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Close'));
    });
    expect(mockRefreshCount).toBe(refreshesBefore + 1);
    // Still awaiting review: the job page did not move on by itself.
    expect(screen.getByLabelText('Review the completed work')).toBeTruthy();
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
    openOtherOptions();
    expect(await screen.findByText(/Your \$60 is with Bounty\. Nobody is paid until you approve\./)).toBeTruthy();
    expect(screen.getByText('1 person wants to help.')).toBeTruthy();
    expect(screen.queryByText(/You only pay when you choose/)).toBeNull();
    const cancel = screen.getByLabelText('Cancel and refund');
    await act(async () => {
      fireEvent.press(cancel);
    });
    await waitFor(() => expect(lastAlert().title).toBe('Cancel and refund?'));
    expect(lastAlert().message).toContain('$60 goes back to your Bounty balance.');
    const keep = lastAlert().buttons.find((b: any) => b.text === 'Keep my job');
    expect(keep.style).toBe('cancel');
    keep.onPress?.();
    expect(mockCancel).not.toHaveBeenCalled();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('a failed money read on return shows "Check again", never a stale answer', async () => {
    render(<BountyDashboard />);
    openOtherOptions();
    await screen.findByText(/Your \$60 is with Bounty\. Nobody is paid until you approve\./);
    mockPlan.mockRejectedValueOnce(new Error('offline'));
    await serverChangesAndPosterReturns({});
    expect(await screen.findByText(/couldn't check your payment/i)).toBeTruthy();
    expect(screen.queryByText(/Your \$60 is with Bounty\. Nobody is paid until you approve\./)).toBeNull();
    expect(screen.getByLabelText('Take this job down')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Check payment again'));
    });
    expect(await screen.findByText(/Your \$60 is with Bounty\. Nobody is paid until you approve\./)).toBeTruthy();
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
    openOtherOptions();
    expect(screen.queryByTestId('bounty-payment-state')).toBeNull();
    expect(mockPlan).not.toHaveBeenCalled();
    fireEvent.press(await screen.findByLabelText('Review the completed work'));
    await screen.findByText('Is the job finished?');
    expect(screen.getByLabelText('Approve and mark complete')).toBeTruthy();
    expect(screen.queryByLabelText(/Approve and pay/)).toBeNull();
    expect(screen.queryByText(/escrow release/)).toBeNull();
  });
});
