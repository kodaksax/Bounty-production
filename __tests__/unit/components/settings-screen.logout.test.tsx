import { performLogout } from '../../../lib/services/logout-service';

describe('performLogout', () => {
  afterEach(() => jest.resetAllMocks());

  it('marks intentional sign-out, signs out via supabase, clears profile/session and navigates', async () => {
    const mockSupabase = { auth: { signOut: jest.fn().mockResolvedValue({}) } } as any;
    const mockProfileSvc = {
      clearUserDraftData: jest.fn().mockResolvedValue(undefined),
      setSession: jest.fn().mockResolvedValue(undefined),
    } as any;
    const mockSecureStore = { deleteItemAsync: jest.fn().mockResolvedValue(undefined) } as any;
    const mockClearRemember = jest.fn().mockResolvedValue(undefined);
    const mockMarkIntent = jest.fn();
    const mockRouter = { replace: jest.fn() } as any;
    const mockDeregisterPushToken = jest.fn().mockResolvedValue(undefined);

    await performLogout({
      supabase: mockSupabase,
      authProfileService: mockProfileSvc,
      SecureStore: mockSecureStore,
      clearRememberMePreference: mockClearRemember,
      markIntentionalSignOut: mockMarkIntent,
      router: mockRouter,
      currentUserId: 'user-1',
      deregisterPushToken: mockDeregisterPushToken,
    });

    expect(mockMarkIntent).toHaveBeenCalled();
    expect(mockDeregisterPushToken).toHaveBeenCalled();
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
    expect(mockProfileSvc.clearUserDraftData).toHaveBeenCalledWith('user-1');
    expect(mockProfileSvc.setSession).toHaveBeenCalledWith(null);
    expect(mockRouter.replace).toHaveBeenCalledWith('/auth/sign-in-form');

    // Background cleanup scheduled (fire-and-forget)
    expect(mockClearRemember).toHaveBeenCalled();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('sb-access-token');
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('sb-refresh-token');
  });

  it('falls back to local signOut on timeout and still proceeds', async () => {
    // Use a supabase.signOut that rejects to force fallback
    const badSupabase = { auth: { signOut: jest.fn().mockRejectedValue(new Error('boom')) } } as any;
    const mockProfileSvc = { clearUserDraftData: jest.fn().mockResolvedValue(undefined), setSession: jest.fn().mockResolvedValue(undefined) } as any;
    const mockSecureStore = { deleteItemAsync: jest.fn().mockResolvedValue(undefined) } as any;

    await performLogout({
      supabase: badSupabase,
      authProfileService: mockProfileSvc,
      SecureStore: mockSecureStore,
      clearRememberMePreference: jest.fn().mockResolvedValue(undefined),
      markIntentionalSignOut: jest.fn(),
      router: { replace: jest.fn() },
      currentUserId: null,
      deregisterPushToken: jest.fn().mockResolvedValue(undefined),
    });

    // Even if signOut failed, we still call setSession(null)
    expect(mockProfileSvc.setSession).toHaveBeenCalledWith(null);
  });

  it('still completes logout when deregisterPushToken fails', async () => {
    const mockSupabase = { auth: { signOut: jest.fn().mockResolvedValue({}) } } as any;
    const mockProfileSvc = {
      clearUserDraftData: jest.fn().mockResolvedValue(undefined),
      setSession: jest.fn().mockResolvedValue(undefined),
    } as any;
    const mockSecureStore = { deleteItemAsync: jest.fn().mockResolvedValue(undefined) } as any;
    const mockRouter = { replace: jest.fn() } as any;

    await performLogout({
      supabase: mockSupabase,
      authProfileService: mockProfileSvc,
      SecureStore: mockSecureStore,
      clearRememberMePreference: jest.fn().mockResolvedValue(undefined),
      markIntentionalSignOut: jest.fn(),
      router: mockRouter,
      currentUserId: null,
      deregisterPushToken: jest.fn().mockRejectedValue(new Error('token removal failed')),
    });

    // Logout should still navigate even if token deregistration fails
    expect(mockRouter.replace).toHaveBeenCalledWith('/auth/sign-in-form');
    expect(mockSupabase.auth.signOut).toHaveBeenCalled();
  });
});
