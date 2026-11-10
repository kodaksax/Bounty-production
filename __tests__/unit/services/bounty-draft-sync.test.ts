/**
 * The server copy of the composer draft (lib/services/bounty-draft-sync.ts):
 * the newer-wins merge, the 2 s debounce, and the order of writes and deletes.
 * Supabase is replaced by a recording fake; RLS on the table itself is checked
 * by scripts/verify-bounty-drafts-rls-pglite.mjs and bounty-drafts-migration.test.ts.
 */

type Result = { data?: unknown; error: { message: string } | null };

const mockCalls: unknown[][] = [];
let mockFetch: () => Promise<Result>;
let mockUpsert: (row: Record<string, unknown>) => Promise<Result>;
let mockDelete: () => Promise<Result>;

jest.mock('lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: (_col: string, id: string) => ({
          maybeSingle: () => {
            mockCalls.push(['select', table, cols, id]);
            return mockFetch();
          },
        }),
      }),
      upsert: (row: Record<string, unknown>, opts: unknown) => {
        mockCalls.push(['upsert', table, row, opts]);
        return mockUpsert(row);
      },
      delete: () => ({
        eq: (_col: string, id: string) => {
          mockCalls.push(['delete', table, id]);
          return mockDelete();
        },
      }),
    }),
  },
}));

import {
  __resetBountyDraftSyncForTests,
  cancelServerDraftUpsert,
  deleteServerDraft,
  fetchServerDraft,
  flushServerDraftUpsert,
  resolveDraftCopies,
  scheduleServerDraftUpsert,
  SERVER_DRAFT_DEBOUNCE_MS,
  type DraftCopy,
} from 'lib/services/bounty-draft-sync';

const USER = 'poster-1';
const T0 = '2026-11-10T10:00:00.000Z';
const T1 = '2026-11-10T10:05:00.000Z';
const T2 = '2026-11-10T10:10:00.000Z';

const baseDraft = {
  title: 'Mount my TV',
  description: '55-inch TV on drywall, any weekday after 5pm',
  amount: 40,
  isForHonor: false,
  location: '123 Main St',
  latitude: 40.7128,
  longitude: -74.006,
  workType: 'in_person' as const,
  attachments: [],
};

const copy = (title: string, updatedAt: string | null, lastStep = 3): DraftCopy => ({
  draft: { ...baseDraft, title },
  lastStep,
  updatedAt,
});

const ok = { status: 'ok' as const };
const unavailable = { status: 'unavailable' as const };

const callsOf = (kind: string) => mockCalls.filter(c => c[0] === kind);

