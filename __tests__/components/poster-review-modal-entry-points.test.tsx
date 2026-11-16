/**
 * Senior-first poster audit (2026-11-14), fixes 3 and 6: the job page now
 * opens PosterReviewModal for both the completion review and "Leave a review".
 *
 *  - Review (fix 3): opening it releases nothing. "Proceed to Payout" leads
 *    to the "Complete and release payment? … cannot be undone" step with its
 *    slide-to-confirm. approveAndRelease runs only from that slide.
 *  - startOnRating (fix 6): opens straight on the rating step, even for a
 *    completed job with no submission row (the payout screen's toggle can
 *    complete one without it). It submits through completionService.submitRating
 *    and never reaches approval or payout.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
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

// The global jest.setup react-native mock has no Animated.add / PanResponder,
// which the payout step's slide-to-confirm builds on. Only rendering that
// step matters here, so inert stand-ins are enough.
{
  const RN = require('react-native');
  const value = () => ({ setValue: jest.fn(), interpolate: jest.fn(() => 0), addListener: jest.fn(), removeAllListeners: jest.fn() });
  RN.Animated = RN.Animated ?? {};
  RN.Animated.Value = RN.Animated.Value ?? jest.fn(value);
  RN.Animated.add = jest.fn(value);
  RN.Animated.spring = RN.Animated.spring ?? jest.fn(() => ({ start: jest.fn() }));
  RN.Animated.timing = RN.Animated.timing ?? jest.fn(() => ({ start: jest.fn() }));
  RN.Animated.View = RN.Animated.View ?? 'Animated.View';
  RN.PanResponder = RN.PanResponder ?? { create: () => ({ panHandlers: {} }) };
}

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

function renderModal(props: Partial<React.ComponentProps<typeof PosterReviewModal>> = {}) {
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
    />
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
    expect(screen.getByLabelText('Slide to confirm payout')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('startOnRating: opens on the rating step even with no submission, and submits the rating once', async () => {
    mockGetSubmissionForReview.mockResolvedValue(null);
    const onComplete = jest.fn();
    renderModal({ startOnRating: true, onComplete });
    expect(await screen.findByText('Rate ana_hunts')).toBeTruthy();
    expect(screen.queryByText('No submission yet')).toBeNull();
    expect(screen.queryByText('Slide to confirm payout')).toBeNull();

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

/** The slide control's screen-reader / switch-control alternative: a double tap. */
function activateSlider(label = 'Slide to confirm payout') {
  fireEvent(screen.getByLabelText(label), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
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

  it('the slide-to-confirm has a non-drag alternative that confirms exactly once, with an accurate hint', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    renderModal();
    await openPayoutStep();
    const handle = screen.getByLabelText('Slide to confirm payout');
    expect(handle.props.accessibilityHint).toBe('Double tap to confirm. This cannot be undone.');
    expect(handle.props.accessibilityHint).not.toMatch(/drag/i);
    expect(handle.props.accessibilityActions).toEqual([{ name: 'activate', label: 'Slide to confirm payout' }]);
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
    await act(async () => {
      activateSlider();
    });
    await waitFor(() => expect(mockApproveAndRelease).toHaveBeenCalledTimes(1));
    expect(mockApproveAndRelease.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bountyId: 'b1', hunterId: 'hunter-1', amount: 60, isForHonor: false })
    );
  });

  it('a confirmed v1/v2 release says so on the rating step; v3 says it is being processed', async () => {
    mockApproveAndRelease.mockResolvedValue(true);
    const { unmount } = renderModal({ architecture: 'v1' });
    await openPayoutStep();
    await act(async () => {
      activateSlider();
    });
    expect(await screen.findByTestId('review-approved-banner')).toBeTruthy();
    expect(screen.getByText('Work approved. $60.00 has been released to ana_hunts.')).toBeTruthy();
    unmount();

    renderModal({ architecture: 'v3' });
    await openPayoutStep();
    await act(async () => {
      activateSlider();
    });
    expect(
      await screen.findByText('Work approved. Your $60.00 payment to ana_hunts is being processed.')
    ).toBeTruthy();
  });

  it('an unconfirmed release never says "approved" or "nothing was paid", and stays on the confirm step', async () => {
    mockApproveAndRelease.mockResolvedValue(false);
    const onComplete = jest.fn();
    renderModal({ onComplete });
    await openPayoutStep();
    await act(async () => {
      activateSlider();
    });
    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [title, message] = lastAlertCall();
    expect(title).toBe('Payment not confirmed');
    expect(message).not.toMatch(/approved/i);
    expect(message).not.toMatch(/nothing was (paid|charged)/i);
    expect(message).toMatch(/check the job's Payment section/);
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();
    expect(screen.queryByTestId('review-approved-banner')).toBeNull();
    // Closing after a failure is a plain close, not "done".
    fireEvent.press(screen.getByLabelText('Back to previous step'));
    fireEvent.press(screen.getByLabelText('Close'));
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('a release error with a reason shows the reason', async () => {
    mockApproveAndRelease.mockRejectedValue(new Error('Your session expired. Sign in again.'));
    renderModal();
    await openPayoutStep();
    await act(async () => {
      activateSlider();
    });
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
    await act(async () => {
      activateSlider();
    });
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

  it('for-honor jobs slide to "mark complete", not "payout"', async () => {
    renderModal({ isForHonor: true, bountyAmount: 0 });
    await openPayoutStep();
    expect(screen.getByLabelText('Slide to mark complete')).toBeTruthy();
    expect(screen.queryByLabelText('Slide to confirm payout')).toBeNull();
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
