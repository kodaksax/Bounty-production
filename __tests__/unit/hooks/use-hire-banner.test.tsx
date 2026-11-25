/**
 * E2E-05: "You chose Ana. Ana is your helper now." used to vanish after about
 * ten seconds. The banner now stays until the poster dismisses it, across
 * reloads (a fresh mount reads it back from device storage).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';

const mockStore = new Map<string, string>();
jest.mock('../../../lib/storage', () => ({
  storage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => void mockStore.set(k, v),
    removeItem: async (k: string) => void mockStore.delete(k),
  },
}));

import { hireBannerKey, useHireBanner } from '../../../hooks/useHireBanner';

beforeEach(() => mockStore.clear());

async function mount(id = 'b1') {
  const hook = renderHook(() => useHireBanner(id));
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

it('shows nothing for a job with nothing stored (hired before, or elsewhere)', async () => {
  const { result } = await mount();
  expect(result.current.name).toBeNull();
});

it('persists across reloads until dismissed', async () => {
  const first = await mount();
  await act(async () => first.result.current.show('Ana'));
  expect(first.result.current.name).toBe('Ana');
  first.unmount();

  // A reload: a new mount reads it back.
  const second = await mount();
  expect(second.result.current.name).toBe('Ana');
  await act(async () => second.result.current.dismiss());
  expect(second.result.current.name).toBeNull();
  second.unmount();

  const third = await mount();
  expect(third.result.current.name).toBeNull();
});

it('is per job, under a key SecureStore accepts', async () => {
  const a = await mount('b1');
  await act(async () => a.result.current.show('Ana'));
  const b = await mount('b2');
  expect(b.result.current.name).toBeNull();
  expect(hireBannerKey('3d26284b-04c5-4057-9ee4-ed7564bb3e75')).toMatch(/^[A-Za-z0-9._-]+$/);
});

it('is not ready until the stored answer is read, so the page never shows a stage without it', () => {
  const { result } = renderHook(() => useHireBanner('b1'));
  expect(result.current.ready).toBe(false);
});
