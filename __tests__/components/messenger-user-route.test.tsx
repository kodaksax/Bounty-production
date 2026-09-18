import { render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

const mockBack = jest.fn();
const mockGetFullConversationWithUser = jest.fn();
const mockGetOrCreateConversation = jest.fn();
const mockGetMessages = jest.fn();
const mockMarkAsRead = jest.fn();
const mockSubscribeToMessages = jest.fn(() => jest.fn());

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ userId: 'other-user-id' }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('app/tabs/full-chat-detail-screen', () => ({
  __esModule: true,
  default: ({ conversation }: { conversation: { id: string } }) => (
    <Text>{conversation.id}</Text>
  ),
}));

jest.mock('../../lib/services/message-service', () => ({
  messageService: {
    getFullConversationWithUser: (...args: any[]) => mockGetFullConversationWithUser(...args),
    getOrCreateConversation: (...args: any[]) => mockGetOrCreateConversation(...args),
    getMessages: (...args: any[]) => mockGetMessages(...args),
  },
}));

jest.mock('../../lib/services/supabase-messaging', () => ({
  markAsRead: (...args: any[]) => mockMarkAsRead(...args),
  subscribeToMessages: (...args: any[]) => mockSubscribeToMessages(...args),
}));

jest.mock('../../lib/utils/data-utils', () => ({
  getCurrentUserId: () => 'current-user-id',
}));

import UserConversationRoute from '../../app/tabs/messenger/user/[userId]';

describe('UserConversationRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks every backing conversation read and subscribes to non-primary threads', async () => {
    mockGetFullConversationWithUser.mockResolvedValue({
      id: 'full-current-user-id-other-user-id',
      realConversationId: 'conv-new',
      backingConversationIds: ['conv-new', 'conv-old'],
      isGroup: false,
      name: 'Conversation',
      participantIds: ['current-user-id', 'other-user-id'],
      messages: [],
    });
    mockMarkAsRead.mockResolvedValue(undefined);

    render(<UserConversationRoute />);

    await waitFor(() =>
      expect(mockMarkAsRead).toHaveBeenCalledWith('conv-new', 'current-user-id')
    );
    expect(mockMarkAsRead).toHaveBeenCalledWith('conv-old', 'current-user-id');
    expect(mockSubscribeToMessages).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToMessages).toHaveBeenCalledWith('conv-old', expect.any(Function));
    expect(mockGetOrCreateConversation).not.toHaveBeenCalled();
    expect(mockGetMessages).not.toHaveBeenCalled();
  });
});
