/**
 * The keyboard-avoidance primitive backing every text field in the app —
 * see components/ui/keyboard-avoiding.
 *
 * What matters here is the *overlap arithmetic*, because that is what the
 * original bug got wrong: RN's KeyboardAvoidingView measured the wrong frame
 * and left the bounty detail modal's composer under the keyboard. These tests
 * pin the geometry (screenY-derived overlap, offset subtraction, clamping)
 * and the animation timing coming from the OS event rather than a guess.
 */
import { act, render } from '@testing-library/react-native';
import { Animated, Keyboard, Platform, Text } from 'react-native';
import {
  KeyboardStickyView,
  keyboardAwareListProps,
  useKeyboardInset,
} from '../../components/ui/keyboard-avoiding';

const WINDOW_HEIGHT = 812;

jest.mock('react-native/Libraries/Utilities/Dimensions', () => ({
  get: () => ({ width: 375, height: 812, scale: 2, fontScale: 1 }),
  addEventListener: () => ({ remove: () => {} }),
  set: () => {},
}));

type Listeners = Record<string, ((event: unknown) => void)[]>;

let listeners: Listeners;

beforeEach(() => {
  listeners = {};
  jest.spyOn(Keyboard, 'addListener').mockImplementation((event: string, handler: any) => {
    (listeners[event] ??= []).push(handler);
    return {
      remove: () => {
        listeners[event] = (listeners[event] ?? []).filter(h => h !== handler);
      },
    } as any;
  });
  jest.spyOn(Animated, 'timing').mockImplementation(((value: any, config: any) => ({
    start: (cb?: (r: { finished: boolean }) => void) => {
      // Land on the final value immediately; the curve itself is UIKit's.
      value.setValue(config.toValue);
      cb?.({ finished: true });
    },
    stop: () => {},
    reset: () => {},
  })) as any);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function emit(event: string, payload: unknown) {
  act(() => {
    (listeners[event] ?? []).forEach(handler => handler(payload));
  });
}

/** A keyboard whose top edge sits `overlap` points above the window bottom. */
function keyboardEvent(overlap: number, duration = 250) {
  return {
    duration,
    easing: 'keyboard',
    endCoordinates: {
      screenY: WINDOW_HEIGHT - overlap,
      height: overlap,
      width: 375,
      screenX: 0,
    },
  };
}

function Probe({ offset, enabled }: { offset?: number; enabled?: boolean }) {
  const { height, isVisible } = useKeyboardInset({ offset, enabled });
  return <Text testID="probe">{`${height}:${isVisible}`}</Text>;
}

describe('useKeyboardInset', () => {
  it('starts with no overlap', () => {
    const { getByTestId } = render(<Probe />);
    expect(getByTestId('probe')).toHaveTextContent('0:false');
  });

  it('reports the overlap derived from the keyboard frame, not its height', () => {
    const { getByTestId } = render(<Probe />);
    emit('keyboardWillChangeFrame', keyboardEvent(336));
    expect(getByTestId('probe')).toHaveTextContent('336:true');
  });

  it('subtracts an offset the surface already clears', () => {
    const { getByTestId } = render(<Probe offset={34} />);
    emit('keyboardWillChangeFrame', keyboardEvent(336));
    // 336 covered - 34 of safe-area padding the keyboard already sits over.
    expect(getByTestId('probe')).toHaveTextContent('302:true');
  });

  it('clamps at zero when the offset exceeds the overlap', () => {
    const { getByTestId } = render(<Probe offset={200} />);
    emit('keyboardWillChangeFrame', keyboardEvent(60));
    expect(getByTestId('probe')).toHaveTextContent('0:false');
  });

  it('returns to zero when the keyboard hides', () => {
    const { getByTestId } = render(<Probe />);
    emit('keyboardWillChangeFrame', keyboardEvent(336));
    emit('keyboardWillHide', keyboardEvent(0));
    expect(getByTestId('probe')).toHaveTextContent('0:false');
  });

  it('animates with the duration the OS reported, not a guess', () => {
    render(<Probe />);
    // jest.setup's Animated.timing is a module-level jest.fn whose history
    // outlives restoreAllMocks, so start counting from here.
    (Animated.timing as jest.Mock).mockClear();
    emit('keyboardWillChangeFrame', keyboardEvent(336, 420));
    const durations = (Animated.timing as jest.Mock).mock.calls.map(([, config]) => config.duration);
    expect(durations).not.toHaveLength(0);
    durations.forEach(d => expect(d).toBe(420));
  });

  it('falls back to a sane duration when the event reports none', () => {
    render(<Probe />);
    (Animated.timing as jest.Mock).mockClear();
    emit('keyboardWillChangeFrame', { endCoordinates: { screenY: WINDOW_HEIGHT - 336 } });
    const durations = (Animated.timing as jest.Mock).mock.calls.map(([, config]) => config.duration);
    expect(durations).not.toHaveLength(0);
    durations.forEach(d => expect(d).toBe(250));
  });

  it('stays inert on Android, where adjustResize already shrinks the window', () => {
    const originalOS = Platform.OS;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Platform as any).OS = 'android';
    try {
      const { getByTestId } = render(<Probe />);
      // No subscription at all — shifting on top of the OS resize would
      // double-count and launch the content off the top of the screen.
      expect(listeners.keyboardWillChangeFrame ?? []).toHaveLength(0);
      expect(getByTestId('probe')).toHaveTextContent('0:false');
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (Platform as any).OS = originalOS;
    }
  });

  it('stays at zero and never subscribes while disabled', () => {
    const { getByTestId } = render(<Probe enabled={false} />);
    emit('keyboardWillChangeFrame', keyboardEvent(336));
    expect(getByTestId('probe')).toHaveTextContent('0:false');
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<Probe />);
    expect(listeners.keyboardWillChangeFrame ?? []).toHaveLength(1);
    unmount();
    expect(listeners.keyboardWillChangeFrame ?? []).toHaveLength(0);
  });
});

describe('KeyboardStickyView', () => {
  it('renders its bar and rides the keyboard', () => {
    const { getByTestId } = render(
      <KeyboardStickyView offset={34}>
        <Text testID="composer">Send</Text>
      </KeyboardStickyView>
    );
    expect(getByTestId('composer')).toBeTruthy();
    emit('keyboardWillChangeFrame', keyboardEvent(336));
    // The bar translates by -(overlap - offset); a native-driven transform is
    // not readable from the tree, so assert the animation that drives it ran
    // to the right target.
    const targets = (Animated.timing as jest.Mock).mock.calls
      .filter(([, config]) => config.useNativeDriver)
      .map(([, config]) => config.toValue);
    expect(targets).toContain(-302);
  });
});

describe('keyboardAwareListProps', () => {
  it('lets a list inset itself natively and keeps taps working', () => {
    expect(keyboardAwareListProps.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(keyboardAwareListProps.keyboardShouldPersistTaps).toBe('handled');
  });
});
