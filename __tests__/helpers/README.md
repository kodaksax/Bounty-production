# Test Helpers

Shared test utilities and mocks for the BOUNTYExpo test suite.

## Overview

This directory contains reusable test helpers that prevent real external calls during tests and provide deterministic mock implementations. These helpers ensure:

- **No real network calls** during tests
- **No real auth API calls** during tests
- **No real filesystem operations** during tests
- **Clean, noise-free test output**
- **Deterministic test behavior**

## Available Helpers

### 1. Fetch Mocks (`fetch.ts`)

Prevents real HTTP requests during tests.

```typescript
import { mockFetchSuccess, mockFetchError, mockFetchNetworkError } from '@/__tests__/helpers';

// Mock a successful response
mockFetchSuccess({ data: 'value' }, 200);

// Mock an error response
mockFetchError('Not Found', 404);

// Mock a network failure
mockFetchNetworkError('Connection timeout');
```

**Available functions:**
- `mockFetchSuccess<T>(data: T, status?: number)` - Mock successful HTTP response
- `mockFetchError(error: Error | string, status?: number)` - Mock HTTP error response
- `mockFetchNetworkError(message?: string)` - Mock network failure
- `resetFetchMock()` - Reset fetch mock to default
- `expectNoRealFetchCalls()` - Verify no real fetch calls were made

### 2. Auth Mocks (`auth.ts`)

Provides deterministic auth states without real API calls.

```typescript
import { 
  createMockUser, 
  createMockSession,
  mockAuthenticatedSupabase,
  mockUnauthenticatedSupabase,
  mockAuthTokenRefreshFailure,
} from '@/__tests__/helpers';

// Create a mock user
const user = createMockUser({ email: 'custom@example.com' });

// Create a mock session
const session = createMockSession({ email: 'test@example.com' });

// Mock authenticated Supabase client
const supabase = mockAuthenticatedSupabase();

// Mock unauthenticated state
const supabase = mockUnauthenticatedSupabase();

// Mock token refresh failure
const supabase = mockAuthTokenRefreshFailure();
```

**Available functions:**
- `createMockUser(overrides?)` - Create a mock user object
- `createMockSession(userOverrides?)` - Create a mock session with user
- `mockAuthenticatedSupabase()` - Mock Supabase client with authenticated state
- `mockUnauthenticatedSupabase()` - Mock Supabase client with unauthenticated state
- `mockAuthTokenRefreshFailure()` - Mock Supabase client with token refresh failure
- `mockSecureStore(initialData?)` - Mock SecureStore for auth token storage

### 3. Filesystem Mocks (`filesystem.ts`)

Prevents actual file I/O and sharing operations during tests.

```typescript
import { 
  mockFileSystem,
  mockSharing,
  mockReactNativeShare,
  createMockFileSystem,
} from '@/__tests__/helpers';

// Mock expo-file-system
const fs = mockFileSystem();

// Mock expo-sharing (available)
const sharing = mockSharing({ isAvailable: true, shouldSucceed: true });

// Mock expo-sharing (unavailable)
const sharing = mockSharing({ isAvailable: false });

// Mock React Native Share
const share = mockReactNativeShare(true);

// Create a mock filesystem with initial files
const fs = createMockFileSystem({
  '/path/to/file.txt': 'file content',
});
```

**Available functions:**
- `mockFileSystem()` - Mock expo-file-system module
- `mockSharing(options?)` - Mock expo-sharing module
- `mockReactNativeShare(shouldSucceed?)` - Mock React Native Share module
- `createMockFileSystem(initialFiles?)` - Create a mock filesystem with state
- `resetFileSystemMocks()` - Reset all filesystem and sharing mocks

## Usage Examples

### Basic Test Setup

```typescript
import { mockFetchSuccess } from '@/__tests__/helpers';

describe('MyService', () => {
  beforeEach(() => {
    // Setup mocks
    mockFetchSuccess({ data: 'test' });
  });

  it('should fetch data', async () => {
    const result = await myService.fetchData();
    expect(result).toEqual({ data: 'test' });
  });
});
```

### Testing Auth Flows

```typescript
import { createMockSession, mockAuthenticatedSupabase } from '@/__tests__/helpers';

describe('Auth Flow', () => {
  it('should handle authenticated user', async () => {
    const supabase = mockAuthenticatedSupabase();
    const { data } = await supabase.auth.getSession();
    
    expect(data.session).toBeDefined();
    expect(data.session?.user.email).toBe('test@example.com');
  });
});
```

### Testing File Operations

```typescript
import { createMockFileSystem } from '@/__tests__/helpers';

describe('File Service', () => {
  it('should read and write files', async () => {
    const fs = createMockFileSystem({
      '/test.txt': 'initial content',
    });

    // Read file
    const content = await fs.readAsStringAsync('/test.txt');
    expect(content).toBe('initial content');

    // Write file
    await fs.writeAsStringAsync('/test.txt', 'new content');
    expect(fs._files['/test.txt']).toBe('new content');
  });
});
```

## Best Practices

1. **Always use mocks for external dependencies** - Never make real HTTP, auth, or filesystem calls in tests
2. **Reset mocks between tests** - Use `beforeEach()` to reset mocks to avoid test pollution
3. **Test both success and error paths** - Use the error mocking functions to test error handling
4. **Keep tests deterministic** - Avoid Date.now(), Math.random(), etc. Use fixed values
5. **Document test intent** - Use descriptive test names that explain what's being tested

## Adding New Helpers

When adding new test helpers:

1. Create a new file in `__tests__/helpers/`
2. Export all helper functions
3. Add exports to `index.ts`
4. Document the helpers in this README
5. Write tests using the new helpers as examples

## See Also

- [jest.setup.js](../../jest.setup.js) - Global Jest configuration and base mocks
- [jest.config.js](../../jest.config.js) - Jest configuration
- Example tests using these helpers:
  - [__tests__/unit/services/receipt-service.test.ts](../unit/services/receipt-service.test.ts)
