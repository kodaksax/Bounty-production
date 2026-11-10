/**
 * The REAL useBountyDraft across two devices that share one fake server
 * (public.bounty_drafts). Each "device" is its own in-memory storage; the
 * server stands in for lib/services/bounty-draft-sync's I/O, while the real
 * newer-wins resolver decides. Publishing runs through the REAL
 * useBountyPublish, so clear-on-publish is checked end to end.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

type Copy = { draft: any; lastStep: number; updatedAt: string | null };

const mockDevices: Record<string, Map<string, string>> = { A: new Map(), B: new Map() };
let mockDevice: 'A' | 'B' = 'A';
const mockServer = new Map<string, Copy>();
const mockStore = () => mockDevices[mockDevice];

jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (k: string) => mockStore().get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore().set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore().delete(k);
    }),
  },
}));

// The fake server applies upserts immediately (the 2 s debounce itself is
// covered in __tests__/unit/services/bounty-draft-sync.test.ts).
jest.mock('lib/services/bounty-draft-sync', () => {
  const actual = jest.requireActual('lib/services/bounty-draft-sync');
  return {
    ...actual,
    fetchServerDraft: jest.fn(async (userId: string) => ({
      status: 'ok',
      copy: mockServer.has(userId) ? JSON.parse(JSON.stringify(mockServer.get(userId))) : null,
    })),
    scheduleServerDraftUpsert: jest.fn((userId: string, copy: Copy, onSynced?: (at: string) => void) => {
      mockServer.set(userId, JSON.parse(JSON.stringify(copy)));
      if (copy.updatedAt) onSynced?.(copy.updatedAt);
    }),
    flushServerDraftUpsert: jest.fn(async () => {}),
    cancelServerDraftUpsert: jest.fn(),
    deleteServerDraft: jest.fn(async (userId: string) => {
      mockServer.delete(userId);
      return true;
    }),
  };
});

jest.mock('lib/services/draft-reminder', () => ({
  cancelDraftReminder: jest.fn(async () => {}),
  scheduleDraftReminderSoon: jest.fn(),
}));

const mockCreateBounty = jest.fn();
jest.mock('app/services/bountyService', () => ({
  bountyService: {
    createBounty: (...a: unknown[]) => mockCreateBounty(...a),
    deleteBounty: jest.fn(),
  },
}));
jest.mock('lib/services/bounty-funding-service', () => ({
  canDeferBountyFunding: jest.fn(async () => true),
  amountBucket: () => '25_49',
}));
jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));
jest.mock('lib/services/bounty-payments-service', () => ({
  bountyPaymentsService: { createBountyPayment: jest.fn(), cancelBountyPayment: jest.fn() },
}));
jest.mock('lib/services/stripe-service', () => ({
  stripeService: { confirmPaymentSecure: jest.fn() },
}));
jest.mock('lib/services/offline-queue-service', () => ({
  offlineQueueService: { getOnlineStatus: () => true },
}));
jest.mock('lib/utils/payment-architecture', () => ({
  shouldFundNewBountiesWithPhase2: () => false,
  shouldUseStripeNativeFunding: () => false,
}));

import { Alert } from 'react-native';
import { clearBountyDraftForUser, useBountyDraft } from 'app/hooks/useBountyDraft';
import { useBountyPublish } from 'app/screens/CreateBounty/useBountyPublish';
import { deleteServerDraft } from 'lib/services/bounty-draft-sync';

const USER = 'poster-1';
const KEY = `bounty-draft-v1:${USER}`;

const TASK = {
  title: 'Mount my TV',
  description: '55-inch TV on drywall, any weekday after 5pm',
};
const PINNED = { location: '123 Main St', latitude: 40.7128, longitude: -74.006, zipCode: '10001' };

function on(device: 'A' | 'B') {
  mockDevice = device;
}

async function openComposer() {
  const hook = renderHook(() => useBountyDraft(USER));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

const stored = (device: 'A' | 'B') => {
  const raw = mockDevices[device].get(KEY);
  return raw ? JSON.parse(raw) : null;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDevices.A.clear();
  mockDevices.B.clear();
  mockServer.clear();
  on('A');
});

describe('cross-device drafts', () => {
  it('a draft started on device A opens on device B, on the same step', async () => {
    on('A');
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft(TASK);
      await a.result.current.saveDraft(PINNED);
      await a.result.current.saveStep(3);
    });
    expect(stored('A')).toMatchObject({ title: TASK.title, lastStep: 3 });
    expect(mockServer.get(USER)).toMatchObject({ lastStep: 3, draft: { title: TASK.title } });
    a.unmount();

    on('B'); // signed in on the tablet: nothing on this device yet
    const b = await openComposer();
    expect(b.result.current.draft).toMatchObject({ ...TASK, ...PINNED });
    expect(b.result.current.lastStep).toBe(3);
    expect(b.result.current.source).toBe('server');
    // Kept on B too, so it survives going offline there.
    expect(stored('B')).toMatchObject({ title: TASK.title, lastStep: 3 });
  });

  it('keeps the newer copy: a later edit on B wins back on A', async () => {
    on('A');
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft({ ...TASK, title: 'Mount my TV' });
    });
    a.unmount();

    on('B');
    const b = await openComposer();
    await act(async () => {
      await new Promise(r => setTimeout(r, 5)); // a strictly later clock tick
      await b.result.current.saveDraft({ title: 'Mount my 65-inch TV' });
    });
    b.unmount();

    on('A'); // A's device copy is now older than the server's
    const again = await openComposer();
    expect(again.result.current.draft.title).toBe('Mount my 65-inch TV');
    expect(again.result.current.source).toBe('server');
  });

  it('keeps the device copy when it is the newer one (edited offline)', async () => {
    mockServer.set(USER, {
      draft: { ...TASK, title: 'Server title' },
      lastStep: 1,
      updatedAt: '2026-11-10T10:00:00.000Z',
    });
    mockDevices.A.set(
      KEY,
      JSON.stringify({ ...TASK, title: 'Offline title', lastStep: 2, updatedAt: '2026-11-10T11:00:00.000Z' })
    );
    const a = await openComposer();
    expect(a.result.current.draft.title).toBe('Offline title');
    expect(a.result.current.lastStep).toBe(2);
    expect(a.result.current.source).toBe('local');
    // ...and uploads it.
    expect(mockServer.get(USER)?.draft.title).toBe('Offline title');
  });

  it('a draft from before lastStep existed reopens on its first unfinished step', async () => {
    // Saved by 2.1.x: plain draft fields, no lastStep or updatedAt.
    mockDevices.A.set(KEY, JSON.stringify({ ...TASK, workType: 'in_person', location: '123 Main St' }));
    const a = await openComposer();
    expect(a.result.current.lastStep).toBe(2); // no pin yet, so Location
    expect(stored('A').updatedAt).toEqual(expect.any(String));
  });
});

describe('clearing', () => {
  it('clearDraft ("Start over") clears this device and the server', async () => {
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft(TASK);
    });
    expect(mockServer.has(USER)).toBe(true);

    await act(async () => {
      await a.result.current.clearDraft();
    });
    expect(stored('A')).toBeNull();
    expect(mockServer.has(USER)).toBe(false);
    expect(a.result.current.draft.title).toBe('');
    expect(a.result.current.lastStep).toBe(1);
    // The delete was confirmed, so the delete marker is gone too.
    await waitFor(() => expect(mockDevices.A.has(`${KEY}:cleared`)).toBe(false));
  });

  it('publishing clears both copies', async () => {
    mockCreateBounty.mockResolvedValue({ bounty: { id: 'b1', funding_mode: 'at_accept' }, created: true });
    (Alert.alert as jest.Mock).mockImplementation((_t: string, _m: string, buttons: any[]) => {
      buttons?.[0]?.onPress?.();
    });
    const onPublished = jest.fn();
    const { result } = renderHook(() => {
      const d = useBountyDraft(USER);
      const p = useBountyPublish({
        surface: 'create_flow',
        draft: d.draft,
        clearDraft: d.clearDraft,
        balance: 0,
        createEscrow: jest.fn(),
        paymentMethods: [{ id: 'pm_1' }],
        sessionUserId: USER,
        canPostBounties: true,
        suppressSuccessAlert: true,
        onPublished,
        onEditAmount: jest.fn(),
      });
      return { d, p };
    });
    await waitFor(() => expect(result.current.d.isLoading).toBe(false));
    await act(async () => {
      await result.current.d.saveDraft({ ...TASK, ...PINNED, amount: 30, category: 'labor' });
      await result.current.d.saveStep(3);
    });
    expect(mockServer.has(USER)).toBe(true);
    await act(async () => {}); // deferred-funding prefetch settles

    await act(async () => {
      await result.current.p.publish();
    });

    expect(mockCreateBounty).toHaveBeenCalledTimes(1);
    expect(onPublished).toHaveBeenCalled();
    expect(deleteServerDraft).toHaveBeenCalledWith(USER);
    expect(mockServer.has(USER)).toBe(false);
    expect(stored('A')).toBeNull();
  });

  it('a draft published offline is deleted from the server on the next load, not restored', async () => {
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft(TASK);
    });
    (deleteServerDraft as jest.Mock).mockImplementationOnce(async () => false); // offline
    await act(async () => {
      await a.result.current.clearDraft();
    });
    expect(mockServer.has(USER)).toBe(true); // stale copy left behind
    a.unmount();

    const again = await openComposer();
    expect(again.result.current.draft.title).toBe('');
    await waitFor(() => expect(mockServer.has(USER)).toBe(false));
  });

  it('a draft published on another device disappears here too', async () => {
    on('A');
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft(TASK);
    });
    a.unmount();

    on('B');
    const b = await openComposer();
    await act(async () => {
      await b.result.current.clearDraft(); // published on the tablet
    });
    b.unmount();

    on('A');
    const back = await openComposer();
    expect(back.result.current.draft.title).toBe('');
    expect(stored('A')).toBeNull();
  });

  it('sign-out clears this device only; the server copy waits for the next sign-in', async () => {
    const a = await openComposer();
    await act(async () => {
      await a.result.current.saveDraft(TASK);
    });
    a.unmount();

    await clearBountyDraftForUser(USER);
    expect(stored('A')).toBeNull();
    expect(mockServer.has(USER)).toBe(true);

    const again = await openComposer();
    expect(again.result.current.draft.title).toBe(TASK.title);
  });
});
