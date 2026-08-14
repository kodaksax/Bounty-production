import { renderHook, waitFor } from '@testing-library/react-native';

const mockGetAuthUserId = jest.fn(() => 'viewer-id');
const mockGetProfileById = jest.fn();
const mockFetchAndSyncProfile = jest.fn();

jest.mock('../../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    getAuthUserId: () => mockGetAuthUserId(),
    getProfileById: (...args: any[]) => mockGetProfileById(...args),
    fetchAndSyncProfile: (...args: any[]) => mockFetchAndSyncProfile(...args),
  },
}));

jest.mock('../../../lib/utils/normalize-profile', () => ({
  authProfileToUserProfile: (profile: any) => ({
    id: profile.id,
    username: profile.username,
    avatar: profile.avatar,
  }),
}));

describe('useProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAuthUserId.mockReturnValue('viewer-id');
  });

  function renderUseProfile(userId?: string, enabled = true) {
    const { useProfile } = require('../../../hooks/useProfile');
    return renderHook(
      ({ currentUserId, currentEnabled }: { currentUserId?: string; currentEnabled: boolean }) =>
        useProfile(currentUserId, currentEnabled),
      { initialProps: { currentUserId: userId, currentEnabled: enabled } }
    );
  }

  it('clears stale profile state when disabled after a successful fetch', async () => {
    mockGetProfileById.mockResolvedValue({ id: 'user-1', username: 'alice', avatar: null });

    const { result, rerender } = renderUseProfile('user-1', true);

    await waitFor(() => expect(result.current.profile?.username).toBe('alice'));

    rerender({ currentUserId: 'user-2', currentEnabled: false });

    await waitFor(() => {
      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });

  it('clears stale error state when disabled after a failed fetch', async () => {
    mockGetProfileById.mockRejectedValue(new Error('boom'));

    const { result, rerender } = renderUseProfile('user-1', true);

    await waitFor(() => expect(result.current.error).toBe('boom'));

    rerender({ currentUserId: 'user-2', currentEnabled: false });

    await waitFor(() => {
      expect(result.current.profile).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });
});
