/**
 * useBountyDraft drives the 24h unfinished-post reminder
 * (lib/services/draft-reminder.ts): saving an in-progress draft arms it,
 * emptying the title, publishing (clearDraft) or signing out
 * (clearBountyDraftForUser) cancels it.
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

const mockScheduleSoon = jest.fn();
const mockCancel = jest.fn(async () => undefined);
jest.mock('lib/services/draft-reminder', () => ({
  scheduleDraftReminderSoon: (...args: unknown[]) => mockScheduleSoon(...args),
  cancelDraftReminder: (...args: unknown[]) => mockCancel(...(args as [])),
}));

import { clearBountyDraftForUser, useBountyDraft } from 'app/hooks/useBountyDraft';

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
});

async function renderDraft(userId?: string) {
  const hook = renderHook(() => useBountyDraft(userId));
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}

it('arms the reminder with the saved draft', async () => {
  const { result } = await renderDraft('user-1');
  await act(() => result.current.saveDraft({ title: 'Walk my dog' }));

  expect(mockScheduleSoon).toHaveBeenCalledWith(
    'user-1',
    expect.objectContaining({ title: 'Walk my dog' })
  );
});

it('cancels it when the title is emptied', async () => {
  const { result } = await renderDraft('user-1');
  await act(() => result.current.saveDraft({ title: 'Walk my dog' }));
  await act(() => result.current.saveDraft({ title: '  ' }));

  expect(mockCancel).toHaveBeenCalledWith('user-1');
});

it('cancels it on publish (clearDraft) and on sign-out', async () => {
  const { result } = await renderDraft('user-1');
  await act(() => result.current.clearDraft());
  expect(mockCancel).toHaveBeenCalledWith('user-1');

  mockCancel.mockClear();
  await clearBountyDraftForUser('user-1');
  expect(mockCancel).toHaveBeenCalledWith('user-1');
});

it('leaves an anonymous draft alone', async () => {
  const { result } = await renderDraft(undefined);
  await act(() => result.current.saveDraft({ title: 'Walk my dog' }));
  await act(() => result.current.clearDraft());

  expect(mockScheduleSoon).not.toHaveBeenCalled();
  expect(mockCancel).not.toHaveBeenCalled();
});
