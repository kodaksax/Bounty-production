import {
    getPosterDashboardNextRoute,
    isBountyPoster,
} from '../../../lib/utils/poster-bounty-dashboard';

describe('poster bounty dashboard guards', () => {
  it('recognizes the canonical poster_id ownership field', () => {
    expect(isBountyPoster({ poster_id: 'poster-1', user_id: null } as any, 'poster-1')).toBe(true);
  });

  it('routes the review CTA to the existing review screen', () => {
    expect(getPosterDashboardNextRoute('review_verify', 'bounty-1')).toBe(
      '/postings/bounty-1/review-and-verify'
    );
    expect(getPosterDashboardNextRoute('working_progress', 'bounty-1')).toBeNull();
  });
});
