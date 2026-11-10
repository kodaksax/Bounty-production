/**
 * startPostAgain (lib/post-again/start-post-again.ts): one tap on "Post
 * again" → post_again_tapped, the copy saved as the poster's draft, and a
 * request for the tab shell to open the composer on its last step. It asks
 * before replacing an unfinished draft, and a bounty that isn't the poster's
 * changes nothing.
 */

const mockStore = new Map<string, string>();
jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
  },
}));
jest.mock('lib/services/draft-reminder', () => ({
  scheduleDraftReminderSoon: jest.fn(),
  cancelDraftReminder: jest.fn(async () => undefined),
}));
jest.mock('lib/storage/abandoned-draft', () => ({ clearDraftAbandoned: jest.fn(async () => undefined) }));
jest.mock('lib/services/analytics-service', () => ({ analyticsService: { trackEvent: jest.fn() } }));

const mockMaybeSingle = jest.fn();
const mockRpc = jest.fn();
jest.mock('lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
}));

import { analyticsService } from 'lib/services/analytics-service';
import {
  __resetPostAgainHandoffForTests,
  subscribePostAgainRequests,
  takePostAgainRequest,
} from 'lib/post-again/handoff';
import { startPostAgain } from 'lib/post-again/start-post-again';

const POSTER = 'poster-1';
const DRAFT_KEY = `bounty-draft-v1:${POSTER}`;

const row = {
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
  neighborhood: null,
};

const trackEvent = analyticsService.trackEvent as jest.Mock;
const savedDraft = () => JSON.parse(mockStore.get(DRAFT_KEY) as string);

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  __resetPostAgainHandoffForTests();
  mockMaybeSingle.mockResolvedValue({ data: row, error: null });
  mockRpc.mockResolvedValue({
    data: [{ location: '1200 S 1st St, Austin, TX 78704', latitude: 30.25, longitude: -97.75, unit: null }],
    error: null,
  });
});

it('saves the copy as the draft and asks the shell to open it on Compensation', async () => {
  const requests: unknown[] = [];
  subscribePostAgainRequests((r) => requests.push(r));

  const result = await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'my_bounties' });

  expect(result).toBe('opened');
  expect(trackEvent).toHaveBeenCalledWith('post_again_tapped', { source: 'my_bounties', bounty_id: 'b-trash' });
  expect(savedDraft()).toMatchObject({
    title: 'Haul away yard trash',
    location: '1200 S 1st St, Austin, TX 78704',
    amount: 45,
    republishedFrom: 'b-trash',
  });
  expect(requests).toEqual([expect.objectContaining({ sourceBountyId: 'b-trash', userId: POSTER, startStep: 3 })]);
  expect(takePostAgainRequest(POSTER)).toMatchObject({ sourceBountyId: 'b-trash' });
});

it.each(['bounty_detail', 'my_bounties', 'home_card', 'email'] as const)('tags the tap with source %s', async (source) => {
  await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source });
  expect(trackEvent).toHaveBeenCalledWith('post_again_tapped', expect.objectContaining({ source }));
});

it('opens on Location instead when the old bounty has no pinned address', async () => {
  mockRpc.mockResolvedValue({ data: [], error: null });
  await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card' });
  expect(takePostAgainRequest(POSTER)).toMatchObject({ startStep: 2 });
});

describe('an unfinished draft', () => {
  const unfinished = { title: 'Fix the kitchen sink', description: '', amount: 0, workType: 'in_person' };

  beforeEach(() => {
    mockStore.set(DRAFT_KEY, JSON.stringify(unfinished));
  });

  it('is kept when the poster says so, and nothing opens', async () => {
    const confirmReplace = jest.fn(async () => false);
    const result = await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card', confirmReplace });

    expect(confirmReplace).toHaveBeenCalledWith('Fix the kitchen sink', 'Haul away yard trash');
    expect(result).toBe('kept_draft');
    expect(savedDraft()).toEqual(unfinished);
    expect(takePostAgainRequest(POSTER)).toBeNull();
  });

  it('is replaced when the poster agrees', async () => {
    const confirmReplace = jest.fn(async () => true);
    const result = await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card', confirmReplace });

    expect(result).toBe('opened');
    expect(savedDraft().title).toBe('Haul away yard trash');
  });

  it('is not asked about when it holds no title yet', async () => {
    mockStore.set(DRAFT_KEY, JSON.stringify({ ...unfinished, title: '  ' }));
    const confirmReplace = jest.fn(async () => true);
    await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card', confirmReplace });
    expect(confirmReplace).not.toHaveBeenCalled();
  });
});

describe("another user's bounty", () => {
  it('cannot be cloned: no draft is written, nothing opens, the poster is told', async () => {
    mockMaybeSingle.mockResolvedValue({ data: { ...row, poster_id: 'stranger', user_id: 'stranger' }, error: null });
    const showError = jest.fn();
    const confirmReplace = jest.fn(async () => true);

    const result = await startPostAgain({
      bountyId: 'b-trash',
      userId: POSTER,
      source: 'email',
      showError,
      confirmReplace,
    });

    expect(result).toBe('failed');
    expect(showError).toHaveBeenCalledWith("Can't post this again", 'You can only post your own bounties again.');
    expect(mockStore.has(DRAFT_KEY)).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    expect(confirmReplace).not.toHaveBeenCalled();
    expect(takePostAgainRequest(POSTER)).toBeNull();
  });
});

it('needs a signed-in user', async () => {
  const showError = jest.fn();
  const result = await startPostAgain({ bountyId: 'b-trash', userId: null, source: 'home_card', showError });
  expect(result).toBe('failed');
  expect(showError).toHaveBeenCalled();
  expect(mockMaybeSingle).not.toHaveBeenCalled();
});

it('ignores a second tap while the first is still loading', async () => {
  const first = startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card' });
  const second = await startPostAgain({ bountyId: 'b-trash', userId: POSTER, source: 'home_card' });
  expect(second).toBe('failed');
  expect(await first).toBe('opened');
  expect(mockMaybeSingle).toHaveBeenCalledTimes(1);
});
