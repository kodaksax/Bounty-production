/**
 * useSafeBack — the back arrow on a screen opened from a push notification or
 * a shared link has nothing to pop, so a bare router.back() does nothing and
 * strands the user. The hook must go back when it can and otherwise land on
 * the fallback.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

// Stable method references, as expo-router's imperative router provides.
const mockRouter = {
  back: mockBack,
  replace: mockReplace,
  canGoBack: () => mockCanGoBack,
};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

import { FEED_FALLBACK, useSafeBack } from '../../../hooks/useSafeBack';

describe('useSafeBack', () => {
  beforeEach(() => {
    mockBack.mockClear();
    mockReplace.mockClear();
    mockCanGoBack = true;
  });

  it('pops the stack when there is history', () => {
    const { result } = renderHook(() => useSafeBack());
    act(() => result.current());
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('lands on the feed fallback when opened with nothing underneath', () => {
    mockCanGoBack = false;
    const { result } = renderHook(() => useSafeBack());
    act(() => result.current());
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith(FEED_FALLBACK);
  });

  it('uses the caller-supplied fallback', () => {
    mockCanGoBack = false;
    const fallback = { pathname: '/in-progress/[bountyId]/hunter', params: { bountyId: '42' } } as const;
    const { result } = renderHook(() => useSafeBack(fallback));
    act(() => result.current());
    expect(mockReplace).toHaveBeenCalledWith(fallback);
  });

  it('keeps the same callback when callers pass a fresh inline fallback each render', () => {
    const { result, rerender } = renderHook(({ id }) =>
      useSafeBack({ pathname: '/postings/[bountyId]', params: { bountyId: id } }),
      { initialProps: { id: '1' } }
    );
    const first = result.current;
    rerender({ id: '1' });
    expect(result.current).toBe(first);
  });

  it('uses the latest fallback even though the callback is stable', () => {
    mockCanGoBack = false;
    const { result, rerender } = renderHook(({ id }) =>
      useSafeBack({ pathname: '/postings/[bountyId]', params: { bountyId: id } }),
      { initialProps: { id: '1' } }
    );
    rerender({ id: '2' });
    act(() => result.current());
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/postings/[bountyId]', params: { bountyId: '2' } });
  });
});
