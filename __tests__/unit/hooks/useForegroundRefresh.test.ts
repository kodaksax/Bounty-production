/**
 * Unit tests for useForegroundRefresh
 *
 * Verifies the hook fires its callback only when the app returns to the
 * foreground after being backgrounded for at least the configured threshold.
 */

import { act, renderHook } from '@testing-library/react-native';

// ── AppState mock ─────────────────────────────────────────────────────────────

let appStateCallback: ((state: string) => void) | undefined;
const removeListener = jest.fn();

import { useForegroundRefresh, DEFAULT_MIN_BACKGROUND_MS } from '../../../hooks/useForegroundRefresh';

const changeAppState = (state: string) => {
  act(() => {
    appStateCallback?.(state);
  });
};

beforeAll(() => {
  // Extend the existing react-native mock (from jest.setup.js) with AppState rather
  // than replacing the entire module. Replacing it would drop View, Text, Platform,
  // StyleSheet, etc. that @testing-library/react-native internals rely on.
  const rn = require('react-native') as any;
  if (!rn.AppState) {
    rn.AppState = { currentState: 'active', addEventListener: jest.fn() };
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  // Pin the fake-timer clock to a fixed epoch so tests are fully deterministic
  // regardless of wall-clock drift or timer state left by prior suites.
  jest.useFakeTimers({ now: 0 });
  appStateCallback = undefined;
  // Use jest.spyOn for proper cleanup via restoreAllMocks rather than direct assignment.
  const { AppState } = require('react-native') as any;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event: string, cb: (state: string) => void) => {
    appStateCallback = cb;
    return { remove: removeListener };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('useForegroundRefresh', () => {
  it('invokes the callback when foregrounded after a long background period', () => {
    const onForeground = jest.fn();
    renderHook(() => useForegroundRefresh(onForeground));

    changeAppState('background');
    act(() => {
      jest.advanceTimersByTime(DEFAULT_MIN_BACKGROUND_MS + 1000);
    });
    changeAppState('active');

    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback for short background periods', () => {
    const onForeground = jest.fn();
    renderHook(() => useForegroundRefresh(onForeground));

    changeAppState('background');
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    changeAppState('active');

    expect(onForeground).not.toHaveBeenCalled();
  });

  it('respects a custom minBackgroundMs threshold', () => {
    const onForeground = jest.fn();
    renderHook(() => useForegroundRefresh(onForeground, { minBackgroundMs: 500 }));

    changeAppState('background');
    act(() => {
      jest.advanceTimersByTime(600);
    });
    changeAppState('active');

    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('measures from the first inactive/background transition', () => {
    const onForeground = jest.fn();
    renderHook(() => useForegroundRefresh(onForeground, { minBackgroundMs: 1000 }));

    changeAppState('inactive');
    act(() => {
      jest.advanceTimersByTime(800);
    });
    // 'inactive' → 'background' must not reset the timestamp.
    changeAppState('background');
    act(() => {
      jest.advanceTimersByTime(300);
    });
    changeAppState('active');

    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback on the initial mount', () => {
    const onForeground = jest.fn();
    renderHook(() => useForegroundRefresh(onForeground));

    expect(onForeground).not.toHaveBeenCalled();
  });

  it('uses the latest callback without re-registering the listener', () => {
    const { AppState } = require('react-native');
    const first = jest.fn();
    const second = jest.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useForegroundRefresh(cb, { minBackgroundMs: 0 }),
      { initialProps: { cb: first } }
    );
    rerender({ cb: second });

    changeAppState('background');
    changeAppState('active');

    expect(AppState.addEventListener).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('does not crash when the callback throws', () => {
    const onForeground = jest.fn(() => {
      throw new Error('boom');
    });
    renderHook(() => useForegroundRefresh(onForeground, { minBackgroundMs: 0 }));

    changeAppState('background');
    expect(() => changeAppState('active')).not.toThrow();
    expect(onForeground).toHaveBeenCalledTimes(1);
  });

  it('removes the AppState listener on unmount', () => {
    const { unmount } = renderHook(() => useForegroundRefresh(jest.fn()));
    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });
});
