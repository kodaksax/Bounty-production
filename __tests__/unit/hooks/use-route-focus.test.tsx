/**
 * hooks/useRouteFocus — refresh-on-return for screens that stay mounted under
 * the root stack, plus the focus and swipe-back helpers.
 */
import { NavigationContext } from '@react-navigation/native';
import { act, render } from '@testing-library/react-native';
import React from 'react';
import {
  useIsScreenFocused,
  useModalYieldsToPushedScreens,
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

describe('useRefreshOnReturn — a tab that is not in view', () => {
  function TabProbe({ onReturn, active }: { onReturn: () => void; active: boolean }) {
    useRefreshOnReturn(onReturn, { active });
    return null;
  }

  it('holds a return until the tab is shown, then refreshes once', () => {
    const nav = fakeNavigation();
    const onReturn = jest.fn();
    const { rerender } = render(withNavigation(nav, <TabProbe onReturn={onReturn} active={false} />));

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(onReturn).not.toHaveBeenCalled();

    rerender(withNavigation(nav, <TabProbe onReturn={onReturn} active />));
    expect(onReturn).toHaveBeenCalledTimes(1);

    // Leaving and re-entering the tab with no return in between: nothing new.
    rerender(withNavigation(nav, <TabProbe onReturn={onReturn} active={false} />));
    rerender(withNavigation(nav, <TabProbe onReturn={onReturn} active />));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('refreshes straight away when the tab is in view', () => {
    const nav = fakeNavigation();
    const onReturn = jest.fn();
    render(withNavigation(nav, <TabProbe onReturn={onReturn} active />));

    act(() => nav.emit('blur'));
    act(() => nav.emit('focus'));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it('never refreshes on a plain tab switch', () => {
    const nav = fakeNavigation();
    const onReturn = jest.fn();
    const { rerender } = render(withNavigation(nav, <TabProbe onReturn={onReturn} active={false} />));
    rerender(withNavigation(nav, <TabProbe onReturn={onReturn} active />));
    expect(onReturn).not.toHaveBeenCalled();
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

describe('useModalYieldsToPushedScreens', () => {
  type Result = ReturnType<typeof useModalYieldsToPushedScreens>;
  let latest: Result = { presented: false, onClosed: () => {} };
  function ModalProbe({ visible, onClose }: { visible: boolean; onClose: () => void }) {
    latest = useModalYieldsToPushedScreens(visible, onClose);
    return null;
  }

  it('hides while a pushed screen covers it and comes back on return, without closing', () => {
    const nav = fakeNavigation();
    const onClose = jest.fn();
    render(withNavigation(nav, <ModalProbe visible onClose={onClose} />));
    expect(latest.presented).toBe(true);

    // Tapping the poster pushes their profile.
    act(() => nav.emit('blur'));
    expect(latest.presented).toBe(false);
    // AppModal reports its (hide) animation finished — not a real close.
    act(() => latest.onClosed());
    expect(onClose).not.toHaveBeenCalled();

    // Back from the profile.
    act(() => nav.emit('focus'));
    expect(latest.presented).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes normally once the close animation finishes', () => {
    const nav = fakeNavigation();
    const onClose = jest.fn();
    const { rerender } = render(withNavigation(nav, <ModalProbe visible onClose={onClose} />));

    rerender(withNavigation(nav, <ModalProbe visible={false} onClose={onClose} />));
    expect(latest.presented).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
    act(() => latest.onClosed());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes for good when closed while hidden (push, then close)', () => {
    const nav = fakeNavigation();
    const onClose = jest.fn();
    const { rerender } = render(withNavigation(nav, <ModalProbe visible onClose={onClose} />));

    act(() => nav.emit('blur'));
    rerender(withNavigation(nav, <ModalProbe visible={false} onClose={onClose} />));
    expect(onClose).toHaveBeenCalled();

    act(() => nav.emit('focus'));
    expect(latest.presented).toBe(false);
  });

  it('behaves like a plain modal outside a navigator', () => {
    render(withNavigation(null, <ModalProbe visible onClose={jest.fn()} />));
    expect(latest.presented).toBe(true);
  });
});
