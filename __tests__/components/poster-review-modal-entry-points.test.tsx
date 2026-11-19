/**
 * Senior-first poster audit (2026-11-14), fixes 3 and 6: the job page now
 * opens PosterReviewModal for both the completion review and "Leave a review".
 *
 *  - Review (fix 3): opening it releases nothing. "Proceed to Payout" leads
 *    to the "Complete and release payment? … cannot be undone" step. Its
 *    "Approve and pay $X" button only opens a second confirmation;
 *    approveAndRelease runs only from that confirmation's "Yes, pay $X".
 *  - startOnRating (fix 6): opens straight on the rating step, even for a
 *    completed job with no submission row (the payout screen's toggle can
 *    complete one without it). It submits through completionService.submitRating
 *    and never reaches approval or payout.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo, Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockGetSubmissionForReview = jest.fn();
const mockSubmitRating = jest.fn();
const mockApproveAndRelease = jest.fn();
const mockHasRated = jest.fn();

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ releaseFunds: jest.fn() }) }));
jest.mock('../../lib/haptic-feedback', () => ({ useHapticFeedback: () => ({ triggerHaptic: jest.fn() }) }));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
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
jest.mock('../../lib/services/ratings', () => ({
  ratingsService: {
    hasRated: (...a: unknown[]) => mockHasRated(...a),
    getAggregatedStats: jest.fn().mockResolvedValue({ averageRating: 0, ratingCount: 0 }),
  },
}));
jest.mock('lib/services/userProfile', () => ({
  userProfileService: { getProfile: jest.fn().mockResolvedValue({ id: 'hunter-1', username: 'ana_hunts' }) },
}));
jest.mock('../../lib/utils/data-utils', () => ({ getCurrentUserId: () => 'poster-1' }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('../../components/attachment-viewer-modal', () => ({ AttachmentViewerModal: () => null }));
jest.mock('../../components/ui/rating-stars', () => {
  const { Text, TouchableOpacity } = require('react-native');
  return {
    RatingStars: ({ onRatingChange }: { onRatingChange: (n: number) => void }) => (
      <TouchableOpacity accessibilityLabel="Give 5 stars" onPress={() => onRatingChange(5)}>
        <Text>stars</Text>
      </TouchableOpacity>
    ),
  };
});

import { PosterReviewModal } from '../../components/poster-review-modal';

const PENDING = {
  id: 's1',
  bounty_id: 'b1',
  hunter_id: 'hunter-1',
  status: 'pending',
  message: 'All cleared out.',
  proof_items: [],
  submitted_at: new Date().toISOString(),
};

function renderModal(
  props: Partial<React.ComponentProps<typeof PosterReviewModal>> = {},
  options: { createNodeMock?: (element: { props: { children?: React.ReactNode } }) => unknown } = {}
) {
  return render(
    <PosterReviewModal
      visible
      bountyId="b1"
      hunterId="hunter-1"
      hunterName="ana_hunts"
      bountyAmount={60}
      isForHonor={false}
      architecture="v1"
      onClose={jest.fn()}
      onComplete={jest.fn()}
      {...props}
    />,
    options
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockHasRated.mockResolvedValue(false);
  mockSubmitRating.mockResolvedValue(undefined);
});

describe('PosterReviewModal from the job page', () => {
  it('review: opening and "Proceed to Payout" release nothing; the irreversible-payout step comes first', async () => {
    mockGetSubmissionForReview.mockResolvedValue(PENDING);
    renderModal();
    expect(await screen.findByText('Proceed to Payout')).toBeTruthy();
    expect(mockGetSubmissionForReview).toHaveBeenCalledWith('b1', 'hunter-1');
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Proceed to Payout'));
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();
    expect(screen.getByText('Once you continue, this action cannot be undone.')).toBeTruthy();
    expect(screen.getByLabelText('Approve and pay $60.00')).toBeTruthy();
    expect(screen.queryByLabelText('Yes, pay $60.00')).toBeNull();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('startOnRating: opens on the rating step even with no submission, and submits the rating once', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    const onComplete = jest.fn();
    renderModal({ startOnRating: true, onComplete });
    expect(await screen.findByText('Rate ana_hunts')).toBeTruthy();
    expect(screen.queryByText('No submission yet')).toBeNull();
    expect(screen.queryByLabelText('Approve and pay $60.00')).toBeNull();
    expect(screen.queryByLabelText('Yes, pay $60.00')).toBeNull();

    fireEvent.press(screen.getByLabelText('Give 5 stars'));
    await act(async () => {
      fireEvent.press(screen.getByText('Submit review'));
    });
    await waitFor(() => expect(mockSubmitRating).toHaveBeenCalledTimes(1));
    expect(mockSubmitRating.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bounty_id: 'b1', to_user_id: 'hunter-1', rating: 5 })
    );
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('startOnRating keeps "Skip for now"', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    const onClose = jest.fn();
    renderModal({ startOnRating: true, onClose });
    fireEvent.press(await screen.findByLabelText('Skip rating for now'));
    expect(onClose).toHaveBeenCalled();
    expect(mockSubmitRating).not.toHaveBeenCalled();
  });

  it('without startOnRating and no submission, it is unchanged ("No submission yet")', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    renderModal();
    expect(await screen.findByText('No submission yet')).toBeTruthy();
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();
  });
});

/**
 * Approve and pay: the two taps (two double taps under VoiceOver/TalkBack,
 * which activate a button's onPress). Found by accessibility label, as a
 * screen reader finds them.
 */
