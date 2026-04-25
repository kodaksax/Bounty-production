import { renderHook, waitFor } from '@testing-library/react-native';
import { useConversations } from '../../../hooks/useConversations';
import { CACHE_KEYS } from '../../../lib/services/cached-data-service';
import * as supabaseMessaging from '../../../lib/services/supabase-messaging';
import * as dataUtils from '../../../lib/utils/data-utils';

// Mock the dependencies
jest.mock('../../../lib/services/supabase-messaging');
jest.mock('../../../lib/utils/data-utils');

describe('useConversations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should set loading to false when no valid user', async () => {
    // Mock no valid user (fallback ID)
    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue('00000000-0000-0000-0000-000000000001');

    const { result } = renderHook(() => useConversations());

    // Wait for the effect to run - loading should become false quickly
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Conversations should be empty
    expect(result.current.conversations).toEqual([]);
  });

  it('should fetch conversations when valid user exists', async () => {
    const mockUserId = 'valid-user-id';
    const mockConversations = [
      { id: '1', name: 'Test Conversation', lastMessage: 'Hello', updatedAt: new Date().toISOString() },
    ];

    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue(mockUserId);
    (supabaseMessaging.fetchConversations as jest.Mock).mockResolvedValue(mockConversations);
    (supabaseMessaging.subscribeToConversations as jest.Mock).mockReturnValue({});

    const { result } = renderHook(() => useConversations());

    // Initially loading should be true
    expect(result.current.loading).toBe(true);

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Conversations should be populated
    expect(result.current.conversations).toEqual(mockConversations);
    expect(supabaseMessaging.fetchConversations).toHaveBeenCalledWith(mockUserId);
  });

  it('should handle fetch errors gracefully', async () => {
    const mockUserId = 'valid-user-id';
    const mockError = new Error('Failed to fetch');

    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue(mockUserId);
    (supabaseMessaging.fetchConversations as jest.Mock).mockRejectedValue(mockError);
    (supabaseMessaging.subscribeToConversations as jest.Mock).mockReturnValue({});

    const { result } = renderHook(() => useConversations());

    // Wait for the fetch to complete
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Error should be set to the rejected error's message
    expect(result.current.error).toBe('Failed to fetch');
  });

  it('uses a per-user cache key so conversations cannot leak across accounts', () => {
    // Regression test for "Staging inbox dataleak": the conversations cache key
    // must include the user id so a different user logging in (without a cold
    // restart) cannot read another user's cached inbox.
    expect(typeof CACHE_KEYS.CONVERSATIONS_LIST).toBe('function');

    const userAKey = CACHE_KEYS.CONVERSATIONS_LIST('user-a');
    const userBKey = CACHE_KEYS.CONVERSATIONS_LIST('user-b');

    expect(userAKey).toContain('user-a');
    expect(userBKey).toContain('user-b');
    expect(userAKey).not.toBe(userBKey);
  });
});
