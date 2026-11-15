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

const mockGetSubmission = jest.fn();
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
    getSubmission: (...a: unknown[]) => mockGetSubmission(...a),
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
    mockGetSubmission.mockResolvedValue(PENDING);
    renderModal();
    expect(await screen.findByText('Proceed to Payout')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Proceed to Payout'));
    expect(screen.getByText('Complete and release payment?')).toBeTruthy();
    expect(screen.getByText('Once you continue, this action cannot be undone.')).toBeTruthy();
    expect(screen.getByLabelText('Slide to confirm payout')).toBeTruthy();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('startOnRating: opens on the rating step even with no submission, and submits the rating once', async () => {
    mockGetSubmission.mockResolvedValue(null);
    const onComplete = jest.fn();
    renderModal({ startOnRating: true, onComplete });
    expect(await screen.findByText('Rate ana_hunts')).toBeTruthy();
    expect(screen.queryByText('No submission yet')).toBeNull();
    expect(screen.queryByText('Slide to confirm payout')).toBeNull();

    fireEvent.press(screen.getByLabelText('Give 5 stars'));
    await act(async () => {
      fireEvent.press(screen.getByText('Complete Bounty & Rate Hunter'));
    });
    await waitFor(() => expect(mockSubmitRating).toHaveBeenCalledTimes(1));
    expect(mockSubmitRating.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bounty_id: 'b1', to_user_id: 'hunter-1', rating: 5 })
    );
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('startOnRating keeps "Skip for now"', async () => {
    mockGetSubmission.mockResolvedValue(null);
    const onClose = jest.fn();
    renderModal({ startOnRating: true, onClose });
    fireEvent.press(await screen.findByLabelText('Skip rating for now'));
    expect(onClose).toHaveBeenCalled();
    expect(mockSubmitRating).not.toHaveBeenCalled();
  });

  it('without startOnRating and no submission, it is unchanged ("No submission yet")', async () => {
    mockGetSubmission.mockResolvedValue(null);
    renderModal();
    expect(await screen.findByText('No submission yet')).toBeTruthy();
    expect(screen.queryByText('Rate ana_hunts')).toBeNull();
  });
});
