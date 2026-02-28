# Quick Reference: Writing Tests with Shared Helpers

## Import Helpers

```typescript
import { 
  mockFetchSuccess, 
  mockFetchError,
  createMockSession, 
  mockAuthenticatedSupabase,
  mockSharing,
} from '@/__tests__/helpers';
```

## Common Patterns

### 1. Testing Service with HTTP Calls

```typescript
describe('MyService', () => {
  beforeEach(() => {
    mockFetchSuccess({ users: [] });
  });

  it('should fetch users', async () => {
    const result = await myService.getUsers();
    expect(result).toEqual({ users: [] });
  });
});
```

### 2. Testing Auth-Required Service

```typescript
describe('AuthService', () => {
  it('should handle authenticated user', () => {
    const supabase = mockAuthenticatedSupabase();
    // Test with authenticated supabase client
  });

  it('should handle unauthenticated user', () => {
    const supabase = mockUnauthenticatedSupabase();
    // Test with unauthenticated supabase client
  });
});
```

### 3. Testing File Operations

```typescript
describe('FileService', () => {
  beforeEach(() => {
    mockFileSystem();
  });

  it('should write and read files', async () => {
    // File operations are now mocked
  });
});
```

### 4. Testing Share Functionality

```typescript
describe('ShareService', () => {
  beforeEach(() => {
    mockSharing({ isAvailable: true, shouldSucceed: true });
  });

  it('should share content', async () => {
    const result = await shareService.share('content');
    expect(result).toBe(true);
  });
});
```

## Example Test File Structure

```typescript
// 1. Imports
import { ServiceUnderTest } from '../../../lib/services/my-service';
import { mockFetchSuccess, mockAuthenticatedSupabase } from '@/__tests__/helpers';

// 2. Mock modules (before imports)
jest.mock('some-external-module', () => ({...}));

// 3. Describe blocks
describe('ServiceUnderTest', () => {
  let service: ServiceUnderTest;

  // 4. Setup
  beforeEach(() => {
    service = new ServiceUnderTest();
    mockFetchSuccess({ data: 'test' });
  });

  // 5. Test groups
  describe('methodName', () => {
    it('should handle happy path', () => {
      // Test happy path
    });

    it('should handle error path', () => {
      // Test error path
    });

    it('should handle edge cases', () => {
      // Test edge cases
    });
  });
});
```

## Checklist for New Tests

- [ ] Import helpers from `@/__tests__/helpers`
- [ ] Mock external dependencies before tests run
- [ ] Use `beforeEach()` to reset mocks between tests
- [ ] Test happy path first
- [ ] Test error paths
- [ ] Test edge cases (null, undefined, empty, large values)
- [ ] Verify no console errors (unless expected)
- [ ] Check coverage: `npm run test:coverage -- path/to/file.ts`

## Coverage Goals

- **Happy Path**: Main use case works
- **Error Paths**: All errors handled gracefully
- **Edge Cases**: Boundary conditions covered
- **Branch Coverage**: All if/else paths tested
- **Function Coverage**: All functions called

## See Also

- [Full Test Helpers Documentation](__tests__/helpers/README.md)
- [Receipt Service Example](__tests__/unit/services/receipt-service.test.ts)
- [Implementation Summary](TEST_INFRASTRUCTURE_SUMMARY.md)
