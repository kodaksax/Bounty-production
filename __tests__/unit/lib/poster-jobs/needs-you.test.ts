/**
 * lib/poster-jobs/needs-you.ts: "does one of her jobs need her?" comes from
 * the job page's own next step (posterNextStep), plus any open dispute or
 * report on the job, whoever filed it.
 */
import { posterJobNeedsYou, posterJobNextStep, type PosterJobFacts } from '../../../../lib/poster-jobs/needs-you';

const NOW = new Date('2026-11-17T12:00:00Z');
const HOUR = 3600_000;

function job(over: Partial<PosterJobFacts> = {}, bounty: Partial<PosterJobFacts['bounty']> = {}): PosterJobFacts {
  return {
    bounty: {
      id: 'job-1',
      status: 'open',
      amount: 80,
      is_for_honor: false,
      accepted_by: null,
      end_date: null,
      ...bounty,
    } as PosterJobFacts['bounty'],
    offerCount: 0,
    submissionStatus: null,
    submittedAt: null,
    hasDispute: false,
    hasCancellationRequest: false,
    cancellationRequestedByRole: null,
    hiredAt: null,
    lastHelperMessageAt: null,
    messagesKnown: false,
    ...over,
  };
}

const hired = { status: 'in_progress', accepted_by: 'helper-1' } as const;

describe('posterJobNeedsYou', () => {
  it('offers waiting: yes', () => {
    const facts = job({ offerCount: 3 });
    expect(posterJobNextStep(facts, NOW).whoActsLabel).toBe('Your move');
    expect(posterJobNeedsYou(facts, NOW)).toBe(true);
  });

  it('a live job with no offers yet: no', () => {
    expect(posterJobNeedsYou(job(), NOW)).toBe(false);
  });

  it('work to approve: yes', () => {
    const facts = job(
      { submissionStatus: 'pending', submittedAt: new Date(NOW.getTime() - HOUR).toISOString() },
      hired
    );
    expect(posterJobNextStep(facts, NOW).primary?.key).toBe('check_work');
    expect(posterJobNeedsYou(facts, NOW)).toBe(true);
  });

  it('"Haven\'t heard from…": chosen 3 days ago, no message since: yes', () => {
    const facts = job(
      {
        hiredAt: new Date(NOW.getTime() - 72 * HOUR).toISOString(),
        lastHelperMessageAt: null,
        messagesKnown: true,
      },
      hired
    );
    expect(posterJobNextStep(facts, NOW).title).toMatch(/^Haven't heard from/);
    expect(posterJobNeedsYou(facts, NOW)).toBe(true);
  });

  it('a helper who is in touch, or a messages read that failed: no', () => {
    const base = { hiredAt: new Date(NOW.getTime() - 72 * HOUR).toISOString() };
    expect(
      posterJobNeedsYou(
        job({ ...base, lastHelperMessageAt: new Date(NOW.getTime() - HOUR).toISOString(), messagesKnown: true }, hired),
        NOW
      )
    ).toBe(false);
    // Unknown is never "quiet".
    expect(posterJobNeedsYou(job({ ...base, messagesKnown: false }, hired), NOW)).toBe(false);
  });

  it('an open dispute or report, whoever filed it: yes', () => {
    expect(posterJobNeedsYou(job({ hasDispute: true }, hired), NOW)).toBe(true);
    // Even on a job that would otherwise be waiting on the helper.
    expect(posterJobNextStep(job({ hasDispute: true }, hired), NOW).whoActs).toBe('bounty');
  });

  it('a cancellation she must answer: yes; one she asked for: no', () => {
    expect(
      posterJobNeedsYou(job({ hasCancellationRequest: true, cancellationRequestedByRole: 'hunter' }, hired), NOW)
    ).toBe(true);
    expect(
      posterJobNeedsYou(job({ hasCancellationRequest: true, cancellationRequestedByRole: 'poster' }, hired), NOW)
    ).toBe(false);
  });

  it('a helper doing the job, recently chosen: no', () => {
    const facts = job(
      { hiredAt: new Date(NOW.getTime() - 2 * HOUR).toISOString(), messagesKnown: true },
      hired
    );
    expect(posterJobNextStep(facts, NOW).whoActs).toBe('helper');
    expect(posterJobNeedsYou(facts, NOW)).toBe(false);
  });
});
