/**
 * buildDraftFromBounty (app/services/postAgain.ts): "Post again" copies a
 * past bounty into a fresh composer draft, for its poster only.
 *
 * Pins what is copied (the job and where it is), what is not (schedule,
 * status, attachments, applicants, trust tier), and that another user's bounty
 * id — including the hunter who did the job — copies nothing and never asks
 * for the exact address.
 */

const mockMaybeSingle = jest.fn();
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockSelect = jest.fn((_columns: string) => ({ eq: mockEq }));
const mockFrom = jest.fn((_table: string) => ({ select: mockSelect }));
const mockRpc = jest.fn();
const mockGetSession = jest.fn();

jest.mock('lib/supabase', () => ({
  supabase: {
    from: (table: string) => mockFrom(table),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getSession: () => mockGetSession() },
  },
}));

import { buildDraftFromBounty, draftFromBounty, PostAgainError } from 'app/services/postAgain';

const POSTER = 'poster-1';
const STRANGER = 'stranger-2';

/** A cancelled in-person bounty, with everything a real row carries. */
const cancelledRow = {
  id: 'b-trash',
  poster_id: POSTER,
  user_id: POSTER,
  title: 'Haul away yard trash',
  description: 'Six bags of yard waste and an old grill by the side gate.',
  category: 'labor',
  work_type: 'in_person',
  amount: 45,
  is_for_honor: false,
  zip_code: '78704',
  neighborhood: 'Bouldin Creek',
  // Present on the row, but must not be selected or copied:
  status: 'cancelled',
  start_date: '2026-10-01T15:00:00Z',
  end_date: '2026-10-02T15:00:00Z',
  schedule_type: 'scheduled',
  attachments_json: [{ id: 'a1', url: 'https://x/y.jpg' }],
  accepted_by: 'hunter-9',
  trust_tier: 'high_trust',
  requires_id_verified: true,
  location: 'Austin, TX',
};

const exactLocation = {
  location: '1200 S 1st St, Austin, TX 78704',
  latitude: 30.2513,
  longitude: -97.7543,
  unit: 'Apt 4',
};

function rowReturns(row: unknown, error: unknown = null) {
  mockMaybeSingle.mockResolvedValue({ data: row, error });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: POSTER } } } });
  mockRpc.mockResolvedValue({ data: [exactLocation], error: null });
});

describe('buildDraftFromBounty — what is copied', () => {
  it('copies title, description, category, work type and amount', async () => {
    rowReturns(cancelledRow);
    const draft = await buildDraftFromBounty('b-trash', POSTER);

    expect(draft).toMatchObject({
      title: 'Haul away yard trash',
      description: 'Six bags of yard waste and an old grill by the side gate.',
      category: 'labor',
      workType: 'in_person',
      amount: 45,
      isForHonor: false,
    });
  });

  it('copies the exact address, coordinates, unit and ZIP via get_bounty_exact_location', async () => {
    rowReturns(cancelledRow);
    const draft = await buildDraftFromBounty('b-trash', POSTER);

    expect(mockRpc).toHaveBeenCalledWith('get_bounty_exact_location', { p_bounty_id: 'b-trash' });
    expect(draft).toMatchObject({
      location: '1200 S 1st St, Austin, TX 78704',
      latitude: 30.2513,
      longitude: -97.7543,
      unit: 'Apt 4',
      zipCode: '78704',
      neighborhood: 'Bouldin Creek',
    });
    // Never the public "City, ST" label on the row.
    expect(draft.location).not.toBe('Austin, TX');
  });

  it('records which bounty it came from, for publish_type "republish"', async () => {
    rowReturns(cancelledRow);
    const draft = await buildDraftFromBounty('b-trash', POSTER);
    expect(draft.republishedFrom).toBe('b-trash');
  });

  it('works for a completed bounty the same way', async () => {
    rowReturns({ ...cancelledRow, status: 'completed' });
    const draft = await buildDraftFromBounty('b-trash', POSTER);
    expect(draft.title).toBe('Haul away yard trash');
    expect(draft.amount).toBe(45);
  });

  it('keeps a for-honor bounty for honor, at $0', async () => {
    rowReturns({ ...cancelledRow, is_for_honor: true, amount: 0 });
    const draft = await buildDraftFromBounty('b-trash', POSTER);
    expect(draft).toMatchObject({ isForHonor: true, amount: 0 });
  });

  it('reads only the job columns, never schedule, status or applicants', async () => {
    rowReturns(cancelledRow);
    await buildDraftFromBounty('b-trash', POSTER);

    expect(mockFrom).toHaveBeenCalledWith('bounties');
    const columns = mockSelect.mock.calls[0][0].split(',').map((c: string) => c.trim());
    for (const excluded of [
      'status',
      'start_date',
      'end_date',
      'schedule_type',
      'latest_arrival_time',
      'attachments_json',
      'accepted_by',
      'trust_tier',
      'requires_id_verified',
      'location',
      'latitude',
      'longitude',
      'unit',
    ]) {
      expect(columns).not.toContain(excluded);
    }
    expect(mockEq).toHaveBeenCalledWith('id', 'b-trash');
  });
});

