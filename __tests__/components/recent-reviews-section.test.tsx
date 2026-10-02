/**
 * Review visibility (trust-spine audit T24). A profile that says "1 review"
 * must show that review -- including a star-only rating, which this section
 * used to filter out -- and say what it represents: who left it, from which
 * side of the job, for which bounty, paid or for honor.
 */
import { render } from '@testing-library/react-native';
import React from 'react';

jest.mock('../../lib/themes/AppThemeContext', () => ({ useAppThemeContext: () => ({ theme: {} }) }));
jest.mock('@expo/vector-icons', () => ({ MaterialIcons: () => null }));
jest.mock('../../components/ReportModal', () => ({ showReportAlert: jest.fn() }));
jest.mock('../../lib/utils/format-relative-date', () => ({ formatRelativeDate: () => '2d ago' }));

const mockUseRatings = jest.fn();
jest.mock('../../hooks/useRatings', () => ({ useRatings: (...args: any[]) => mockUseRatings(...args) }));

import {
  RecentReviewsSection,
  reviewTransactionLabel,
  reviewerLabel,
} from '../../components/recent-reviews-section';

const starOnly = {
  id: 'r1', user_id: 'p1', rater_id: 'h1', bountyId: 'b1', score: 5 as const, comment: undefined,
  createdAt: '2026-10-01T00:00:00Z', raterRole: 'hunter' as const, raterName: 'sam',
  bountyTitle: 'Walk my dog', isForHonor: false,
};

describe('RecentReviewsSection', () => {
  test('"1 review" shows that review even when it is star-only', () => {
    mockUseRatings.mockReturnValue({ ratings: [starOnly], stats: { averageRating: 5, ratingCount: 1 }, loading: false });

    const { getByText } = render(<RecentReviewsSection userId="p1" />);

    expect(getByText('1 review')).toBeTruthy();
    expect(getByText('No written review')).toBeTruthy();
    expect(getByText('Hunter @sam · "Walk my dog" · Paid job')).toBeTruthy();
  });

  test('written reviews render their text', () => {
    mockUseRatings.mockReturnValue({
      ratings: [{ ...starOnly, comment: 'Paid fast, clear instructions' }],
      stats: { averageRating: 5, ratingCount: 1 },
      loading: false,
    });

    const { getByText, queryByText } = render(<RecentReviewsSection userId="p1" />);

    expect(getByText('Paid fast, clear instructions')).toBeTruthy();
    expect(queryByText('No written review')).toBeNull();
  });

  test('no counted reviews -> renders nothing', () => {
    mockUseRatings.mockReturnValue({ ratings: [], stats: { averageRating: 0, ratingCount: 0 }, loading: false });
    const { toJSON } = render(<RecentReviewsSection userId="p1" />);
    expect(toJSON()).toBeNull();
  });

  test('reads the list and the count from the same source', () => {
    mockUseRatings.mockReturnValue({ ratings: [], stats: { averageRating: 0, ratingCount: 0 }, loading: false });
    render(<RecentReviewsSection userId="p1" />);
    const [, options] = mockUseRatings.mock.calls[mockUseRatings.mock.calls.length - 1];
    expect(options?.includeStats).not.toBe(false);
  });
});

describe('review provenance labels', () => {
  test('reviewer label names the role and the person', () => {
    expect(reviewerLabel({ raterRole: 'poster', raterName: 'pat' })).toBe('Poster @pat');
    expect(reviewerLabel({ raterRole: 'hunter', raterName: null })).toBe('Hunter');
    expect(reviewerLabel({})).toBeNull();
  });

  test('a bounty its poster later deleted still reads as a completed bounty', () => {
    expect(reviewTransactionLabel({ bountyId: 'b', bountyTitle: null, isForHonor: true })).toBe('A completed bounty · For honor');
  });

  test('no bounty -> no transaction label', () => {
    expect(reviewTransactionLabel({ bountyId: undefined })).toBeNull();
  });
});
