// hooks/useMessages.sendMessage now emits `message_sent` from the canonical
// (UUID conversation) Supabase send path, which previously bypassed
// analytics entirely -- see hooks/useMessages.ts for the 11-events-against-
// 260-rows finding that motivated this. This suite pins down the emission
// contract so a future refactor can't silently regress it back to dark:
//   * exactly one event on a successful send, with properties describing the
//     message actually sent;
//   * no event at all when the send fails.

const mockTrackEvent = jest.fn().mockResolvedValue(undefined);
const mockSendMessage = jest.fn();
const mockFetchMessages = jest.fn().mockResolvedValue([]);
const mockSubscribeToMessages = jest.fn().mockReturnValue(() => {});

jest.mock('lib/services/analytics-service', () => ({
  analyticsService: { trackEvent: (...a: unknown[]) => mockTrackEvent(...a) },
}));
jest.mock('lib/services/supabase-messaging', () => ({
  sendMessage: (...a: unknown[]) => mockSendMessage(...a),
  fetchMessages: (...a: unknown[]) => mockFetchMessages(...a),
  subscribeToMessages: (...a: unknown[]) => mockSubscribeToMessages(...a),
}));
jest.mock('lib/services/message-service', () => ({
  messageService: { sendMessage: jest.fn() },
}));
jest.mock('lib/utils/data-utils', () => ({
  getCurrentUserId: () => 'user-1',
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));

import { act, renderHook, waitFor } from '@testing-library/react-native';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useMessages } = require('hooks/useMessages');

const CONVERSATION_ID = 'a1b2c3d4-e5f6-4789-8abc-1234567890ab';

describe('useMessages sendMessage analytics', () => {
  beforeEach(() => {
    mockTrackEvent.mockClear();
    mockSendMessage.mockReset();
    mockFetchMessages.mockClear();
  });

  test('emits message_sent exactly once on a successful send, with matching properties', async () => {
    mockSendMessage.mockResolvedValue({
      id: 'm1',
      conversationId: CONVERSATION_ID,
      senderId: 'user-1',
      text: 'hello there',
      createdAt: new Date().toISOString(),
      status: 'sent',
    });

    const { result } = renderHook(() => useMessages(CONVERSATION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.sendMessage('hello there');
    });

    expect(mockTrackEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith('message_sent', {
      conversationId: CONVERSATION_ID,
      messageLength: 'hello there'.length,
    });
  });

  test('does not emit message_sent when the send fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useMessages(CONVERSATION_ID));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.sendMessage('this will fail');
    });

    expect(mockTrackEvent).not.toHaveBeenCalled();
    // The failed message stays in the list (marked failed) rather than vanishing.
    const failed = result.current.messages.find(m => m.text === 'this will fail');
    expect(failed?.status).toBe('failed');
  });
});
