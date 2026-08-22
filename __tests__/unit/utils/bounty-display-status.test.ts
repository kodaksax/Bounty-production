/**
 * Unit tests for bounty-display-status — the helper that resolves the badge a
 * bounty card shows, and which the Postings screen filter chips select on.
 *
 * The bugs these lock down: the "In Progress" chip listing bounties whose badge
 * read REJECTED or SUBMITTED FOR REVIEW, and the "Review" chip listing a bounty
 * that was still plain IN PROGRESS.
 */

import {
  BOUNTY_DISPLAY_STATUS_LABELS,
  getBountyDisplayStatus,
} from '../../../lib/utils/bounty-display-status';

const FUTURE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 1000).toISOString();

describe('getBountyDisplayStatus', () => {
  it('reports plain in_progress for accepted work with no submission yet', () => {
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: FUTURE },
        requestStatus: 'accepted',
      })
    ).toBe('in_progress');
  });

  it('reports submitted_for_review once the hunter has a pending submission', () => {
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: FUTURE },
        requestStatus: 'accepted',
        submittedForReview: true,
      })
    ).toBe('submitted_for_review');
  });

  it('reports review_needed for the poster of a bounty with a pending submission', () => {
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: FUTURE },
        reviewNeeded: true,
      })
    ).toBe('review_needed');
  });

  it('reports rejected when the viewer was turned down, even if the bounty moved to in_progress', () => {
    // The poster accepted someone else, so bounty.status is in_progress — but
    // this viewer's card reads REJECTED and must not appear under "In Progress".
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: FUTURE },
        requestStatus: 'rejected',
      })
    ).toBe('rejected');
  });

  it('reports applied only while the bounty is still open', () => {
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'open', end_date: FUTURE },
        requestStatus: 'pending',
      })
    ).toBe('applied');

    // Same pending request, but the bounty was awarded to another hunter.
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: FUTURE },
        requestStatus: 'pending',
      })
    ).toBe('in_progress');
  });

  it('lets a passed deadline mask open/in_progress statuses', () => {
    expect(
      getBountyDisplayStatus({ bounty: { status: 'open', end_date: PAST }, requestStatus: 'pending' })
    ).toBe('deadline_passed');
    expect(getBountyDisplayStatus({ bounty: { status: 'in_progress', end_date: PAST } })).toBe(
      'deadline_passed'
    );
  });

  it('keeps review overlays ahead of a passed deadline', () => {
    expect(
      getBountyDisplayStatus({ bounty: { status: 'in_progress', end_date: PAST }, reviewNeeded: true })
    ).toBe('review_needed');
    expect(
      getBountyDisplayStatus({
        bounty: { status: 'in_progress', end_date: PAST },
        submittedForReview: true,
      })
    ).toBe('submitted_for_review');
  });

  it('passes terminal statuses through untouched', () => {
    expect(getBountyDisplayStatus({ bounty: { status: 'completed', end_date: PAST } })).toBe(
      'completed'
    );
    expect(getBountyDisplayStatus({ bounty: { status: 'cancelled' } })).toBe('cancelled');
    expect(getBountyDisplayStatus({ bounty: { status: 'archived' } })).toBe('archived');
    expect(getBountyDisplayStatus({ bounty: { status: 'cancellation_requested' } })).toBe(
      'cancellation_requested'
    );
  });

  it('falls back to open for an unknown status', () => {
    expect(getBountyDisplayStatus({ bounty: { status: 'something_new' } })).toBe('open');
    expect(getBountyDisplayStatus({ bounty: {} })).toBe('open');
  });

  it('has a label for every display status', () => {
    expect(BOUNTY_DISPLAY_STATUS_LABELS.submitted_for_review).toBe('SUBMITTED FOR REVIEW');
    expect(BOUNTY_DISPLAY_STATUS_LABELS.review_needed).toBe('REVIEW NEEDED');
    expect(BOUNTY_DISPLAY_STATUS_LABELS.in_progress).toBe('IN PROGRESS');
    expect(BOUNTY_DISPLAY_STATUS_LABELS.rejected).toBe('REJECTED');
  });
});
