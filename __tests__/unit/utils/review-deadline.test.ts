/**
 * The 72-hour review window both sides see (trust-spine audit T6).
 * Dates are built in device-local time so the assertions hold in any TZ.
 */
import {
  REVIEW_WINDOW_HOURS,
  formatReviewDeadline,
  getReviewDeadline,
  getReviewDeadlineStatus,
} from '../../../lib/utils/review-deadline';
import {
  resolveBountyLifecycle,
} from '../../../lib/utils/bounty-lifecycle';

// Tuesday 2026-10-06 15:00 local.
const SUBMITTED = new Date(2026, 9, 6, 15, 0);
const HOUR = 3600 * 1000;

describe('getReviewDeadline', () => {
  it('is submitted_at + 72h, matching completion_review_policy.window_hours', () => {
    expect(REVIEW_WINDOW_HOURS).toBe(72);
    expect(getReviewDeadline(SUBMITTED)!.getTime()).toBe(SUBMITTED.getTime() + 72 * HOUR);
    expect(getReviewDeadline(SUBMITTED.toISOString())!.getTime()).toBe(SUBMITTED.getTime() + 72 * HOUR);
  });

  it('returns null without a usable timestamp', () => {
    expect(getReviewDeadline(null)).toBeNull();
    expect(getReviewDeadline(undefined)).toBeNull();
    expect(getReviewDeadline('not a date')).toBeNull();
  });
});

describe('formatReviewDeadline', () => {
  const deadline = new Date(2026, 9, 9, 15, 0); // Friday 3:00 PM

  it('names the weekday within the week', () => {
    expect(formatReviewDeadline(deadline, new Date(2026, 9, 6, 16, 0))).toBe('Friday at 3:00 PM');
  });

  it('says tomorrow / today / yesterday when close', () => {
    expect(formatReviewDeadline(deadline, new Date(2026, 9, 8, 9, 0))).toBe('tomorrow at 3:00 PM');
    expect(formatReviewDeadline(deadline, new Date(2026, 9, 9, 8, 0))).toBe('today at 3:00 PM');
    expect(formatReviewDeadline(deadline, new Date(2026, 9, 10, 8, 0))).toBe('yesterday at 3:00 PM');
  });

  it('formats midnight, noon and minutes', () => {
    const now = new Date(2026, 9, 9, 0, 0);
    expect(formatReviewDeadline(new Date(2026, 9, 9, 0, 5), now)).toBe('today at 12:05 AM');
    expect(formatReviewDeadline(new Date(2026, 9, 9, 12, 30), now)).toBe('today at 12:30 PM');
  });

  it('falls back to a date beyond a week', () => {
    expect(formatReviewDeadline(deadline, new Date(2026, 8, 20, 9, 0))).toBe('Oct 9 at 3:00 PM');
  });
});

describe('getReviewDeadlineStatus', () => {
  const during = new Date(SUBMITTED.getTime() + 30 * HOUR); // Wednesday 9 PM
  const after = new Date(SUBMITTED.getTime() + 73 * HOUR);

  it('tells the hunter when the poster must act, and that Bounty reviews it otherwise', () => {
    const s = getReviewDeadlineStatus(SUBMITTED, 'hunter', during)!;
    expect(s.overdue).toBe(false);
    expect(s.message).toBe(
      "The poster has until Friday at 3:00 PM to approve the work or raise a problem. If they don't respond, Bounty reviews it."
    );
  });

  it('tells the poster the same deadline from their side', () => {
    const s = getReviewDeadlineStatus(SUBMITTED, 'poster', during)!;
    expect(s.message).toBe(
      "You have until Friday at 3:00 PM to approve the work or report a problem. If you don't respond, Bounty reviews it."
    );
  });

  it('after the window: support is reviewing, the poster can still act', () => {
    const h = getReviewDeadlineStatus(SUBMITTED, 'hunter', after)!;
    const p = getReviewDeadlineStatus(SUBMITTED, 'poster', after)!;
    expect(h.overdue).toBe(true);
    expect(h.message).toMatch(/Bounty support is reviewing your work/);
    expect(p.message).toMatch(/Bounty support is reviewing this\. You can still approve/);
  });

  it('never promises automatic payment (Phase A is human review)', () => {
    for (const viewer of ['poster', 'hunter'] as const) {
      for (const now of [during, after]) {
        expect(getReviewDeadlineStatus(SUBMITTED, viewer, now)!.message).not.toMatch(/automatic|auto-?release|paid automatically/i);
      }
    }
  });

  it('is null with no submission timestamp', () => {
    expect(getReviewDeadlineStatus(null, 'poster', during)).toBeNull();
  });
});

