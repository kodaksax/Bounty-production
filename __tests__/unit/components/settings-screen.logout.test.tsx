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
    const mockMarkIntent = jest.fn();
    const mockRouter = { replace: jest.fn() } as any;
    const mockDeregisterPushToken = jest.fn().mockResolvedValue(undefined);
    const mockClearNotificationCache = jest.fn().mockResolvedValue(undefined);

    await performLogout({
      supabase: mockSupabase,
      authProfileService: mockProfileSvc,
      SecureStore: mockSecureStore,
      markIntentionalSignOut: mockMarkIntent,
      router: mockRouter,
      currentUserId: 'user-1',
      deregisterPushToken: mockDeregisterPushToken,
      clearNotificationCache: mockClearNotificationCache,
    });

    expect(mockMarkIntent).toHaveBeenCalled();
    expect(mockDeregisterPushToken).toHaveBeenCalled();
    expect(mockClearNotificationCache).toHaveBeenCalledWith('user-1');
    // Must be device-local, not the SDK's global default — a regression here
    // would silently kick this user's OTHER signed-in devices. Asserting the
    // call args (not just "was it called") is what actually catches that.
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mockProfileSvc.clearUserDraftData).toHaveBeenCalledWith('user-1');
    expect(mockProfileSvc.setSession).toHaveBeenCalledWith(null);
    expect(mockRouter.replace).toHaveBeenCalledWith('/auth/sign-in-form');

    // Background cleanup scheduled (fire-and-forget)
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
      markIntentionalSignOut: jest.fn(),
      router: { replace: jest.fn() },
      currentUserId: null,
      deregisterPushToken: jest.fn().mockResolvedValue(undefined),
      clearNotificationCache: jest.fn().mockResolvedValue(undefined),
    });

    // Even if signOut failed, we still call setSession(null)
    expect(mockProfileSvc.setSession).toHaveBeenCalledWith(null);
    // Every retry/fallback attempt must stay local-scoped too — a regression
    // to a bare/global call on the retry path would still leave this test
    // green if we only checked that signOut was called.
    for (const call of badSupabase.auth.signOut.mock.calls) {
      expect(call[0]).toEqual({ scope: 'local' });
    }
    expect(badSupabase.auth.signOut.mock.calls.length).toBeGreaterThan(0);
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
      markIntentionalSignOut: jest.fn(),
      router: mockRouter,
      currentUserId: null,
      deregisterPushToken: jest.fn().mockRejectedValue(new Error('token removal failed')),
      clearNotificationCache: jest.fn().mockResolvedValue(undefined),
    });

    // Logout should still navigate even if token deregistration fails
    expect(mockRouter.replace).toHaveBeenCalledWith('/auth/sign-in-form');
    expect(mockSupabase.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
