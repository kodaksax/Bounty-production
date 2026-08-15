import { renderHook, waitFor } from '@testing-library/react-native';

const mockUseProfile = jest.fn();
const mockUseAuthProfile = jest.fn();
const mockGetAuthUserId = jest.fn(() => 'viewer-id');
const mockGetProfileById = jest.fn();
const mockFetchAndSyncProfile = jest.fn();

jest.mock('../../../hooks/useProfile', () => ({
  useProfile: (...args: any[]) => mockUseProfile(...args),
}));

jest.mock('../../../hooks/useAuthProfile', () => ({
  useAuthProfile: (...args: any[]) => mockUseAuthProfile(...args),
}));

jest.mock('../../../lib/services/auth-profile-service', () => ({
  authProfileService: {
    getAuthUserId: () => mockGetAuthUserId(),
    getProfileById: (...args: any[]) => mockGetProfileById(...args),
    fetchAndSyncProfile: (...args: any[]) => mockFetchAndSyncProfile(...args),
  },
}));

jest.mock('../../../lib/utils/normalize-profile', () => ({
  normalizeAuthProfile: (profile: any) => profile,
  normalizeUserProfile: (profile: any) => profile,
  mergeNormalized: (primary: any, fallback: any) => primary || fallback,
}));

describe('useNormalizedProfile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseProfile.mockReturnValue({
      profile: null,
      loading: false,
      error: null,
      refresh: jest.fn(),
      updateProfile: jest.fn(),
    });
    mockUseAuthProfile.mockReturnValue({
      profile: null,
      loading: false,
      refreshProfile: jest.fn(),
    });
    mockGetAuthUserId.mockReturnValue('viewer-id');
  });

  function renderUseNormalizedProfile(userId?: string, enabled = true) {
    const { useNormalizedProfile } = require('../../../hooks/useNormalizedProfile');
    return renderHook(
      ({ currentUserId, currentEnabled }: { currentUserId?: string; currentEnabled: boolean }) =>
        useNormalizedProfile(currentUserId, { enabled: currentEnabled }),
      { initialProps: { currentUserId: userId, currentEnabled: enabled } }
    );
  }

  it('clears stale Supabase errors when the Supabase fetch is disabled', async () => {
    mockGetProfileById.mockRejectedValue(new Error('supabase boom'));

    const { result, rerender } = renderUseNormalizedProfile('other-user', true);

    await waitFor(() => expect(result.current.error).toBe('supabase boom'));

    rerender({ currentUserId: 'other-user', currentEnabled: false });

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.loading).toBe(false);
    });
  });
});
