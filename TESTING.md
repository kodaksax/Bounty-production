# Testing Guide for BountyExpo

## Overview

This document provides comprehensive information about the testing infrastructure for the BountyExpo application. Our testing suite covers unit tests, integration tests, and end-to-end tests with a target of 70%+ code coverage on critical business logic.

## Testing Stack

- **Test Runner**: Jest
- **TypeScript Support**: ts-jest
- **HTTP Testing**: supertest
- **HTTP Mocking**: nock
- **Node Version**: 18.x and 20.x

## Test Structure

```
__tests__/
├── unit/              # Unit tests for individual functions and services
│   ├── services/      # Service layer tests
│   └── utils/         # Utility function tests
├── integration/       # Integration tests for API endpoints
│   └── api/          # API endpoint tests
└── e2e/              # End-to-end test scenarios
```

## Running Tests

### All Tests
```bash
npm test
```

### Unit Tests Only
```bash
npm run test:unit
```

### Integration Tests Only
```bash
npm run test:integration
```

### E2E Tests Only
```bash
npm run test:e2e
```

### Watch Mode
```bash
npm run test:watch
```

### Coverage Report
```bash
npm run test:coverage
```

### CI Mode
```bash
npm run test:ci
```

## Test Categories

### Unit Tests

Unit tests focus on testing individual functions and services in isolation. They mock all external dependencies.

**Location**: `__tests__/unit/`

**Examples**:
- `auth-service.test.ts` - Tests for authentication service
- `stripe-service.test.ts` - Tests for payment processing
- `utils.test.ts` - Tests for utility functions

**Best Practices**:
- Mock all external dependencies
- Test edge cases and error scenarios
- Keep tests focused and fast
- Aim for 100% coverage of business logic

### Integration Tests

Integration tests verify that different parts of the system work together correctly. They test API endpoints with mocked external services.

**Location**: `__tests__/integration/`

**Examples**:
- `payment-endpoints.test.ts` - Tests payment API endpoints
- `auth-flow.test.ts` - Tests authentication flows
- `bounty-service.test.ts` - Tests bounty acceptance flow

**Best Practices**:
- Mock external services (Stripe, Supabase)
- Test complete user flows
- Verify error handling and edge cases
- Use realistic test data

### E2E Tests

End-to-end tests simulate complete user workflows from start to finish.

**Location**: `__tests__/e2e/`

**Examples**:
- `payment-flow.test.ts` - Tests complete payment lifecycle (escrow → release/refund)

**Best Practices**:
- Test critical business processes
- Include happy path and error scenarios
- Verify data persistence and state changes
- Test security and authorization

## Coverage Requirements

Our target is 70%+ code coverage on critical business logic:

- **Statements**: 70%
- **Branches**: 70%
- **Functions**: 70%
- **Lines**: 70%

### Viewing Coverage

After running `npm run test:coverage`, view the detailed HTML report:

```bash
open coverage/lcov-report/index.html
```

## Writing Tests

### Test File Naming

- Unit tests: `*.test.ts`
- Integration tests: `*.test.ts`
- E2E tests: `*.test.ts`

### Test Structure

```typescript
describe('Service Name', () => {
  beforeEach(() => {
    // Setup before each test
    jest.clearAllMocks();
  });

  describe('method name', () => {
    it('should do something when condition', async () => {
      // Arrange
      const mockData = { ... };
      
      // Act
      const result = await service.method(mockData);
      
      // Assert
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should handle error when invalid input', async () => {
      // Test error scenarios
      await expect(service.method(null)).rejects.toThrow();
    });
  });
});
```

### Mocking

#### Mocking Modules

```typescript
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signIn: jest.fn(),
    },
  },
}));
```

#### Mocking Functions

```typescript
const mockFunction = jest.fn();
mockFunction.mockResolvedValue({ success: true });
mockFunction.mockRejectedValue(new Error('Failed'));
```

## CI/CD Integration

Tests are automatically run on every pull request via GitHub Actions.

### CI Pipeline

The CI pipeline (`.github/workflows/ci.yml`) includes:

1. **Linting**: Code style checks
2. **Type Checking**: TypeScript compilation
3. **Unit Tests**: Fast isolated tests
4. **Integration Tests**: API endpoint tests
5. **E2E Tests**: Complete workflow tests
6. **Coverage Report**: Code coverage analysis
7. **Security Audit**: Dependency vulnerability checks

### Matrix Testing

Tests run on multiple Node.js versions:
- Node.js 18.x
- Node.js 20.x

### Coverage Reporting

Coverage reports are:
- Uploaded to Codecov
- Commented on pull requests
- Stored as artifacts for 30 days

## Test Data

### Mock Users

```typescript
const mockUser = {
  id: 'user123',
  email: 'test@example.com',
};
```

### Mock Bounties

```typescript
const mockBounty = {
  id: 'bounty123',
  title: 'Test Bounty',
  status: 'open',
  amount_cents: 10000,
};
```

### Mock Payment Intents

```typescript
const mockPaymentIntent = {
  id: 'pi_test123',
  client_secret: 'pi_test123_secret_abc',
  amount: 5000,
  currency: 'usd',
  status: 'requires_payment_method',
};
```

## Debugging Tests

### Run Single Test File

```bash
npm test __tests__/unit/services/auth-service.test.ts
```

### Run Tests Matching Pattern

```bash
npm test -- --testNamePattern="should create payment"
```

### Verbose Output

```bash
npm run test:verbose
```

### Debug in VSCode

Add to `.vscode/launch.json`:

```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": ["--runInBand", "--no-cache"],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

## Common Issues

### Issue: Module Not Found

**Solution**: Check that mocks are set up before imports and use correct paths.

### Issue: Timeout Errors

**Solution**: Increase timeout in test or `jest.config.js`:

```typescript
jest.setTimeout(30000);
```

### Issue: Async Not Completing

**Solution**: Ensure all promises are awaited or returned:

```typescript
it('should do async work', async () => {
  await asyncFunction();
  // or
  return asyncFunction().then(result => {
    expect(result).toBeDefined();
  });
});
```

## Best Practices

1. **Arrange-Act-Assert**: Structure tests in three clear phases
2. **One Assertion Per Test**: Focus each test on a single behavior
3. **Descriptive Names**: Use "should do X when Y" format
4. **Mock External Dependencies**: Keep tests isolated and fast
5. **Test Edge Cases**: Include error scenarios and boundary conditions
6. **Clean Up**: Reset mocks and state between tests
7. **Avoid Test Interdependence**: Each test should run independently
8. **Use Factories**: Create reusable test data generators
9. **Test What Matters**: Focus on business logic, not implementation details
10. **Keep Tests Maintainable**: Refactor tests as you refactor code

## Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library](https://testing-library.com/docs/)
- [Supertest](https://github.com/visionmedia/supertest)
- [Testing Best Practices](https://github.com/goldbergyoni/javascript-testing-best-practices)

## Contributing

When adding new features:

1. Write tests first (TDD approach recommended)
2. Ensure all tests pass: `npm test`
3. Check coverage: `npm run test:coverage`
4. Fix any linting issues: `npm run lint`
5. Update this document if adding new test patterns

## Support

For questions or issues with tests:
1. Check this documentation
2. Review existing test files for examples
3. Open an issue on GitHub
4. Contact the development team
