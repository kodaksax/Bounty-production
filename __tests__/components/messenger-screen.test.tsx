/**
 * Tests for the Messages list (app/tabs/messenger-screen.tsx), the screen the
 * inbox's chat icon opens.
 *
 * Covers:
 *   - one row per person, newest message first (#875)
 *   - people you have never exchanged a message with are not listed
 *   - the unread dot
 *   - the users-only search bar: results replace the list, exclude yourself,
 *     and tapping one opens the DM with that person
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { Conversation, UserProfile } from '../../lib/types';

const ME = 'me-0000';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

let mockConversations: Conversation[] = [];
jest.mock('../../hooks/useConversations', () => ({
  useConversations: () => ({
    conversations: mockConversations,
    loading: false,
    error: null,
    markAsRead: jest.fn().mockResolvedValue(undefined),
    deleteConversation: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock('../../hooks/useValidUserId', () => ({ useValidUserId: () => ME }));
jest.mock('../../hooks/useNormalizedProfile', () => ({
  useNormalizedProfile: () => ({ profile: null }),
}));

const mockSearchUsers = jest.fn();
jest.mock('../../lib/services/user-search-service', () => ({
  userSearchService: { searchUsers: (...args: unknown[]) => mockSearchUsers(...args) },
}));

jest.mock('../../lib/services/supabase-messaging', () => ({
  generateInitials: (a?: string) => (a ? a.slice(0, 2).toUpperCase() : '??'),
}));
jest.mock('../../lib/services/message-service', () => ({
  messageService: { markAsRead: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../lib/services/monitoring', () => ({ logClientError: jest.fn() }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('react-native-gesture-handler', () => ({
  Swipeable: ({ children }: { children: React.ReactNode }) => children,
}));

// Chrome that isn't under test.
jest.mock('../../components/connection-status', () => ({ ConnectionStatus: () => null }));
jest.mock('../../components/offline-status-badge', () => ({ OfflineStatusBadge: () => null }));
jest.mock('../../components/ui/wallet-balance-button', () => ({ WalletBalanceButton: () => null }));
jest.mock('../../components/ui/branding-logo', () => ({ BrandingLogo: () => null }));
jest.mock('../../components/ui/skeleton-loaders', () => ({ ConversationsListSkeleton: () => null }));
jest.mock('../../components/ui/empty-state', () => {
  const { Text: RNText } = require('react-native');
  return { EmptyState: ({ title }: { title: string }) => <RNText>{title}</RNText> };
});
jest.mock('../../components/ui/search-bar-row', () => {
  const { View: RNView } = require('react-native');
  return {
    SEARCH_FIELD_MAX_FONT_SCALE: 1.3,
    SEARCH_FIELD_TEXT: {},
    SearchBarRow: ({ children }: { children: React.ReactNode }) => <RNView>{children}</RNView>,
  };
});
jest.mock('../../components/ui/avatar', () => {
  const { View: RNView } = require('react-native');
  return {
    Avatar: ({ children }: { children: React.ReactNode }) => <RNView>{children}</RNView>,
    AvatarImage: () => null,
    AvatarFallback: ({ children }: { children: React.ReactNode }) => <RNView>{children}</RNView>,
  };
});
jest.mock('../../app/tabs/chat-detail-screen', () => ({ ChatDetailScreen: () => null }));

import MessengerScreen from '../../app/tabs/messenger-screen';

// The global react-native mock renders FlatList as an empty host element, so
// rows would never appear. Swap in one that renders its items (or its empty
// component), which is all these tests need from it.
beforeAll(() => {
  const RN = require('react-native');
  RN.FlatList = ({ data = [], renderItem, keyExtractor, ListEmptyComponent }: any) => {
    if (data.length === 0 && ListEmptyComponent) {
      return typeof ListEmptyComponent === 'function' ? <ListEmptyComponent /> : ListEmptyComponent;
    }
    return (
      <>
        {data.map((item: any, index: number) => (
          <React.Fragment key={keyExtractor ? keyExtractor(item, index) : index}>
            {renderItem({ item, index })}
          </React.Fragment>
        ))}
      </>
    );
  };
});

function conv(partial: Partial<Conversation> & { id: string; with: string }): Conversation {
  const { with: other, ...rest } = partial;
  return { isGroup: false, name: other, participantIds: [ME, other], ...rest };
}

function user(id: string, username: string, name?: string): UserProfile {
  return { id, username, name, joinDate: '2026-01-01T00:00:00Z' } as UserProfile;
}

beforeEach(() => {
  jest.useFakeTimers();
  mockPush.mockReset();
  mockSearchUsers.mockReset();
  mockConversations = [];
});
afterEach(() => {
  jest.useRealTimers();
});

describe('conversation list', () => {
  it('shows one row per person, most recent message first', () => {
    mockConversations = [
      conv({ id: 'a1', with: 'alice', lastMessage: 'from bounty 1', updatedAt: '2026-09-01T00:00:00Z' }),
      conv({ id: 'b1', with: 'bob', lastMessage: 'latest from bob', updatedAt: '2026-09-20T00:00:00Z' }),
      conv({ id: 'a2', with: 'alice', lastMessage: 'latest from alice', updatedAt: '2026-09-10T00:00:00Z' }),
    ];
    const { getAllByText, queryByText } = render(<MessengerScreen />);

    const names = getAllByText(/^(alice|bob)$/).map((n) => n.props.children);
    expect(names).toEqual(['bob', 'alice']);
    expect(queryByText('latest from alice')).toBeTruthy();
    expect(queryByText('from bounty 1')).toBeNull();
  });

  it('does not list someone you have never messaged', () => {
    mockConversations = [
      conv({ id: 'empty', with: 'stranger', updatedAt: '2026-09-29T00:00:00Z' }),
      conv({ id: 'real', with: 'friend', lastMessage: 'hi', updatedAt: '2026-09-01T00:00:00Z' }),
    ];
    const { queryByText } = render(<MessengerScreen />);

    expect(queryByText('friend')).toBeTruthy();
    expect(queryByText('stranger')).toBeNull();
    expect(queryByText('No messages yet')).toBeNull();
  });

  it('marks unread rows in their accessibility label', () => {
    mockConversations = [
      conv({ id: 'u', with: 'unready', lastMessage: 'ping', unread: 2, updatedAt: '2026-09-02T00:00:00Z' }),
      conv({ id: 'r', with: 'readone', lastMessage: 'pong', unread: 0, updatedAt: '2026-09-01T00:00:00Z' }),
    ];
    const { getByLabelText, queryByLabelText } = render(<MessengerScreen />);

    expect(getByLabelText(/unready, 2 unread/)).toBeTruthy();
    expect(queryByLabelText(/readone, \d+ unread/)).toBeNull();
  });

  it('opens the merged thread with that person on tap', () => {
    mockConversations = [conv({ id: 'a1', with: 'alice', lastMessage: 'yo', updatedAt: '2026-09-01T00:00:00Z' })];
    const { getByLabelText } = render(<MessengerScreen />);

    fireEvent.press(getByLabelText(/^alice\./));
    expect(mockPush).toHaveBeenCalledWith('/tabs/messenger/user/alice');
  });
});

describe('user search', () => {
  async function typeQuery(utils: ReturnType<typeof render>, text: string) {
    fireEvent.changeText(utils.getByLabelText('Search users'), text);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  }

  it('searches users only and replaces the list with results, excluding yourself', async () => {
    mockConversations = [conv({ id: 'a1', with: 'alice', lastMessage: 'yo', updatedAt: '2026-09-01T00:00:00Z' })];
    mockSearchUsers.mockResolvedValue({
      results: [user(ME, 'myself'), user('u-1', 'jordan', 'Jordan M')],
    });
    const utils = render(<MessengerScreen />);

    await typeQuery(utils, 'jor');

    await waitFor(() => expect(utils.queryByText('Jordan M')).toBeTruthy());
    expect(mockSearchUsers).toHaveBeenCalledWith({ keywords: 'jor', limit: 30 });
    expect(utils.queryByText('@jordan')).toBeTruthy();
    expect(utils.queryByText('myself')).toBeNull();
    // The conversation list is hidden while searching.
    expect(utils.queryByText('alice')).toBeNull();
  });

  it('opens a DM with the tapped result', async () => {
    mockSearchUsers.mockResolvedValue({ results: [user('u-1', 'jordan')] });
    const utils = render(<MessengerScreen />);

    await typeQuery(utils, 'jordan');
    await waitFor(() => expect(utils.getByLabelText('Message jordan')).toBeTruthy());
    fireEvent.press(utils.getByLabelText('Message jordan'));

    expect(mockPush).toHaveBeenCalledWith('/tabs/messenger/user/u-1');
  });

  it('shows a no-results state, and clearing the query brings the list back', async () => {
    mockConversations = [conv({ id: 'a1', with: 'alice', lastMessage: 'yo', updatedAt: '2026-09-01T00:00:00Z' })];
    mockSearchUsers.mockResolvedValue({ results: [] });
    const utils = render(<MessengerScreen />);

    await typeQuery(utils, 'zzz');
    await waitFor(() => expect(utils.queryByText('No Users Found')).toBeTruthy());

    fireEvent.press(utils.getByLabelText('Clear search'));
    expect(utils.queryByText('alice')).toBeTruthy();
  });

  it('does not search on an empty or whitespace query', async () => {
    const utils = render(<MessengerScreen />);
    await typeQuery(utils, '   ');
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });
});
