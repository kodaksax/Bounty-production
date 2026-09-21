/**
 * AppModal close hardening.
 *
 * The native <Modal> is a separate OS window/view controller that remains
 * the top-level touch target for as long as it's presented, no matter what
 * `pointerEvents` its children carry — so on close it is torn down
 * immediately, before any fade plays, and a plain (non-Modal) view finishes
 * the fade-out in its place. That view is always `pointerEvents="none"`, so
 * it can never strand a touch-blocking overlay the way the old
 * animation-gated unmount could (the dead-button reports on the feed detail
 * modal).
 *
 * The close-completion callback (from `withTiming`) can also be interrupted
 * or arrive late — e.g. after a rapid reopen has already cancelled that
 * close attempt. A fallback timer covers the "never arrives" case; cleanup
 * marking the attempt `settled` covers the "arrives late" case.
 *
 * This file overrides the global reanimated mock so `withTiming`'s
 * completion callback is captured instead of invoked, letting tests fire it
 * (or not) on their own schedule to reproduce both cases.
 */
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

jest.mock('react-native-reanimated', () => {
  const RN = require('react-native');
  const identity = (value: unknown) => value;
  return {
    __esModule: true,
    default: { View: RN.View, createAnimatedComponent: (c: unknown) => c },
    View: RN.View,
    createAnimatedComponent: (c: unknown) => c,
    useSharedValue: (initial: unknown) => ({ value: initial }),
    useAnimatedStyle: () => ({}),
    interpolate: identity,
    // Captures the completion callback instead of invoking it, so a test can
    // fire it whenever it likes (or never) to reproduce an interrupted,
    // dropped, or late-arriving report from the UI thread.
    withTiming: (value: unknown, _config: unknown, callback?: (finished: boolean) => void) => {
      (global as any).__reanimatedCloseCallback = callback ?? null;
      return value;
    },
    Easing: { out: (fn: unknown) => fn || ((t: number) => t), cubic: (t: number) => t },
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

// eslint-disable-next-line import/first
import { AppModal } from '../../components/ui/app-modal';

/** Find the touch-gated overlay container (pointerEvents 'auto' or 'none'). */
function findGate(node: any): any {
  if (!node || typeof node !== 'object') return undefined;
  const pe = node.props?.pointerEvents;
  if (pe === 'auto' || pe === 'none') return node;
  for (const child of node.children ?? []) {
    const found = findGate(child);
    if (found) return found;
  }
  return undefined;
}

describe('AppModal close hardening', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (global as any).__reanimatedCloseCallback = null;
  });
  afterEach(() => jest.useRealTimers());

  it('stops intercepting touches the moment it starts closing, before the fade settles', () => {
    const { rerender, toJSON } = render(
      <AppModal visible onRequestClose={jest.fn()} onClosed={jest.fn()}>
        <Text>content</Text>
      </AppModal>
    );
    expect(findGate(toJSON()).props.pointerEvents).toBe('auto');

    rerender(
      <AppModal visible={false} onRequestClose={jest.fn()} onClosed={jest.fn()}>
        <Text>content</Text>
      </AppModal>
    );
    // The close callback hasn't reported and the fallback timer hasn't fired,
    // so the fade-out view is still up — but it's already inert.
    expect(findGate(toJSON()).props.pointerEvents).toBe('none');
  });

  it('settles and fires onClosed even when the close callback never arrives', () => {
    const onClosed = jest.fn();
    const { rerender, toJSON } = render(
      <AppModal visible onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );
    expect(toJSON()).not.toBeNull();

    rerender(
      <AppModal visible={false} onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );
    // The animation callback never fired, so without the fallback the
    // fade-out view would still be rendered here.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(toJSON()).toBeNull();
  });

  it('stays open when a reopen interrupts the close before the fallback fires', () => {
    const onClosed = jest.fn();
    const { rerender, toJSON } = render(
      <AppModal visible onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );

    rerender(
      <AppModal visible={false} onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );
    // Reopen before the fallback timer would run.
    rerender(
      <AppModal visible onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onClosed).not.toHaveBeenCalled();
    expect(toJSON()).not.toBeNull();
  });

  it('ignores a close callback that lands late, after a reopen already cancelled it', () => {
    const onClosed = jest.fn();
    const { rerender, toJSON } = render(
      <AppModal visible onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );

    rerender(
      <AppModal visible={false} onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );
    const staleCallback = (global as any).__reanimatedCloseCallback;
    expect(typeof staleCallback).toBe('function');

    // Reopen before that report arrives — this must cancel the close attempt
    // outright, not just its fallback timer.
    rerender(
      <AppModal visible onRequestClose={jest.fn()} onClosed={onClosed}>
        <Text>content</Text>
      </AppModal>
    );

    // The stale callback from the cancelled close lands late, the way a
    // delayed (not dropped) UI-thread report can. It must be a no-op: it
    // belongs to a close attempt that's no longer current.
    act(() => {
      staleCallback(true);
    });

    expect(onClosed).not.toHaveBeenCalled();
    expect(toJSON()).not.toBeNull();
  });
});