/** Let queued promise callbacks run (the op queue chains through several). */
async function drain() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
  mockCalls.length = 0;
  mockFetch = async () => ({ data: null, error: null });
  mockUpsert = async () => ({ error: null });
  mockDelete = async () => ({ error: null });
  __resetBountyDraftSyncForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('resolveDraftCopies — newer updated_at wins', () => {
  it('opens the server copy when it is newer than the device copy', () => {
    const r = resolveDraftCopies(copy('Old', T0), T0, null, { ...ok, copy: copy('New', T1) });
    expect(r.winner).toBe('server');
    expect(r.copy?.draft.title).toBe('New');
    expect(r.pushLocal).toBe(false);
  });

  it('keeps the device copy when it is newer, and uploads it', () => {
    const r = resolveDraftCopies(copy('Local', T2), T0, null, { ...ok, copy: copy('Server', T1) });
    expect(r.winner).toBe('local');
    expect(r.copy?.draft.title).toBe('Local');
    expect(r.pushLocal).toBe(true);
  });

  it('treats equal timestamps as the same copy: device wins, nothing to upload', () => {
    const r = resolveDraftCopies(copy('Same', T1), T1, null, { ...ok, copy: copy('Same', T1) });
    expect(r).toMatchObject({ winner: 'local', pushLocal: false, deleteServer: false });
  });

  it('opens the server copy on a device with no draft (device B after sign-in)', () => {
    const r = resolveDraftCopies(null, null, null, { ...ok, copy: copy('From phone', T1) });
    expect(r.winner).toBe('server');
    expect(r.copy?.lastStep).toBe(3);
  });

  it('a device copy saved before sync existed loses to any server copy', () => {
    const r = resolveDraftCopies(copy('Legacy', null), null, null, { ...ok, copy: copy('Server', T0) });
    expect(r.winner).toBe('server');
  });

  it('uploads a device copy the server has never seen', () => {
    const r = resolveDraftCopies(copy('Only here', T1), null, null, { ...ok, copy: null });
    expect(r).toMatchObject({ winner: 'local', pushLocal: true, clearLocal: false });
  });

  it('drops a synced device copy the server no longer has (published or discarded elsewhere)', () => {
    const r = resolveDraftCopies(copy('Published on tablet', T1), T1, null, { ...ok, copy: null });
    expect(r).toMatchObject({ winner: 'none', copy: null, clearLocal: true });
  });

  it('deletes a server copy no newer than this device\'s own publish/discard', () => {
    // Published offline at T2: the delete never reached the server.
    const r = resolveDraftCopies(null, null, T2, { ...ok, copy: copy('Already posted', T1) });
    expect(r).toMatchObject({ winner: 'none', copy: null, deleteServer: true });
  });

  it('a server copy edited on another device after this one cleared still wins', () => {
    const r = resolveDraftCopies(null, null, T0, { ...ok, copy: copy('New post on tablet', T1) });
    expect(r).toMatchObject({ winner: 'server', forgetCleared: true });
  });

  it('server unavailable: opens the device copy and retries what is pending', () => {
    expect(resolveDraftCopies(copy('Offline edit', T1), T0, null, unavailable)).toMatchObject({
      winner: 'local',
      pushLocal: true,
    });
    expect(resolveDraftCopies(copy('Synced', T1), T1, null, unavailable)).toMatchObject({
      winner: 'local',
      pushLocal: false,
    });
    expect(resolveDraftCopies(null, null, T1, unavailable)).toMatchObject({
      winner: 'none',
      deleteServer: true,
    });
  });
});

describe('scheduleServerDraftUpsert — debounced by 2 s', () => {
  it('sends one upsert for a burst, with the last copy, 2 s after the last edit', async () => {
    scheduleServerDraftUpsert(USER, copy('M', T0, 1));
    jest.advanceTimersByTime(1500);
    scheduleServerDraftUpsert(USER, copy('Mount my', T1, 1));
    jest.advanceTimersByTime(1500);
    scheduleServerDraftUpsert(USER, copy('Mount my TV', T2, 2));

    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS - 1);
    await drain();
    expect(callsOf('upsert')).toHaveLength(0);

    jest.advanceTimersByTime(1);
    await drain();
    expect(callsOf('upsert')).toHaveLength(1);
    const [, table, row, opts] = callsOf('upsert')[0] as [string, string, any, any];
    expect(table).toBe('bounty_drafts');
    expect(opts).toEqual({ onConflict: 'user_id' });
    expect(row).toMatchObject({
      user_id: USER,
      last_step: 2,
      updated_at: T2,
      // The model from expo-device (jest.setup.js), not the user-set name.
      device_name: 'iPhone',
    });
    expect(row.draft.title).toBe('Mount my TV');
  });

  it('reports the uploaded copy as synced only once the server accepts it', async () => {
    const onSynced = jest.fn();
    mockUpsert = async () => ({ error: { message: 'offline' } });
    scheduleServerDraftUpsert(USER, copy('A', T1), onSynced);
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS);
    await drain();
    expect(onSynced).not.toHaveBeenCalled();

    mockUpsert = async () => ({ error: null });
    scheduleServerDraftUpsert(USER, copy('A', T2), onSynced);
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS);
    await drain();
    expect(onSynced).toHaveBeenCalledWith(T2);
  });

  it('leaves device-only attachments out of the server copy', async () => {
    scheduleServerDraftUpsert(USER, {
      ...copy('With photos', T1),
      draft: {
        ...baseDraft,
        attachments: [
          { id: 'a', name: 'local.jpg', uri: 'file:///data/local.jpg' },
          { id: 'b', name: 'up.jpg', uri: 'file:///x.jpg', remoteUri: 'https://cdn.example/up.jpg' },
        ],
      },
    });
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS);
    await drain();
    const row = callsOf('upsert')[0][2] as any;
    expect(row.draft.attachments.map((a: any) => a.id)).toEqual(['b']);
  });

  it('flush sends the pending upsert at once; cancel drops it', async () => {
    scheduleServerDraftUpsert(USER, copy('Leaving the tab', T1));
    await flushServerDraftUpsert(USER);
    expect(callsOf('upsert')).toHaveLength(1);

    scheduleServerDraftUpsert(USER, copy('Signing out', T2));
    cancelServerDraftUpsert(USER);
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS * 2);
    await drain();
    expect(callsOf('upsert')).toHaveLength(1);
  });
});

