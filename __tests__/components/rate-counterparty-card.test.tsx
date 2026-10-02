/**
 * Hunter -> poster rating card (components/rate-counterparty-card.tsx).
 * Server decides eligibility; the card only renders for a party who can still
 * rate, submits through the same completionService.submitRating as the
 * poster flow, tags analytics with the rater's role, and is always skippable.
 */
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));

const mockGetStatus = jest.fn();
jest.mock('../../lib/services/ratings', () => ({
  ratingsService: { getMyRatingStatus: (...a: any[]) => mockGetStatus(...a) },
}));
const mockSubmit = jest.fn();
jest.mock('../../lib/services/completion-service', () => ({
  completionService: { submitRating: (...a: any[]) => mockSubmit(...a) },
}));
const mockTrack = jest.fn().mockResolvedValue(undefined);
jest.mock('../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: any[]) => mockTrack(...a) },
}));

import { RateCounterpartyCard } from '../../components/rate-counterparty-card';

const eligibleHunter = { raterRole: 'hunter', rateeId: 'poster-1', rateeName: 'pat', eligible: true, alreadyRated: false };

beforeEach(() => jest.clearAllMocks());

test('renders nothing when the server says the user is not a party', async () => {
  mockGetStatus.mockResolvedValue(null);
  const { toJSON } = render(<RateCounterpartyCard bountyId="b1" />);
  await waitFor(() => expect(mockGetStatus).toHaveBeenCalledWith('b1'));
  expect(toJSON()).toBeNull();
});

test('renders nothing before completion or after rating', async () => {
  for (const s of [{ ...eligibleHunter, eligible: false }, { ...eligibleHunter, alreadyRated: true }]) {
    mockGetStatus.mockResolvedValue(s);
    const { toJSON, unmount } = render(<RateCounterpartyCard bountyId="b1" />);
    await waitFor(() => expect(mockGetStatus).toHaveBeenCalled());
    expect(toJSON()).toBeNull();
    unmount();
  }
});

test('hunter rates the poster through the shared rating pipeline', async () => {
  mockGetStatus.mockResolvedValue(eligibleHunter);
  mockSubmit.mockResolvedValue({ id: 'r1' });
  const { findByText, getByLabelText, getByText } = render(<RateCounterpartyCard bountyId="b1" />);

  expect(await findByText('Rate @pat')).toBeTruthy();
  expect(mockTrack).toHaveBeenCalledWith('rating_prompt_shown', { bountyId: 'b1', role: 'hunter' });

  fireEvent.press(getByLabelText('4 stars'));
  fireEvent.changeText(getByLabelText('Optional written review'), '  Clear brief, paid on time  ');
  fireEvent.press(getByText('Submit rating'));

  await findByText('Thanks for rating @pat');
  expect(mockSubmit).toHaveBeenCalledWith({
    bounty_id: 'b1',
    from_user_id: '',
    to_user_id: 'poster-1',
    rating: 4,
    comment: 'Clear brief, paid on time',
  });
  expect(mockTrack).toHaveBeenCalledWith('rating_submitted', { bountyId: 'b1', role: 'hunter', rating: 4, hasComment: true });
  expect(mockTrack).toHaveBeenCalledWith('review_submitted', { bountyId: 'b1', role: 'hunter' });
});

test('a server rejection keeps the form with an error instead of claiming success', async () => {
  mockGetStatus.mockResolvedValue(eligibleHunter);
  mockSubmit.mockRejectedValue(new Error('rating_requires_completed_transaction'));
  const { findByText, getByLabelText, getByText, queryByText } = render(<RateCounterpartyCard bountyId="b1" />);

  await findByText('Rate @pat');
  fireEvent.press(getByLabelText('5 stars'));
  fireEvent.press(getByText('Submit rating'));

  expect(await findByText("Your rating couldn't be saved. Please try again.")).toBeTruthy();
  expect(queryByText('Thanks for rating @pat')).toBeNull();
});

test('skipping hides the card and records rating_skipped', async () => {
  mockGetStatus.mockResolvedValue(eligibleHunter);
  const { findByText, getByLabelText, toJSON } = render(<RateCounterpartyCard bountyId="b1" />);

  await findByText('Rate @pat');
  fireEvent.press(getByLabelText('Skip rating for now'));

  expect(mockTrack).toHaveBeenCalledWith('rating_skipped', { bountyId: 'b1', role: 'hunter' });
  expect(toJSON()).toBeNull();
  expect(mockSubmit).not.toHaveBeenCalled();
});
