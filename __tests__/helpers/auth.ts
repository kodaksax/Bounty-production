/**
 * Mock authentication helpers for testing
 * Provides deterministic auth states without real API calls
 */

export interface MockUser {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    avatar_url?: string;
  };
}

export interface MockSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: 'bearer';
  user: MockUser;
}

/**
 * Create a mock authenticated user
 */
export function createMockUser(overrides?: Partial<MockUser>): MockUser {
  return {
    id: 'test-user-123',
    email: 'test@example.com',
    user_metadata: {
      full_name: 'Test User',
      avatar_url: 'https://example.com/avatar.jpg',
    },
    ...overrides,
  };
}

/**
 * Create a mock authenticated session
 */
export function createMockSession(userOverrides?: Partial<MockUser>): MockSession {
  const now = Date.now();
  return {
    access_token: 'mock-access-token-' + now,
    refresh_token: 'mock-refresh-token-' + now,
    expires_at: now + 3600000, // 1 hour from now
    expires_in: 3600,
    token_type: 'bearer',
    user: createMockUser(userOverrides),
  };
}

/**
 * Mock Supabase auth client with authenticated state
 */
export function mockAuthenticatedSupabase() {
  const session = createMockSession();
  
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session }, error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

/**
 * Mock Supabase auth client with unauthenticated state
 */
export function mockUnauthenticatedSupabase() {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

/**
 * Mock Supabase auth client with token refresh failure
 */
export function mockAuthTokenRefreshFailure() {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: null },
        error: { message: 'Token refresh failed', status: 401 },
      }),
      getUser: jest.fn().mockResolvedValue({
        data: { user: null },
        error: { message: 'Invalid token', status: 401 },
      }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({
        data: { subscription: { unsubscribe: jest.fn() } },
      }),
    },
    from: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
}

/**
 * Mock SecureStore for auth token storage
 */
export function mockSecureStore(initialData: Record<string, string> = {}) {
  const store = { ...initialData };
  
  return {
    getItemAsync: jest.fn().mockImplementation((key: string) => 
      Promise.resolve(store[key] || null)
    ),
    setItemAsync: jest.fn().mockImplementation((key: string, value: string) => {
      store[key] = value;
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn().mockImplementation((key: string) => {
      delete store[key];
      return Promise.resolve();
    }),
  };
}
