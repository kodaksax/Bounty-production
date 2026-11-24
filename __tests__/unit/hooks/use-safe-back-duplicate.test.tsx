/**
 * useSafeBack under a double tap. The first back shrinks the stack, so a
 * second tap on the same (still-mounted) back button would see
 * canGoBack() === false and replace the screen it just landed on with the
 * feed fallback. With the router wrapped by the real navigation guard, as in
 * the app, the second tap must do nothing.
 */
import { act, renderHook } from '@testing-library/react-native';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;

jest.mock('expo-router', () => {
  const { navigationGuard } = jest.requireActual('../../../lib/navigation/navigation-guard');
  const router = navigationGuard.wrapRouter({
    back: () => {
      mockBack();
      // Popping the only entry above the root leaves nothing to go back to.
      mockCanGoBack = false;
    },
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => mockCanGoBack,
  });
  return { useRouter: () => router };
});

import { useSafeBack } from '../../../hooks/useSafeBack';

beforeEach(() => {
  jest.useFakeTimers();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack = true;
});
afterEach(() => jest.useRealTimers());

it('a double tap goes back once and never replaces with the fallback', () => {
  const { result } = renderHook(() => useSafeBack());
  act(() => {
    result.current();
    result.current();
    result.current();
  });
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('a later, deliberate tap still works once the back has settled', () => {
  const { result } = renderHook(() => useSafeBack());
  act(() => result.current());
  act(() => {
    jest.advanceTimersByTime(16);
    jest.advanceTimersByTime(600);
  });
  act(() => result.current());
  // Nothing left to pop now, so the deliberate tap lands on the fallback.
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).toHaveBeenCalledTimes(1);
});
