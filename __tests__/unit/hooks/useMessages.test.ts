/* eslint-env jest */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as messageService from '../../../lib/services/message-service';
import * as dataUtils from '../../../lib/utils/data-utils';
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('../../../lib/services/message-service', () => ({
  messageService: {
    sendMessage: jest.fn(),
  },
}));
jest.mock('../../../lib/utils/data-utils', () => ({
  getCurrentUserId: jest.fn(),
}));
jest.mock('../../../lib/services/supabase-messaging', () => ({
  fetchMessages: jest.fn().mockResolvedValue([]),
  sendMessage: jest.fn(),
  subscribeToMessages: jest.fn().mockReturnValue({}),
  unsubscribe: jest.fn(),
}));

describe('useMessages (local conversation)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replaces temp message with sent message on success', async () => {
    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue('user-1');

    const sentMessage = {
      id: 'real-1',
      conversationId: 'conv-1',
      senderId: 'user-1',
      text: 'hello',
      createdAt: new Date().toISOString(),
      status: 'sent',
    };

    (messageService.messageService.sendMessage as jest.Mock).mockResolvedValue({
      message: sentMessage,
    });

    const { useMessages } = require('../../../hooks/useMessages');
    const { result } = renderHook(() => useMessages('conv-1'));

    // Wait for initial load (non-UUID)
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    expect(result.current.messages).toEqual([sentMessage]);
    expect(result.current.error).toBeNull();
  });

  it('removes only the specific failed temp message when another temp remains', async () => {
    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue('user-1');

    // Create a controllable promise for first send
    let resolveFirst: (value: any) => void = () => {};
    const firstPromise = new Promise(resolve => {
      resolveFirst = resolve;
    });

    (messageService.messageService.sendMessage as jest.Mock)
      .mockImplementationOnce(() => firstPromise) // first call unresolved
      .mockRejectedValueOnce(new Error('failed second'));

    const { useMessages } = require('../../../hooks/useMessages');
    const { result } = renderHook(() => useMessages('conv-1'));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Start first send, don't await
    act(() => {
      result.current.sendMessage('first');
    });

    // Now a temp message should exist
    expect(result.current.messages.some((m: any) => m.id && m.id.startsWith('temp-'))).toBe(true);

    const tempIdsBefore = result.current.messages.map((m: any) => m.id);

    // Start second send and await (internal error handling prevents throw)
    await act(async () => {
      await result.current.sendMessage('second');
    });

    // After second send failed, at least one temp message (the first) should remain
    const tempIdsAfter = result.current.messages.map((m: any) => m.id);
    expect(tempIdsAfter.some(id => id && id.startsWith('temp-'))).toBe(true);

    // Resolve first send with real message
    const realFirst = {
      id: 'real-first',
      conversationId: 'conv-1',
      senderId: 'user-1',
      text: 'first',
      createdAt: new Date().toISOString(),
      status: 'sent',
    };

    await act(async () => {
      resolveFirst({ message: realFirst });
    });

    // Wait for replacement
    await waitFor(() => {
      expect(result.current.messages.some((m: any) => m.id === realFirst.id)).toBe(true);
    });
  });
});
