import { buildBountyThreadEvents, threadNeedsViewer } from '../../../lib/utils/bounty-thread-events';

const POSTER = 'poster-1';
const HUNTER = 'hunter-1';

const baseBounty = {
  id: 'b-1',
  status: 'open',
  created_at: '2026-01-01T10:00:00Z',
  amount: 50,
  is_for_honor: false,
};

const pendingRequest = {
  id: 'r-1',
  status: 'pending',
  hunter_id: HUNTER,
  message: 'I can do this',
  created_at: '2026-01-01T11:00:00Z',
};

const kinds = (events: ReturnType<typeof buildBountyThreadEvents>) => events.map(e => e.kind);

describe('buildBountyThreadEvents', () => {
  it('gives the poster accept/decline on a pending application', () => {
    const events = buildBountyThreadEvents({
      role: 'poster',
      viewerId: POSTER,
      bounty: baseBounty,
      request: pendingRequest,
    });
    expect(kinds(events)).toEqual(['posted', 'applied']);
    const applied = events[1];
    expect(applied.actor).toBe('hunter');
    expect(applied.action).toBe('accept_or_decline');
    expect(applied.yourTurn).toBe(true);
    expect(applied.note).toBe('I can do this');
  });

  it('gives the hunter withdraw (not their turn) on their own pending application', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: baseBounty,
      request: pendingRequest,
    });
    expect(events[1].action).toBe('withdraw');
    expect(threadNeedsViewer(events)).toBe(false);
  });

  it('puts the submit action on the hunter once hired', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...baseBounty, status: 'in_progress', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted', accepted_at: '2026-01-01T12:00:00Z' },
    });
    expect(kinds(events)).toEqual(['posted', 'applied', 'hired']);
    const hired = events[2];
    expect(hired.actor).toBe('poster');
    expect(hired.action).toBe('submit_work');
    expect(hired.yourTurn).toBe(true);
  });

  it('hands the turn to the poster when work is submitted', () => {
    const input = {
      viewerId: POSTER,
      bounty: { ...baseBounty, status: 'in_progress', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted' },
      submission: { id: 's-1', status: 'pending', hunter_id: HUNTER, proof_items: [{}, {}], submitted_at: '2026-01-02T10:00:00Z' },
    };
    const posterEvents = buildBountyThreadEvents({ ...input, role: 'poster' });
    const submitted = posterEvents.find(e => e.kind === 'work_submitted')!;
    expect(submitted.action).toBe('review_and_pay');
    expect(submitted.yourTurn).toBe(true);
    expect(submitted.meta?.proofCount).toBe(2);
    // The hired card is superseded and no longer offers submit.
    expect(posterEvents.find(e => e.kind === 'hired')!.live).toBe(false);

    const hunterEvents = buildBountyThreadEvents({ ...input, role: 'hunter', viewerId: HUNTER });
    expect(threadNeedsViewer(hunterEvents)).toBe(false);
  });

  it('returns the turn to the hunter on a revision request', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...baseBounty, status: 'in_progress', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted' },
      submission: { status: 'revision_requested', poster_feedback: 'More photos please' },
    });
    const revision = events.find(e => e.kind === 'revision_requested')!;
    expect(revision.action).toBe('resubmit_work');
    expect(revision.note).toBe('More photos please');
  });

  it('locks workflow actions while a dispute is open', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...baseBounty, status: 'in_progress', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted' },
      dispute: { id: 'd-1', status: 'open', initiatorId: POSTER, createdAt: '2026-01-03T00:00:00Z' },
    });
    expect(events.find(e => e.kind === 'hired')!.action).toBeNull();
    const dispute = events.find(e => e.kind === 'dispute_opened')!;
    expect(dispute.actor).toBe('poster');
    expect(dispute.action).toBe('view_dispute');
  });

  it('ends with a payout card the hunter can open', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...baseBounty, status: 'completed', accepted_by: HUNTER, completed_at: '2026-01-04T00:00:00Z' },
      request: { ...pendingRequest, status: 'accepted' },
      submission: { status: 'approved', submitted_at: '2026-01-03T00:00:00Z' },
    });
    const paid = events[events.length - 1];
    expect(paid.kind).toBe('paid');
    expect(paid.action).toBe('view_payout');
    expect(paid.meta?.amount).toBe(50);
  });

  it('keeps lifecycle cards in order when timestamps are missing', () => {
    const events = buildBountyThreadEvents({
      role: 'poster',
      viewerId: POSTER,
      bounty: { ...baseBounty, status: 'completed', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted' },
      submission: { status: 'approved' },
    });
    const times = events.map(e => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
  });

  it('tells a passed-over hunter they were not selected and stops there', () => {
    const events = buildBountyThreadEvents({
      role: 'hunter',
      viewerId: HUNTER,
      bounty: { ...baseBounty, status: 'in_progress', accepted_by: 'someone-else' },
      request: pendingRequest,
    });
    expect(kinds(events)).toEqual(['posted', 'applied', 'application_declined']);
    expect(events[2].action).toBe('dismiss');
  });

  it('gives the non-requesting party the cancellation response', () => {
    const input = {
      viewerId: POSTER,
      bounty: { ...baseBounty, status: 'cancellation_requested', accepted_by: HUNTER },
      request: { ...pendingRequest, status: 'accepted' },
      cancellation: { id: 'c-1', status: 'pending', requester_type: 'hunter' as const, reason: 'Sick' },
    };
    const poster = buildBountyThreadEvents({ ...input, role: 'poster' });
    expect(poster.find(e => e.kind === 'cancellation_requested')!.action).toBe('respond_cancellation');
    const hunter = buildBountyThreadEvents({ ...input, role: 'hunter', viewerId: HUNTER });
    expect(hunter.find(e => e.kind === 'cancellation_requested')!.action).toBe('view_cancellation');
  });
});
