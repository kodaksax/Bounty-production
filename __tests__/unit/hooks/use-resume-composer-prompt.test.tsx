/**
 * The app-open resume prompt (app/hooks/useResumeComposerPrompt.ts).
 *
 * Pins who sees it (flagged tab-abandoners with a draft still saved), what
 * counts as an app open, and that answering it clears the flag so it doesn't
 * repeat.
 */

import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => {
    mockStore.set(key, value);
  }),
  removeItem: jest.fn(async (key: string) => {
    mockStore.delete(key);
  }),
}));
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

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: jest.fn() },
}));

jest.mock('lib/services/draft-reminder', () => ({
  cancelDraftReminder: jest.fn(async () => {}),
  scheduleDraftReminderSoon: jest.fn(),
}));

import { AppState } from 'react-native';
import { clearBountyDraftForUser, useBountyDraft } from 'app/hooks/useBountyDraft';
import {
  __resetResumeComposerPromptForTests,
  SESSION_GAP_MS,
  useResumeComposerPrompt,
} from 'app/hooks/useResumeComposerPrompt';
import { analyticsService } from 'lib/services/analytics-service';
import { getDraftAbandonedAt, markDraftAbandoned } from 'lib/storage/abandoned-draft';

const trackEvent = analyticsService.trackEvent as jest.Mock;
let appStateListener: ((next: string) => void) | null = null;
const USER = 'poster-1';

function promptEvents() {
  return trackEvent.mock.calls.filter(c => c[0] === 'post_resume_prompt').map(c => c[1]);
}

async function seedAbandonedDraft(title = 'Mount my TV') {
  mockStore.set(`bounty-draft-v1:${USER}`, JSON.stringify({ title }));
  await markDraftAbandoned(USER);
}

/** Lets the hook's storage reads and flag read settle. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  mockStore.clear();
  trackEvent.mockClear();
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, listener: any) => {
    appStateListener = listener;
    return { remove: jest.fn() };
  }) as any);
  __resetResumeComposerPromptForTests();
});

describe('useResumeComposerPrompt', () => {
  it('shows a flagged draft on app open', async () => {
    await seedAbandonedDraft();
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));

    await waitFor(() => expect(result.current.draftTitle).toBe('Mount my TV'));
    expect(promptEvents()).toEqual([
      { surface: 'app_open', action: 'shown', to_step: 1, to_step_name: 'Task' },
    ]);
  });

  it('shows nothing to a poster who has no abandoned draft', async () => {
    mockStore.set(`bounty-draft-v1:${USER}`, JSON.stringify({ title: 'Mount my TV' }));
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));

    await settle();
    expect(result.current.draftTitle).toBeNull();
  });

  it('drops a flag whose draft is gone', async () => {
    await markDraftAbandoned(USER);
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));

    await settle();
    expect(result.current.draftTitle).toBeNull();
    expect(await getDraftAbandonedAt(USER)).toBeNull();
  });

  it('stays out of the way when the app opens on the Post tab', async () => {
    await seedAbandonedDraft();
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'postings'));

    await settle();
    expect(result.current.draftTitle).toBeNull();
    // Still flagged: the composer itself offers the resume there.
    expect(await getDraftAbandonedAt(USER)).not.toBeNull();
  });

  it.each([
    ['onDismiss', 'dismissed'],
    ['onContinue', 'continued'],
  ] as const)('%s clears the flag so the prompt does not repeat', async (handler, action) => {
    await seedAbandonedDraft();
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));
    await waitFor(() => expect(result.current.draftTitle).not.toBeNull());

    act(() => result.current[handler]());
    expect(result.current.draftTitle).toBeNull();
    expect(promptEvents()[1]).toEqual({
      surface: 'app_open',
      action,
      to_step: 1,
      to_step_name: 'Task',
    });
    await settle();
    expect(await getDraftAbandonedAt(USER)).toBeNull();
  });

  it('evaluates once per app open, not once per mounted shell', async () => {
    await seedAbandonedDraft();
    const first = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));
    const second = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));

    await waitFor(() => expect(first.result.current.draftTitle).not.toBeNull());
    expect(second.result.current.draftTitle).toBeNull();
    expect(promptEvents().filter(e => e.action === 'shown')).toHaveLength(1);
  });

  it('counts a return after a long background as a new app open, a short one not', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    const { result } = renderHook(() => useResumeComposerPrompt(USER, 'bounty'));
    await settle();
    expect(result.current.draftTitle).toBeNull();

    // The poster tab-switches away from a draft, then backgrounds briefly.
    await seedAbandonedDraft();
    act(() => appStateListener?.('background'));
    now.mockReturnValue(1_000_000 + SESSION_GAP_MS - 1);
    act(() => appStateListener?.('active'));
    await settle();
    expect(result.current.draftTitle).toBeNull();

    act(() => appStateListener?.('background'));
    now.mockReturnValue(1_000_000 + 3 * SESSION_GAP_MS);
    act(() => appStateListener?.('active'));
    await waitFor(() => expect(result.current.draftTitle).toBe('Mount my TV'));
    now.mockRestore();
  });
});

describe('abandoned-draft flag lifecycle in useBountyDraft', () => {
  it('is cleared when the draft is cleared (publish or discard)', async () => {
    await seedAbandonedDraft();
    const { result } = renderHook(() => useBountyDraft(USER));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.clearDraft();
    });
    expect(await getDraftAbandonedAt(USER)).toBeNull();
  });

  it('is cleared on sign-out', async () => {
    await seedAbandonedDraft();
    await clearBountyDraftForUser(USER);
    expect(await getDraftAbandonedAt(USER)).toBeNull();
  });
});
