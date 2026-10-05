import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useChatSendProtection } from '../../../hooks/use-chat-send-protection';
import { trustSafetyStrings } from '../../../lib/strings/trust-safety';

describe('chat pre-send confirmation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('passes ordinary messages without confirmation', async () => {
    const { result } = renderHook(() => useChatSendProtection('a'));
    expect(await result.current('Here is my portfolio https://example.com')).toBe(true);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it.each([
    ['Pay me via Venmo', trustSafetyStrings.paymentRequest],
    ['Text me', trustSafetyStrings.contactRequest],
  ])('offers accessible native Edit and Send anyway choices for %s', async (text, copy) => {
    const { result } = renderHook(() => useChatSendProtection('a'));
    let decision!: Promise<boolean>;
    act(() => { decision = result.current(text); });
    const [, message, buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(message).toBe(copy);
    expect(buttons.map((b: { text: string }) => b.text)).toEqual(['Edit', 'Send anyway']);
    await act(async () => { buttons[0].onPress(); expect(await decision).toBe(false); });
    act(() => { decision = result.current(text); });
    await act(async () => {
      (Alert.alert as jest.Mock).mock.calls[1][2][1].onPress();
      expect(await decision).toBe(true);
    });
  });

  it('cancels on native dismissal, ignores repeated taps, and accepts only once', async () => {
    const { result } = renderHook(() => useChatSendProtection('a'));
    const decision = result.current('Pay via Zelle');
    expect(await result.current('Pay via Zelle')).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    const call = (Alert.alert as jest.Mock).mock.calls[0];
    call[3].onDismiss();
    call[2][1].onPress();
    expect(await decision).toBe(false);
  });

  it('cancels stale confirmations when the conversation changes or unmounts', async () => {
    const { result, rerender, unmount } = renderHook(({ id }) => useChatSendProtection(id),
      { initialProps: { id: 'a' } });
    const decision = result.current('Text me');
    rerender({ id: 'b' });
    (Alert.alert as jest.Mock).mock.calls[0][2][1].onPress();
    expect(await decision).toBe(false);
    const next = result.current('Text me');
    unmount();
    expect(await next).toBe(false);
  });
});