describe('buildDraftFromBounty — what is not copied', () => {
  it('drops the schedule, attachments and legacy free text, and resets the trust tier', async () => {
    rowReturns(cancelledRow);
    const draft = await buildDraftFromBounty('b-trash', POSTER);

    expect(draft.scheduleType).toBeUndefined();
    expect(draft.startDate).toBeUndefined();
    expect(draft.endDate).toBeUndefined();
    expect(draft.latestArrivalTime).toBeUndefined();
    expect(draft.durationMinutes).toBeUndefined();
    expect(draft.conditionalEndNote).toBeUndefined();
    expect(draft.attachments).toEqual([]);
    expect(draft.timeline).toBe('');
    expect(draft.skills).toBe('');
    expect(draft.requirements).toBeUndefined();
    expect(draft.trustTier).toBe('standard');
    expect(draft.requiresIdVerified).toBe(false);
    // Nothing about the old posting's life rides along under any key.
    const json = JSON.stringify(draft);
    expect(json).not.toMatch(/cancelled|hunter-9|high_trust|a1/);
  });

  it('gives an online bounty no address and skips the address lookup', async () => {
    rowReturns({ ...cancelledRow, work_type: 'online', zip_code: '78704' });
    const draft = await buildDraftFromBounty('b-trash', POSTER);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(draft).toMatchObject({ workType: 'online', location: '', zipCode: '' });
    expect(draft.latitude).toBeUndefined();
    expect(draft.unit).toBeUndefined();
  });

  it('leaves the address empty for an old bounty with no exact location, rather than the city label', async () => {
    rowReturns(cancelledRow);
    mockRpc.mockResolvedValue({ data: [], error: null });
    const draft = await buildDraftFromBounty('b-trash', POSTER);

    expect(draft.location).toBe('');
    expect(draft.latitude).toBeUndefined();
    expect(draft.longitude).toBeUndefined();
    expect(draft.neighborhood).toBeUndefined();
  });
});

describe('buildDraftFromBounty — poster only', () => {
  it("refuses another user's bounty and never asks for its address", async () => {
    rowReturns({ ...cancelledRow, poster_id: STRANGER, user_id: STRANGER });

    await expect(buildDraftFromBounty('b-trash', POSTER)).rejects.toMatchObject({
      name: 'PostAgainError',
      code: 'not_owner',
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('refuses the hunter who did the job (the RPC would hand them the address)', async () => {
    rowReturns({ ...cancelledRow, accepted_by: 'hunter-9' });

    await expect(buildDraftFromBounty('b-trash', 'hunter-9')).rejects.toMatchObject({ code: 'not_owner' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('uses the signed-in user when no id is passed', async () => {
    rowReturns({ ...cancelledRow, poster_id: STRANGER, user_id: STRANGER });
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: POSTER } } } });

    await expect(buildDraftFromBounty('b-trash')).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('falls back to user_id when poster_id is missing, like the RPC', async () => {
    rowReturns({ ...cancelledRow, poster_id: null, user_id: POSTER });
    await expect(buildDraftFromBounty('b-trash', POSTER)).resolves.toMatchObject({ title: 'Haul away yard trash' });
  });

  it('does not let a matching user_id override a different poster_id', async () => {
    rowReturns({ ...cancelledRow, poster_id: STRANGER, user_id: POSTER });
    await expect(buildDraftFromBounty('b-trash', POSTER)).rejects.toMatchObject({ code: 'not_owner' });
  });

  it('needs a signed-in user', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(buildDraftFromBounty('b-trash')).rejects.toMatchObject({ code: 'not_signed_in' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('reports a bounty it cannot see as not found', async () => {
    rowReturns(null);
    await expect(buildDraftFromBounty('b-gone', POSTER)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('fails instead of dropping the address when the lookup errors', async () => {
    rowReturns(cancelledRow);
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const error = await buildDraftFromBounty('b-trash', POSTER).catch((e) => e);
    expect(error).toBeInstanceOf(PostAgainError);
    expect(error.code).toBe('load_failed');
  });

  it('fails when the bounty read errors', async () => {
    rowReturns(null, { message: 'network' });
    await expect(buildDraftFromBounty('b-trash', POSTER)).rejects.toMatchObject({ code: 'load_failed' });
  });
});

describe('draftFromBounty', () => {
  it('treats a non-numeric amount as $0', () => {
    const draft = draftFromBounty({ ...cancelledRow, amount: 'abc' }, exactLocation);
    expect(draft.amount).toBe(0);
  });

  it('drops coordinates that come back half-set', () => {
    const draft = draftFromBounty(cancelledRow, { ...exactLocation, longitude: null });
    expect(draft.latitude).toBeUndefined();
    expect(draft.longitude).toBeUndefined();
    expect(draft.location).toBe(exactLocation.location);
  });
});
