/**
 * Search's "Post this" (components/search/post-from-search.ts) and the draft
 * write behind it (seedBountyDraftTitle in app/hooks/useBountyDraft.ts).
 *
 * The rule under test: an unfinished post is never overwritten without the
 * poster choosing Replace. A composer that is already mounted (the tab
 * shell preloads it) must pick the new draft up instead of saving its stale
 * copy back over it.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

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
jest.mock('lib/services/draft-reminder', () => ({
  cancelDraftReminder: jest.fn(async () => {}),
  scheduleDraftReminderSoon: jest.fn(),
}));
jest.mock('lib/storage/abandoned-draft', () => ({
  clearDraftAbandoned: jest.fn(async () => {}),
}));

import { seedBountyDraftTitle, useBountyDraft } from 'app/hooks/useBountyDraft';
import {
  REPLACE_DRAFT_CONFIRM,
  REPLACE_DRAFT_KEEP,
  REPLACE_DRAFT_TITLE,
  askReplaceDraft,
  postFromSearch,
} from 'components/search/post-from-search';
import { subscribeComposerRequests } from 'lib/navigation/composer-request';

const KEY = 'bounty-draft-v1:user-1';
const NEW_TITLE = 'Remove home trash to apt.';

function savedDraft() {
  const raw = mockStore.get(KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

describe('postFromSearch', () => {
  it('starts a draft with the query as its title when none is in progress', async () => {
    const askReplace = jest.fn();
    const openComposer = jest.fn();
    const outcome = await postFromSearch('user-1', NEW_TITLE, { askReplace, openComposer });

    expect(outcome).toBe('started');
    expect(askReplace).not.toHaveBeenCalled();
    expect(savedDraft().title).toBe(NEW_TITLE);
    expect(openComposer).toHaveBeenCalledTimes(1);
  });

  it('asks before touching an unfinished post, and Replace starts fresh', async () => {
    mockStore.set(KEY, JSON.stringify({ title: 'Fix my fence', amount: 40, location: '1 Elm St' }));
    const askReplace = jest.fn(async () => 'replace' as const);
    const openComposer = jest.fn();

    const outcome = await postFromSearch('user-1', NEW_TITLE, { askReplace, openComposer });

    expect(askReplace).toHaveBeenCalledWith('Fix my fence', NEW_TITLE);
    expect(outcome).toBe('replaced');
    // Fresh draft: nothing of the old post carries over.
    expect(savedDraft()).toEqual(expect.objectContaining({ title: NEW_TITLE, amount: 0, location: '' }));
    expect(openComposer).toHaveBeenCalledTimes(1);
  });

  it('Keep mine leaves the draft exactly as it was and opens it', async () => {
    const original = JSON.stringify({ title: 'Fix my fence', amount: 40 });
    mockStore.set(KEY, original);
    const openComposer = jest.fn();

    const outcome = await postFromSearch('user-1', NEW_TITLE, {
      askReplace: async () => 'keep',
      openComposer,
    });

    expect(outcome).toBe('kept');
    expect(mockStore.get(KEY)).toBe(original);
    expect(openComposer).toHaveBeenCalledTimes(1);
  });

  it('dismissing the question changes nothing and stays on Search', async () => {
    const original = JSON.stringify({ title: 'Fix my fence' });
    mockStore.set(KEY, original);
    const openComposer = jest.fn();

    const outcome = await postFromSearch('user-1', NEW_TITLE, {
      askReplace: async () => 'dismiss',
      openComposer,
    });

    expect(outcome).toBe('dismissed');
    expect(mockStore.get(KEY)).toBe(original);
    expect(openComposer).not.toHaveBeenCalled();
  });

  it("doesn't ask when the unfinished post already has this title", async () => {
    mockStore.set(KEY, JSON.stringify({ title: NEW_TITLE, amount: 25 }));
    const askReplace = jest.fn();
    const openComposer = jest.fn();

    expect(await postFromSearch('user-1', NEW_TITLE, { askReplace, openComposer })).toBe('kept');
    expect(askReplace).not.toHaveBeenCalled();
    expect(savedDraft().amount).toBe(25);
  });

  it('keeps a description typed before any title', async () => {
    mockStore.set(KEY, JSON.stringify({ title: '', description: 'Two bags, third floor walk-up' }));
    await postFromSearch('user-1', NEW_TITLE, { askReplace: jest.fn(), openComposer: jest.fn() });
    expect(savedDraft()).toEqual(
      expect.objectContaining({ title: NEW_TITLE, description: 'Two bags, third floor walk-up' })
    );
  });

  it('opens the composer through the tab shell with entry point search_fallback', async () => {
    const shell = jest.fn();
    const unsubscribe = subscribeComposerRequests(shell);
    await postFromSearch('user-1', NEW_TITLE, { askReplace: jest.fn() });
    unsubscribe();
    expect(shell).toHaveBeenCalledWith('search_fallback');
  });
});

describe('seedBountyDraftTitle', () => {
  it('refuses to overwrite an unfinished post unless told to replace it', async () => {
    const original = JSON.stringify({ title: 'Fix my fence' });
    mockStore.set(KEY, original);
    expect(await seedBountyDraftTitle('user-1', NEW_TITLE)).toBeNull();
    expect(mockStore.get(KEY)).toBe(original);
  });

  it('hands the new draft to a composer that is already mounted', async () => {
    mockStore.set(KEY, JSON.stringify({ title: 'Fix my fence', amount: 40 }));
    const composer = renderHook(() => useBountyDraft('user-1'));
    await waitFor(() => expect(composer.result.current.draft.title).toBe('Fix my fence'));

    await act(async () => {
      await seedBountyDraftTitle('user-1', NEW_TITLE, { replaceExisting: true });
    });
    expect(composer.result.current.draft.title).toBe(NEW_TITLE);

    // The composer's next autosave builds on the new draft, not its old copy.
    await act(async () => {
      await composer.result.current.saveDraft({ description: 'Two bags' });
    });
    expect(savedDraft()).toEqual(
      expect.objectContaining({ title: NEW_TITLE, description: 'Two bags', amount: 0 })
    );
  });
});

describe('askReplaceDraft', () => {
  it('asks "Replace your unfinished post?" with Replace / Keep mine', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const answer = askReplaceDraft('Fix my fence', NEW_TITLE);

    const [title, message, buttons, options] = alertSpy.mock.calls[0];
    expect(title).toBe(REPLACE_DRAFT_TITLE);
    expect(message).toContain('Fix my fence');
    expect(message).toContain(NEW_TITLE);
    expect(buttons!.map((b) => b.text)).toEqual([REPLACE_DRAFT_KEEP, REPLACE_DRAFT_CONFIRM]);
    // Dismissal must not count as Keep mine (the web shim maps it to the
    // 'cancel'-styled button).
    expect(buttons!.some((b) => b.style === 'cancel')).toBe(false);
    expect(options).toEqual(expect.objectContaining({ cancelable: true }));

    buttons![1].onPress!();
    await expect(answer).resolves.toBe('replace');
    alertSpy.mockRestore();
  });
});
