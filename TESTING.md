# Testing Guide for BountyExpo

## Overview

This document provides comprehensive information about the testing infrastructure for the BountyExpo application. Our testing suite covers unit tests, integration tests, and end-to-end tests with a target of 70%+ code coverage on critical business logic.

## Testing Stack

- **Test Runner**: Jest 30.x
- **TypeScript Support**: ts-jest 29.x
- **Component Testing**: @testing-library/react-native 13.x
- **HTTP Testing**: supertest 7.x
- **HTTP Mocking**: nock 14.x
- **Node Version**: 18.x and 20.x

### React Native Mocks

The following React Native modules are automatically mocked in `jest.setup.js`:
- `react-native` core modules
- `expo-haptics`
- `expo-secure-store`
- `expo-constants`
- `@stripe/stripe-react-native`
- `@react-native-community/netinfo`
- `@react-native-async-storage/async-storage`
- `react-native-url-polyfill`

## Test Structure

```
__tests__/
├── unit/              # Unit tests for individual functions and services
│   ├── services/      # Service layer tests (auth, payment, search, etc.)
│   ├── utils/         # Utility function tests (date, validation, etc.)
│   └── components/    # React component tests
├── integration/       # Integration tests for API endpoints and flows
│   ├── api/          # API endpoint tests
│   └── bounty-creation.test.ts  # Bounty creation flow test
├── e2e/              # End-to-end test scenarios
└── components/       # React Native component tests
```

**Current Test Statistics** (as of latest update):
- Total of **410+ tests** passing across **26+ test suites**
- This PR added **4 new test files** with focused unit and integration tests
- Existing test suite includes comprehensive coverage of services, utilities, and components

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
- `services/auth-service.test.ts` - Tests for authentication service
- `services/stripe-service.test.ts` - Tests for payment processing
- `utils/date-utils.test.ts` - Tests for date formatting utilities
- `utils/bounty-validation.test.ts` - Tests for bounty validation logic
- `components/offline-status-badge.test.tsx` - Tests for offline status component

**Best Practices**:
- Mock all external dependencies (Supabase, Stripe, etc.)
- Test edge cases and error scenarios
- Keep tests focused and fast (< 100ms per test)
- Aim for 100% coverage of business logic
- Use descriptive test names following "should [action] when [condition]" pattern

### Integration Tests

Integration tests verify that different parts of the system work together correctly. They test API endpoints with mocked external services.

**Location**: `__tests__/integration/`

**Examples**:
- `api/payment-endpoints.test.ts` - Tests payment API endpoints
- `api/auth-flow.test.ts` - Tests authentication flows
- `api/bounty-service.test.ts` - Tests bounty acceptance flow
- `bounty-creation.test.ts` - Tests complete bounty creation workflow

**Best Practices**:
- Mock external services (Stripe, Supabase)
- Test complete user flows
- Verify error handling and edge cases
- Use realistic test data
- Test database interactions and transactions

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

### Component Tests

Component tests verify that React Native components render correctly and handle user interactions.

**Location**: `__tests__/components/`

**Examples**:
- `offline-status-badge.test.tsx` - Tests offline status indicator
- `wallet-transaction-display.test.ts` - Tests wallet transaction rendering
- `chat-enhancements.test.ts` - Tests chat UI components

**Best Practices**:
- Use React Native Testing Library for rendering
- Mock custom hooks and context providers
- Test component props and state changes
- Verify accessibility features
- Test user interactions (press, input, etc.)

**Component Test Template**:
```typescript
import React from 'react';
import { render } from '@testing-library/react-native';
import { MyComponent } from '../components/MyComponent';

jest.mock('../hooks/useMyHook', () => ({
  useMyHook: jest.fn(),
}));

describe('MyComponent', () => {
  it('should render correctly', () => {
    const { getByText } = render(<MyComponent title="Test" />);
    expect(getByText('Test')).toBeTruthy();
  });
});
```

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
