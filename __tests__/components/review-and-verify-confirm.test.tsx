/**
 * Senior-first poster audit (2026-11-14), fix 3: review-and-verify's
 * "Approve and continue to payment" released the money on one tap. The job
 * page no longer links here (it opens PosterReviewModal), but the screen is
 * still reachable from lib/navigation/manage-route.ts, so it now asks first
 * in the same words as PosterReviewModal. approveAndRelease is untouched and
 * runs only after that confirmation.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';
import { lightTheme } from '../../lib/themes/lightTheme';

const mockApproveAndRelease = jest.fn();

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ bountyId: 'b1' }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: lightTheme }) }));
jest.mock('../../lib/wallet-context', () => ({ useWallet: () => ({ releaseFunds: jest.fn() }) }));
jest.mock('../../lib/utils/data-utils', () => ({ getCurrentUserId: () => 'poster-1' }));
jest.mock('../../components/attachment-viewer-modal', () => ({ AttachmentViewerModal: () => null }));
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../lib/services/bounty-service', () => ({
  bountyService: {
    getById: jest.fn().mockResolvedValue({
      id: 'b1',
      title: 'Clear the garage',
      amount: 60,
      is_for_honor: false,
      status: 'in_progress',
      poster_id: 'poster-1',
      accepted_by: 'hunter-1',
    }),
  },
}));
jest.mock('../../lib/services/bounty-request-service', () => ({
  bountyRequestService: { getAll: jest.fn().mockResolvedValue([]) },
}));
jest.mock('../../lib/services/profile-service', () => ({
  profileService: { getById: jest.fn().mockResolvedValue({ id: 'hunter-1', username: 'ana_hunts' }) },
}));
jest.mock('../../lib/services/ratings', () => ({
  ratingsService: { getAggregatedStats: jest.fn().mockResolvedValue({ averageRating: 0, ratingCount: 0 }) },
}));
jest.mock('../../lib/services/completion-service', () => ({
  completionService: {
    getSubmissionForReview: jest.fn().mockResolvedValue({
      id: 's1',
      bounty_id: 'b1',
      hunter_id: 'hunter-1',
      status: 'pending',
      proof_items: [],
    }),
    approveSubmission: jest.fn(),
    submitRating: jest.fn(),
    requestRevision: jest.fn(),
  },
}));
jest.mock('../../lib/services/completion-approval', () => ({
  approveAndRelease: (...a: unknown[]) => mockApproveAndRelease(...a),
}));

import ReviewAndVerifyScreen from '../../app/postings/[bountyId]/review-and-verify';

function lastAlert() {
  const calls = (Alert.alert as jest.Mock).mock.calls;
  const [title, message, buttons] = calls[calls.length - 1];
  return { title, message, buttons: buttons ?? [] };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockApproveAndRelease.mockResolvedValue(true);
});

describe('review-and-verify approval', () => {
  async function tapApprove() {
    render(<ReviewAndVerifyScreen />);
    const button = await screen.findByText('Approve and continue to payment');
    // Wait until the hunter's pending submission has loaded and enabled it.
    await waitFor(() => expect(screen.getByText('ana_hunts')).toBeTruthy());
    await act(async () => {
      fireEvent.press(button);
    });
  }

  it('asks before releasing, and one tap releases nothing', async () => {
    await tapApprove();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
    const confirm = lastAlert();
    expect(confirm.title).toBe('Complete and release payment?');
    expect(confirm.message).toContain('release $60.00 to ana_hunts');
    expect(confirm.message).toContain('cannot be undone');
  });

  it('"Back to review" releases nothing', async () => {
    await tapApprove();
    const back = lastAlert().buttons.find((b: any) => b.style === 'cancel');
    expect(back.text).toBe('Back to review');
    expect(back.onPress).toBeUndefined();
    expect(mockApproveAndRelease).not.toHaveBeenCalled();
  });

  it('confirming runs the existing approveAndRelease once', async () => {
    await tapApprove();
    const go = lastAlert().buttons.find((b: any) => b.text === 'Release payment');
    await act(async () => {
      go.onPress();
    });
    await waitFor(() => expect(mockApproveAndRelease).toHaveBeenCalledTimes(1));
    expect(mockApproveAndRelease.mock.calls[0][0]).toEqual(
      expect.objectContaining({ bountyId: 'b1', hunterId: 'hunter-1', amount: 60 })
    );
  });

  it('two stacked confirmations (a double tap) release only once', async () => {
    let finish: (v: boolean) => void = () => {};
    mockApproveAndRelease.mockImplementation(() => new Promise(r => (finish = r)));
    await tapApprove();
    const first = lastAlert().buttons.find((b: any) => b.text === 'Release payment');
    // The second tap's dialog, opened before the first was answered.
    const second = first;
    await act(async () => {
      first.onPress();
      second.onPress();
    });
    expect(mockApproveAndRelease).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(true);
    });
  });
});
