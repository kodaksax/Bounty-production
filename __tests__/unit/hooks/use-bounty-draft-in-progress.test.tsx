/**
 * useBountyDraftInProgress (app/hooks/useBountyDraft.ts) — the signal behind
 * the Post tab's "unfinished post" dot. It reads storage once, then follows
 * the composer's own saves and clears rather than re-reading storage.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
jest.mock('lib/storage', () => ({
  storage: {
    getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockStore.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockStore.delete(key);
    }),
  },
}));

import {
  clearBountyDraftForUser,
  isBountyDraftInProgress,
  useBountyDraft,
  useBountyDraftInProgress,
} from 'app/hooks/useBountyDraft';

beforeEach(() => {
  mockStore.clear();
});

describe('isBountyDraftInProgress', () => {
  it('counts a draft with a title', () => {
    expect(isBountyDraftInProgress({ title: 'Walk my dog' })).toBe(true);
  });

  it('ignores empty and whitespace-only titles', () => {
    expect(isBountyDraftInProgress({ title: '   ' })).toBe(false);
    expect(isBountyDraftInProgress({ title: '' })).toBe(false);
    expect(isBountyDraftInProgress(null)).toBe(false);
  });
});

describe('useBountyDraftInProgress', () => {
  it('reads an existing draft from storage', async () => {
    mockStore.set('bounty-draft-v1:user-1', JSON.stringify({ title: 'Mount my TV' }));
    const { result } = renderHook(() => useBountyDraftInProgress('user-1'));
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('is false when there is no draft', async () => {
    const { result } = renderHook(() => useBountyDraftInProgress('user-1'));
    await act(async () => {});
    expect(result.current).toBe(false);
  });

  it('follows the composer saving and then clearing its draft', async () => {
    const presence = renderHook(() => useBountyDraftInProgress('user-1'));
    const composer = renderHook(() => useBountyDraft('user-1'));
    await waitFor(() => expect(composer.result.current.isLoading).toBe(false));
    expect(presence.result.current).toBe(false);

    await act(async () => {
      await composer.result.current.saveDraft({ title: 'Hem my gown' });
    });
    expect(presence.result.current).toBe(true);

    await act(async () => {
      await composer.result.current.clearDraft();
    });
    expect(presence.result.current).toBe(false);
  });

  it("ignores another user's draft", async () => {
    const presence = renderHook(() => useBountyDraftInProgress('user-1'));
    const otherComposer = renderHook(() => useBountyDraft('user-2'));
    await waitFor(() => expect(otherComposer.result.current.isLoading).toBe(false));

    await act(async () => {
      await otherComposer.result.current.saveDraft({ title: 'Not mine' });
    });
    expect(presence.result.current).toBe(false);
  });

  it('clears when the draft is wiped on sign-out', async () => {
    mockStore.set('bounty-draft-v1:user-1', JSON.stringify({ title: 'Mount my TV' }));
    const { result } = renderHook(() => useBountyDraftInProgress('user-1'));
    await waitFor(() => expect(result.current).toBe(true));

    await act(async () => {
      await clearBountyDraftForUser('user-1');
    });
    expect(result.current).toBe(false);
  });
});
