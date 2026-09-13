// momentsService.enqueue() now emits `moment_event_enqueued` -- previously
// only hooks/useBountyForm.ts tracked this from one narrow call site, which
// left every other enqueue() caller (stripe_connect_onboarding,
// inactive_user_return, backfill's post_first_bounty/accept_first_bounty)
// untracked. See momentsService.ts's enqueue() comment for the 15-day dark
// finding that motivated centralizing it here.
//
// This pins down: fires once on a fresh/re-armed upsert, does NOT fire on
// the metadata-merge branch (queue state didn't change), and does NOT fire
// when the upsert itself errors (nothing was actually persisted).

const mockTrackEvent = jest.fn().mockResolvedValue(undefined);
const upsert = jest.fn(() => Promise.resolve({ error: null }));
const update = jest.fn(() => ({
  eq: jest.fn(() => ({ eq: jest.fn(() => Promise.resolve({ error: null })) })),
}));
const maybeSingle = jest.fn(() => Promise.resolve({ data: null, error: null }));
const eqChain = { eq: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle })) })) };
const select = jest.fn(() => eqChain);
const from = jest.fn(() => ({ select, upsert, update }));

jest.mock('@sentry/react-native');
jest.mock('../../../../lib/supabase', () => ({
  supabase: { from },
}));
jest.mock('../../../../lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));

import { momentsService } from '../../../../lib/moments/momentsService';

function mockExistingRow(row: Record<string, unknown> | null) {
  maybeSingle.mockResolvedValueOnce({ data: row, error: null });
}

describe('momentsService.enqueue analytics', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    upsert.mockClear();
    from.mockClear();
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('fires moment_event_enqueued when there is no existing row (fresh enqueue)', async () => {
    mockExistingRow(null);

    await momentsService.enqueue('user-1', 'stripe_connect_onboarding', { bountyId: 'b1' });

    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'user-1', moment_type: 'stripe_connect_onboarding', status: 'pending', metadata: { bountyId: 'b1' } },
      { onConflict: 'user_id,moment_type' }
    );
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('moment_event_enqueued', {
      momentType: 'stripe_connect_onboarding',
      source: 'moments_service',
    });
  });

  it('fires moment_event_enqueued when re-arming a completed (recurring) moment', async () => {
    mockExistingRow({ status: 'completed', metadata: {} });

    await momentsService.enqueue('user-1', 'inactive_user_return');

    expect(upsert).toHaveBeenCalled();
    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
  });

  it('does not fire on the metadata-merge path (already shown/pending)', async () => {
    mockExistingRow({ status: 'shown', metadata: { bountyId: 'old' } });

    await momentsService.enqueue('user-1', 'stripe_connect_onboarding', { bountyId: 'new' });

    expect(upsert).not.toHaveBeenCalled();
    expect(mockTrackEvent).not.toHaveBeenCalled();
  });

  it('does not fire when the upsert returns an error', async () => {
    mockExistingRow(null);
    upsert.mockReturnValueOnce(Promise.resolve({ error: { message: 'boom' } }));

    await momentsService.enqueue('user-1', 'stripe_connect_onboarding');

    expect(mockTrackEvent).not.toHaveBeenCalled();
  });
});
