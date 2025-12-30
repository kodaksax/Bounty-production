import { renderHook, waitFor } from '@testing-library/react-native';
import { useConversations } from '../../../hooks/useConversations';
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
    // Mock no valid user
    (dataUtils.getCurrentUserId as jest.Mock).mockReturnValue('00000000-0000-0000-0000-000000000001');

    const { result } = renderHook(() => useConversations());

    // Initially loading should be true
    expect(result.current.loading).toBe(true);

    // Wait for the effect to run
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

    // Error should be set
    expect(result.current.error).toBe('Failed to fetch');
  });
});
