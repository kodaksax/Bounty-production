/**
 * AppModal's keyboard avoidance — the global half of the fix for text fields
 * disappearing under the iOS keyboard.
 *
 * RN's KeyboardAvoidingView measures against the window and so does nothing
 * inside a <Modal>; every dialog with an input (the bounty detail composer
 * first among them) inherited that. These tests pin the two things callers
 * depend on: the modal area shrinks by the keyboard's overlap, and children
 * can read the height that is actually left so a fixed-height card can cap
 * itself instead of pushing its own footer off-screen.
 */
import { act, render } from '@testing-library/react-native';
import { Animated, Keyboard, Text } from 'react-native';
import { AppModal, useModalContentHeight } from '../../components/ui/app-modal';

const WINDOW_HEIGHT = 812;
/** `dialogRoot`'s 16pt padding, top and bottom. */
const DIALOG_CHROME = 32;

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
      value.setValue(config.toValue);
      cb?.({ finished: true });
    },
    stop: () => {},
    reset: () => {},
  })) as any);
});

afterEach(() => jest.restoreAllMocks());

function showKeyboard(overlap: number) {
  act(() => {
    (listeners.keyboardWillChangeFrame ?? []).forEach(handler =>
      handler({
        duration: 250,
        easing: 'keyboard',
        endCoordinates: { screenY: WINDOW_HEIGHT - overlap, height: overlap },
      })
    );
  });
}

function HeightProbe() {
  const height = useModalContentHeight();
  return <Text testID="available">{String(height)}</Text>;
}

describe('AppModal keyboard avoidance', () => {
  it('offers children the full window (minus its own padding) with no keyboard', () => {
    const { getByTestId } = render(
      <AppModal visible onRequestClose={jest.fn()}>
        <HeightProbe />
      </AppModal>
    );
    expect(getByTestId('available')).toHaveTextContent(String(WINDOW_HEIGHT - DIALOG_CHROME));
  });

  it('shrinks the height it offers by the keyboard overlap', () => {
    const { getByTestId } = render(
      <AppModal visible onRequestClose={jest.fn()}>
        <HeightProbe />
      </AppModal>
    );
    showKeyboard(336);
    expect(getByTestId('available')).toHaveTextContent(String(WINDOW_HEIGHT - 336 - DIALOG_CHROME));
  });

  it('gives a sheet the whole window minus the keyboard, with no dialog padding', () => {
    const { getByTestId } = render(
      <AppModal visible variant="sheet" onRequestClose={jest.fn()}>
        <HeightProbe />
      </AppModal>
    );
    showKeyboard(336);
    expect(getByTestId('available')).toHaveTextContent(String(WINDOW_HEIGHT - 336));
  });

  it('leaves the layout alone when a modal opts out', () => {
    const { getByTestId } = render(
      <AppModal visible avoidKeyboard={false} onRequestClose={jest.fn()}>
        <HeightProbe />
      </AppModal>
    );
    // No subscription at all, so nothing to fire and nothing to shrink.
    expect(listeners.keyboardWillChangeFrame ?? []).toHaveLength(0);
    expect(getByTestId('available')).toHaveTextContent(String(WINDOW_HEIGHT - DIALOG_CHROME));
  });

  it('does not listen for a keyboard while closed', () => {
    render(
      <AppModal visible={false} onRequestClose={jest.fn()}>
        <HeightProbe />
      </AppModal>
    );
    expect(listeners.keyboardWillChangeFrame ?? []).toHaveLength(0);
  });
});