async function approveAndPay(amount = '$60.00') {
  fireEvent.press(screen.getByLabelText(`Approve and pay ${amount}`));
  await act(async () => {
    fireEvent.press(screen.getByLabelText(`Yes, pay ${amount}`));
  });
}

async function openPayoutStep() {
  fireEvent.press(await screen.findByText('Proceed to Payout'));
}

function lastAlertCall(): [string, string, any[]] {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [title, message, buttons] = calls[calls.length - 1];
  return [title, message, buttons ?? []];
}

describe('QA pass 2: accessibility and failure states (2026-11-15)', () => {
  beforeEach(() => {
    mockGetSubmissionForReview.mockResolvedValue(PENDING);
  });

  it('moves screen-reader focus to the payment confirmation question', async () => {
    const confirmationQuestionHostNode = {};
    renderModal({}, {
      createNodeMock: element =>
        element.props.children === 'Pay ana_hunts $60.00?' ? confirmationQuestionHostNode : {},
    });
    await openPayoutStep();
    fireEvent.press(screen.getByLabelText('Approve and pay $60.00'));

    await waitFor(() => {
      expect(AccessibilityInfo.sendAccessibilityEvent).toHaveBeenCalledWith(
        confirmationQuestionHostNode,
        'focus'
      );
    });
  });

  it('approve-and-pay is two labelled buttons; only "Yes, pay" releases, exactly once', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    renderModal();
    await openPayoutStep();

    // Step 1: a plain button. Activating it (a tap, or a screen reader's
    // double tap) only opens the confirmation.
    const approve = screen.getByLabelText('Approve and pay $60.00');
    expect(approve.props.accessibilityRole).toBe('button');
    expect(approve.props.accessibilityHint).toBe('Asks you to confirm first.');
    expect(approve.props.accessibilityHint).not.toMatch(/drag|slide|swipe/i);
    expect(approve.props.accessibilityActions).toBeUndefined();
    fireEvent.press(approve);
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    // Step 2: the confirmation states who is paid, how much, and that it's final.
    expect(screen.getByText('Pay ana_hunts $60.00?')).toBeTruthy();
    expect(screen.getByText("Once you approve, this can't be undone.")).toBeTruthy();
    const yes = screen.getByLabelText('Yes, pay $60.00');
    const notYet = screen.getByLabelText('Not yet');
    for (const button of [yes, notYet]) {
      expect(button.props.accessibilityRole).toBe('button');
      expect(button.props.accessibilityState).toEqual(expect.objectContaining({ disabled: false }));
      expect(button.props.accessibilityHint).not.toMatch(/drag|slide|swipe/i);
    }
    expect(yes.props.accessibilityHint).toBe("This can't be undone.");
    expect(notYet.props.accessibilityHint).toBe('Goes back without paying anything.');
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(yes);
    });
    await waitFor(() => expect(mockApproveAndRelease).toHaveBeenCalledTimes(1));
    expect(mockApproveAndRelease.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bountyId: 'b1', hunterId: 'hunter-1', amount: 60, isForHonor: false })
    );
  });

  it('"Not yet" backs out without paying, and the header back steps back one level', async () => {
    renderModal();
    await openPayoutStep();
    fireEvent.press(screen.getByLabelText('Approve and pay $60.00'));
    fireEvent.press(screen.getByLabelText('Not yet'));
    expect(screen.queryByLabelText('Yes, pay $60.00')).toBeNull();
    expect(screen.getByLabelText('Approve and pay $60.00')).toBeTruthy();
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Approve and pay $60.00'));
    fireEvent.press(screen.getByLabelText('Back to previous step'));
    expect(screen.queryByLabelText('Yes, pay $60.00')).toBeNull();
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('a double tap on "Yes, pay" releases once, and both buttons are disabled while it is in flight', async () => {
    let resolveRelease: (ok: boolean) => void = () => {};
    mockApproveAndRelease.mockReturnValue(new Promise<boolean>(r => { resolveRelease = r; }));
    renderModal();
    await openPayoutStep();
    fireEvent.press(screen.getByLabelText('Approve and pay $60.00'));
    // Both taps inside one render, before the button re-renders as disabled.
    const yes = screen.getByLabelText('Yes, pay $60.00');
    act(() => {
      fireEvent.press(yes);
      fireEvent.press(yes);
    });
    const busy = screen.getByLabelText('Sending payment');
    expect(busy.props.disabled).toBe(true);
    expect(busy.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true, busy: true }));
    expect(screen.getByLabelText('Not yet').props.disabled).toBe(true);
    fireEvent.press(busy);
    await act(async () => {
      resolveRelease(true);
    });
    expect(mockApproveAndRelease).toHaveBeenCalledTimes(1);
  });

  it('a confirmed v1/v2 release says so on the rating step; v3 says it is being processed', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    const { unmount } = renderModal({ architecture: 'v1' });
    await openPayoutStep();
    await approveAndPay();
    expect(await screen.findByTestId('review-approved-banner')).toBeTruthy();
    expect(screen.getByText('Work approved. $60.00 has been released to ana_hunts.')).toBeTruthy();
    unmount();

    renderModal({ architecture: 'v3' });
    await openPayoutStep();
    await approveAndPay();
    expect(
      await screen.findByText('Work approved. Your $60.00 payment to ana_hunts is being processed.')
    ).toBeTruthy();
  });

  it('an unconfirmed release never says "approved" or "nothing was paid", and stays on the confirm step', async () => {
    mockApproveAndRelease.mockResolvedValue(false);
    const onComplete = jest.fn();
    renderModal({ onComplete });
    await openPayoutStep();
    await approveAndPay();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message] = lastAlertCall();
    expect(title).toBe('Payment not confirmed');
    expect(message).not.toMatch(/approved/i);
    expect(message).not.toMatch(/nothing was (paid|charged)/i);
    expect(message).toMatch(/check the job's Payment section/);
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();
    expect(screen.queryByTestId('review-approved-banner')).toBeNull();
    // The "Yes, pay" step is not left armed: back to the single button,
    // enabled again, so a retry is a deliberate two-step choice.
    expect(screen.queryByLabelText('Yes, pay $60.00')).toBeNull();
    expect(screen.getByLabelText('Approve and pay $60.00').props.disabled).toBe(false);
    expect(mockApproveAndRelease).toHaveBeenCalledTimes(1);
    // Closing after a failure is a plain close, not "done".
    fireEvent.press(screen.getByLabelText('Back to previous step'));
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a release error with a reason shows the reason', async () => {
    mockApproveAndRelease.mockRejectedValue(new Error('Your session expired. Sign in again.'));
    renderModal();
    await openPayoutStep();
    await approveAndPay();
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message] = lastAlertCall();
    expect(title).toBe('Payment not confirmed');
    expect(message).toContain('Your session expired. Sign in again.');
  });

  it('closing the sheet after an approval tells the caller to refresh', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    const onClose = jest.fn();
    const onComplete = jest.fn();
    renderModal({ onClose, onComplete });
    await openPayoutStep();
    await approveAndPay();
    await screen.findByTestId('review-approved-banner');
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('a failed load says so with a retry, never "No submission yet"', async () => {
    mockGetSubmissionForReview.mockReset();
    mockGetSubmissionForReview.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(PENDING);
    renderModal();
    expect(await screen.findByText("Couldn't load the submitted work")).toBeTruthy();
    expect(screen.queryByText('No submission yet')).toBeNull();
    expect(screen.queryByText('Proceed to Payout')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(await screen.findByText('Proceed to Payout')).toBeTruthy();
    expect(mockGetSubmissionForReview).toHaveBeenNthCalledWith(1, 'b1', 'hunter-1');
    expect(mockGetSubmissionForReview).toHaveBeenNthCalledWith(2, 'b1', 'hunter-1');
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('the rating-only sheet ignores a failed submission load', async () => {
    mockGetSubmissionForReview.mockRejectedValue(new Error('offline'));
    renderModal({ startOnRating: true });
    expect(await screen.findByText('Rate ana_hunts')).toBeTruthy();
    expect(screen.queryByText("Couldn't load the submitted work")).toBeNull();
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByText('Leave a review')).toBeTruthy();
  });

  it('a failed review save keeps the form and offers "Try again", which resends', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    mockSubmitRating.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    const onClose = jest.fn();
    renderModal({ startOnRating: true, onClose });
    fireEvent.press(await screen.findByLabelText('Give 5 stars'));
    await act(async () => {
      fireEvent.press(screen.getByText('Submit review'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message, buttons] = lastAlertCall();
    expect(title).toBe("Couldn't save your review");
    expect(message).toBe('Your review was not saved. Check your connection and try again.');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Rate ana_hunts')).toBeTruthy();
    await act(async () => {
      buttons.find((b: any) => b.text === 'Try again').onPress();
    });
    await waitFor(() => expect(mockSubmitRating).toHaveBeenCalledTimes(2));
    expect(lastAlertCall()[0]).toBe('Thanks for your review');
  });

  it('a saved review claims nothing about payment', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    renderModal({ startOnRating: true });
    fireEvent.press(await screen.findByLabelText('Give 5 stars'));
    await act(async () => {
      fireEvent.press(screen.getByText('Submit review'));
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message] = lastAlertCall();
    expect(title).toBe('Thanks for your review');
    expect(message).toBe('You rated ana_hunts 5 stars.');
    expect(message).not.toMatch(/payment|released/i);
  });

  it('a double tap on "Submit review" sends one review', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    let resolveRating: () => void = () => {};
    mockSubmitRating.mockReturnValue(new Promise<void>(r => { resolveRating = r; }));
    renderModal({ startOnRating: true });
    fireEvent.press(await screen.findByLabelText('Give 5 stars'));
    // Both taps inside one render, before the button re-renders as disabled.
    const submit = screen.getByLabelText('Submit review');
    act(() => {
      fireEvent.press(submit);
      fireEvent.press(submit);
    });
    await act(async () => {
      resolveRating();
    });
    expect(mockSubmitRating).toHaveBeenCalledTimes(1);
  });

  it('"Submit review" is announced as disabled until a star is chosen', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    renderModal({ startOnRating: true });
    const submit = await screen.findByLabelText('Submit review');
    expect(submit.props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    expect(submit.props.accessibilityHint).toBe('Choose a star rating first');
  });

  it('for-honor jobs confirm "mark complete", never "pay"', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    renderModal({ isForHonor: true, bountyAmount: 0 });
    await openPayoutStep();
    expect(screen.queryByLabelText(/pay/i)).toBeNull();
    fireEvent.press(screen.getByLabelText('Approve and mark complete'));
    expect(screen.getByText('Mark this job complete for ana_hunts?')).toBeTruthy();
    expect(screen.queryByLabelText(/pay/i)).toBeNull();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Yes, mark complete'));
    });
    await waitFor(() => expect(mockApproveAndRelease).toHaveBeenCalledTimes(1));
    expect(mockApproveAndRelease.mock.calls[0][0]).toEqual(expect.objectContaining({ isForHonor: true }));
  });

  it('Android back steps back from the confirm step instead of dropping the poster out', async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await openPayoutStep();
    const { Modal } = require('react-native');
    await act(async () => {
      screen.UNSAFE_getByType(Modal).props.onRequestClose();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Proceed to Payout')).toBeTruthy();
  });
});