describe('resolveBountyLifecycle — review window', () => {
  const inProgress = { id: 'b1', status: 'in_progress', amount: 50, accepted_by: 'h1' };
  const during = new Date(SUBMITTED.getTime() + 30 * HOUR);
  const after = new Date(SUBMITTED.getTime() + 73 * HOUR);

  const poster = (now: Date) =>
    resolveBountyLifecycle({
      bounty: inProgress, role: 'poster', submissionStatus: 'pending',
      submittedAt: SUBMITTED.toISOString(), now,
    });
  const hunter = (now: Date) =>
    resolveBountyLifecycle({
      bounty: inProgress, role: 'hunter', viewerId: 'h1', requestStatus: 'accepted',
      submissionStatus: 'pending', submissionIsMine: true,
      submittedAt: SUBMITTED.toISOString(), now,
    });

  it('both sides see the same deadline', () => {
    const p = poster(during);
    const h = hunter(during);
    expect(p.reviewDeadline).toBe(h.reviewDeadline);
    expect(p.reviewDeadline).toBe(new Date(SUBMITTED.getTime() + 72 * HOUR).toISOString());
    expect(p.nextStep).toMatch(/^You have until Friday at 3:00 PM/);
    expect(h.nextStep).toMatch(/^The poster has until Friday at 3:00 PM/);
    expect(p.waitingOn).toBe('you');
    expect(h.waitingOn).toBe('other');
  });

  it('after the window the hunter waits on support; the poster can still act', () => {
    const p = poster(after);
    const h = hunter(after);
    expect(h.waitingOn).toBe('support');
    expect(h.headline).toBe('Submitted — Bounty is reviewing');
    expect(p.waitingOn).toBe('you');
    expect(p.primaryAction?.key).toBe('review_submission');
    expect(p.tone).toBe('warning');
  });

  it('the poster can report a problem from review', () => {
    const p = poster(during);
    expect(p.secondaryActions.find((a) => a.key === 'open_dispute')?.label).toBe('Report a problem');
  });

  it('without a submission timestamp the copy falls back and no deadline is claimed', () => {
    const p = resolveBountyLifecycle({ bounty: inProgress, role: 'poster', submissionStatus: 'pending' });
    expect(p.reviewDeadline ?? null).toBeNull();
    expect(p.nextStep).toMatch(/^Approve it to release \$50/);
  });

  it('no deadline once the work is no longer pending', () => {
    const p = resolveBountyLifecycle({
      bounty: inProgress, role: 'poster', submissionStatus: 'revision_requested',
      submittedAt: SUBMITTED.toISOString(), now: after,
    });
    expect(p.reviewDeadline ?? null).toBeNull();
  });

  it('an open dispute outranks the deadline', () => {
    const p = resolveBountyLifecycle({
      bounty: inProgress, role: 'poster', submissionStatus: 'pending', hasDispute: true,
      submittedAt: SUBMITTED.toISOString(), now: after,
    });
    expect(p.headline).toBe('Dispute under review');
    expect(p.reviewDeadline ?? null).toBeNull();
  });
});

describe('resolveBountyLifecycle — poster recourse while the hunter works (T22)', () => {
  it('offers "Report a problem", never a poster cancel', () => {
    const s = resolveBountyLifecycle({
      bounty: { id: 'b1', status: 'in_progress', amount: 50, accepted_by: 'h1' },
      role: 'poster',
    });
    const keys = [s.primaryAction?.key, ...s.secondaryActions.map((a) => a.key)];
    expect(keys).not.toContain('cancel_bounty');
    expect(s.secondaryActions.find((a) => a.key === 'open_dispute')?.label).toBe('Report a problem');
  });

  it('the hunter keeps their own cancellation route', () => {
    const s = resolveBountyLifecycle({
      bounty: { id: 'b1', status: 'in_progress', amount: 50, accepted_by: 'h1' },
      role: 'hunter', viewerId: 'h1', requestStatus: 'accepted',
    });
    expect(s.secondaryActions.map((a) => a.key)).toContain('cancel_bounty');
  });
});
