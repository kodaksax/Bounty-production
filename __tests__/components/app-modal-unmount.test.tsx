/**
 * AppModal unmount hardening.
 *
 * The native <Modal> unmounts only once the close animation settles. The
 * close callback reports `finished === false` when it is interrupted, and on
 * the UI thread that report can also be dropped entirely — which used to leave
 * the Modal mounted at zero opacity, an invisible overlay that swallowed every
 * touch behind it (the dead-button reports on the feed detail modal). A
 * fallback timer now forces the unmount so a stuck callback cannot strand it.
 *
 * This file overrides the global reanimated mock so `withTiming` never reports
 * completion, reproducing the interrupted-close condition.
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
    // The interrupted close: start the animation but never report completion.
    withTiming: (value: unknown) => value,
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

describe('AppModal unmount hardening', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stops intercepting touches the moment it starts closing, before it unmounts', () => {
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
    // Still mounted (the animation never reported completion, timers not
    // advanced), but already inert so it can't swallow taps behind it.
    expect(findGate(toJSON()).props.pointerEvents).toBe('none');
  });

  it('unmounts and fires onClosed even when the close callback never completes', () => {
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
    // The animation callback never fired, so without the fallback the Modal
    // would still be mounted here.
    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(onClosed).toHaveBeenCalledTimes(1);
    expect(toJSON()).toBeNull();
  });

  it('stays mounted when a reopen interrupts the close before the fallback fires', () => {
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
});
