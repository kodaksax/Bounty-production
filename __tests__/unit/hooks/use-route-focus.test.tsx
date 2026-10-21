/**
 * hooks/useRouteFocus — refresh-on-return for screens that stay mounted under
 * the root stack, plus the focus and swipe-back helpers.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';
import React from 'react';
import {
  useIsScreenFocused,
  useRefreshOnReturn,
  useSwipeBackEnabled,
} from '../../../hooks/useRouteFocus';

type Listener = () => void;

function fakeNavigation(initiallyFocused = true) {
  let focused = initiallyFocused;
  const listeners: Record<'focus' | 'blur', Set<Listener>> = { focus: new Set(), blur: new Set() };
  return {
    isFocused: () => focused,
    addListener: (event: 'focus' | 'blur', cb: Listener) => {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    setOptions: jest.fn(),
    emit(event: 'focus' | 'blur') {
      focused = event === 'focus';
      listeners[event].forEach(cb => cb());
    },
  };
}

function withNavigation(navigation: ReturnType<typeof fakeNavigation> | null, child: React.ReactElement) {
  return (
    <NavigationContext.Provider value={navigation as never}>{child}</NavigationContext.Provider>
  );
}

function RefreshProbe({ onReturn }: { onReturn: () => void }) {
  useRefreshOnReturn(onReturn);
  return null;
}

describe('useRefreshOnReturn', () => {
  it('does not fire on the first focus — mount effects cover that', () => {
    const nav = fakeNavigation();
    const onReturn = jest.fn();
    render(withNavigation(nav, <RefreshProbe onReturn={onReturn} />));

    act(() => nav.emit('focus'));
    expect(onReturn).not.toHaveBeenCalled();
  });

  it('fires once each time the screen comes back after being covered', () => {
    const nav = fakeNavigation();
    const onReturn = jest.fn();
    render(withNavigation(nav, <RefreshProbe onReturn={onReturn} />));

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(onReturn).toHaveBeenCalledTimes(1);

    act(() => nav.emit('focus'));
    expect(onReturn).toHaveBeenCalledTimes(1);

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(onReturn).toHaveBeenCalledTimes(2);
  });

  it('calls the latest callback without re-subscribing', () => {
    const nav = fakeNavigation();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(withNavigation(nav, <RefreshProbe onReturn={first} />));
    rerender(withNavigation(nav, <RefreshProbe onReturn={second} />));

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('is inert outside a navigator', () => {
    expect(() => render(withNavigation(null, <RefreshProbe onReturn={jest.fn()} />))).not.toThrow();
  });
});

describe('useIsScreenFocused', () => {
  function FocusProbe({ onValue }: { onValue: (focused: boolean) => void }) {
    onValue(useIsScreenFocused());
    return null;
  }

  it('follows focus and blur', () => {
    const nav = fakeNavigation();
    const seen: boolean[] = [];
    render(withNavigation(nav, <FocusProbe onValue={v => seen.push(v)} />));
    expect(seen[seen.length - 1]).toBe(true);

    act(() => nav.emit('blur'));
    expect(seen[seen.length - 1]).toBe(false);

    act(() => nav.emit('focus'));
    expect(seen[seen.length - 1]).toBe(true);
  });

  it('reports focused outside a navigator', () => {
    const seen: boolean[] = [];
    render(withNavigation(null, <FocusProbe onValue={v => seen.push(v)} />));
    expect(seen[seen.length - 1]).toBe(true);
  });
});

describe('useSwipeBackEnabled', () => {
  function SwipeProbe({ enabled }: { enabled: boolean }) {
    useSwipeBackEnabled(enabled);
    return null;
  }

  it('sets gestureEnabled on the screen as the flag changes', () => {
    const nav = fakeNavigation();
    const { rerender } = render(withNavigation(nav, <SwipeProbe enabled />));
    expect(nav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });

    rerender(withNavigation(nav, <SwipeProbe enabled={false} />));
    expect(nav.setOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
  });
});
