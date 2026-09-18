/**
 * Tests for the chat route (app/tabs/messenger/[conversationId].tsx).
 *
 * Covers the two poster-facing fixes for "Message Hunter kills the app":
 *   1. A conversation that is not yet in the cached list is fetched directly
 *      from the message store, so the screen still loads.
 *   2. A throw inside the chat screen is caught by the route's own
 *      ErrorBoundary and shows a fallback, instead of unmounting the app.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { Conversation } from '../../lib/types';

let routerParams: Record<string, string | string[]> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: () => routerParams,
}));

jest.mock('../../lib/posthog', () => ({
  captureException: jest.fn(),
}));

const mockRefresh = jest.fn();
let mockConversations: Conversation[] = [];
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({ conversations: mockConversations, refresh: mockRefresh }),
}));

// The route resolves `../chat-detail-screen` to app/tabs/chat-detail-screen —
// mock it so the test controls what the screen renders (or throws).
let chatScreenImpl: (props: { conversation: Conversation }) => React.ReactElement = ({
  conversation,
}) => <Text>chat:{conversation.id}</Text>;
jest.mock('../../app/tabs/chat-detail-screen', () => ({
  ChatDetailScreen: (props: { conversation: Conversation }) => chatScreenImpl(props),
}));

import ConversationRoute from '../../app/tabs/messenger/[conversationId]';

const conversation: Conversation = {
  id: 'conv-1',
  isGroup: false,
  name: 'Bounty chat',
  participantIds: ['poster-1', 'hunter-1'],
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  routerParams = { conversationId: 'conv-1' };
  mockConversations = [];
  mockRefresh.mockReset();
  mockRefresh.mockResolvedValue([conversation]);
  chatScreenImpl = ({ conversation: c }) => <Text>chat:{c.id}</Text>;
});
afterEach(() => {
  (console.error as jest.Mock).mockRestore?.();
});

it('refreshes participant-scoped conversations when not already loaded', async () => {
  const { findByText } = render(<ConversationRoute />);

  expect(await findByText('chat:conv-1')).toBeTruthy();
  await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
});

it('contains a chat-screen crash in its own boundary instead of rethrowing', async () => {
  chatScreenImpl = () => {
    throw new Error('boom in chat');
  };

  // Rendering must not throw out of the route — the boundary catches it.
  const { findByText } = render(<ConversationRoute />);

  expect(await findByText('Something Went Wrong')).toBeTruthy();
});