describe('deleteServerDraft — publish and discard', () => {
  it('cancels a pending upsert, so the published draft is not written back', async () => {
    scheduleServerDraftUpsert(USER, copy('About to publish', T1));
    await expect(deleteServerDraft(USER)).resolves.toBe(true);
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS * 2);
    await drain();
    expect(callsOf('upsert')).toHaveLength(0);
    expect(callsOf('delete')).toEqual([['delete', 'bounty_drafts', USER]]);
  });

  it('runs after an upsert already in flight, never before it', async () => {
    let releaseUpsert: (r: Result) => void = () => {};
    mockUpsert = () => new Promise<Result>(resolve => (releaseUpsert = resolve));
    scheduleServerDraftUpsert(USER, copy('In flight', T1));
    jest.advanceTimersByTime(SERVER_DRAFT_DEBOUNCE_MS);
    await drain();
    expect(callsOf('upsert')).toHaveLength(1);

    const deleted = deleteServerDraft(USER);
    await drain();
    expect(callsOf('delete')).toHaveLength(0);

    releaseUpsert({ error: null });
    await expect(deleted).resolves.toBe(true);
    expect(mockCalls.map(c => c[0])).toEqual(['upsert', 'delete']);
  });

  it('resolves false when the server refuses, so the caller keeps its delete marker', async () => {
    mockDelete = async () => ({ error: { message: 'network' } });
    await expect(deleteServerDraft(USER)).resolves.toBe(false);
  });
});

describe('fetchServerDraft', () => {
  it('reads the user\'s row and clamps last_step', async () => {
    mockFetch = async () => ({
      data: { draft: { ...baseDraft }, last_step: 9, updated_at: T1 },
      error: null,
    });
    const result = await fetchServerDraft(USER);
    expect(callsOf('select')[0]).toEqual(['select', 'bounty_drafts', 'draft, last_step, updated_at', USER]);
    expect(result).toEqual({
      status: 'ok',
      copy: { draft: baseDraft, lastStep: 3, updatedAt: T1 },
    });
  });

  it('no row is "ok, no copy"; an error or a timeout is "unavailable"', async () => {
    await expect(fetchServerDraft(USER)).resolves.toEqual({ status: 'ok', copy: null });

    mockFetch = async () => ({ data: null, error: { message: 'relation "bounty_drafts" does not exist' } });
    await expect(fetchServerDraft(USER)).resolves.toEqual({ status: 'unavailable' });

    mockFetch = () => new Promise<Result>(() => {});
    const hanging = fetchServerDraft(USER, 3000);
    jest.advanceTimersByTime(3000);
    await expect(hanging).resolves.toEqual({ status: 'unavailable' });
  });
});
