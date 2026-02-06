# Payment Flow Testing Guide

This guide explains how to run, maintain, and extend the comprehensive payment flow test suite.

## 📋 Table of Contents

- [Overview](#overview)
- [Test Structure](#test-structure)
- [Prerequisites](#prerequisites)
- [Running Tests](#running-tests)
- [Test Coverage](#test-coverage)
- [Writing New Tests](#writing-new-tests)
- [Troubleshooting](#troubleshooting)
- [CI/CD Integration](#cicd-integration)

## 🎯 Overview

The payment flow test suite includes **206 tests** covering:

- **Unit Tests (160)**: Individual service function testing
- **Integration Tests (25)**: API endpoint testing with mocked dependencies
- **E2E Tests (21)**: Complete user flow scenarios

### Coverage Areas

✅ Escrow creation and management  
✅ Payment release with platform fees  
✅ Refund processing  
✅ Wallet operations (deposit/withdrawal)  
✅ Stripe Connect integration  
✅ Error handling and edge cases  
✅ Security validation  
✅ Idempotency and atomic operations  

## 📁 Test Structure

```
__tests__/
├── unit/
│   └── services/
│       ├── consolidated-payment-service.test.ts    (34 tests)
│       ├── consolidated-wallet-service.test.ts     (44 tests)
│       ├── completion-release-service.test.ts      (24 tests)
│       ├── refund-service.test.ts                  (27 tests)
│       └── stripe-connect-service.test.ts          (31 tests)
├── integration/
│   └── api/
│       └── payment-flows.test.ts                   (25 tests)
└── e2e/
    └── complete-payment-flows.test.ts              (21 tests)
```

## 🔧 Prerequisites

### Required Dependencies

```bash
npm install --save-dev \
  jest@^29.7.0 \
  ts-jest@^29.1.0 \
  @types/jest@^29.5.0 \
  supertest@^6.3.0 \
  @types/supertest@^6.0.0
```

### Environment Setup

The tests use mocked services and don't require actual API keys, but the following environment variables should be set for consistency:

```bash
# .env.test
STRIPE_SECRET_KEY=sk_test_mock_key
SUPABASE_URL=https://test.supabase.co
SUPABASE_SERVICE_ROLE_KEY=test-service-role-key
NODE_ENV=test
```

## 🚀 Running Tests

### Run All Tests

```bash
npm test
```

### Run Specific Test Suites

```bash
# All unit tests
npm test -- __tests__/unit/

# All integration tests
npm test -- __tests__/integration/

# All E2E tests
npm test -- __tests__/e2e/

# Specific service
npm test -- __tests__/unit/services/consolidated-payment-service.test.ts
```

### Run with Coverage

```bash
npm test -- --coverage

# Generate HTML coverage report
npm test -- --coverage --coverageReporters=html
```

### Watch Mode (for development)

```bash
npm test -- --watch
```

### Run Only Changed Tests

```bash
npm test -- --onlyChanged
```

### Verbose Output

```bash
npm test -- --verbose
```

## 📊 Test Coverage

### Current Coverage Goals

| Service | Target | Expected |
|---------|--------|----------|
| consolidated-payment-service.ts | >80% | ~90% |
| consolidated-wallet-service.ts | >80% | ~90% |
| completion-release-service.ts | >80% | ~95% |
| refund-service.ts | >80% | ~95% |
| stripe-connect-service.ts | >80% | ~85% |

### Viewing Coverage

After running tests with coverage:

```bash
# Open HTML report in browser
open coverage/lcov-report/index.html

# View summary in terminal
cat coverage/coverage-summary.txt
```

### Coverage Thresholds

Jest is configured to enforce minimum coverage:

```javascript
// jest.config.js
module.exports = {
  coverageThreshold: {
    global: {
      branches: 75,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};
```

## ✍️ Writing New Tests

### Test Template

```typescript
/**
 * Unit tests for [Service Name]
 * Tests [brief description]
 */

// Mock dependencies
jest.mock('dependency-path', () => ({
  // Mock implementation
}));

// Import service after mocks
import * as serviceUnderTest from 'path-to-service';

describe('[Service Name]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('[function name]', () => {
    it('should [expected behavior]', async () => {
      // Arrange: Setup test data
      const input = { /* test data */ };

      // Act: Execute function
      const result = await serviceUnderTest.functionName(input);

      // Assert: Verify expectations
      expect(result).toEqual(expectedOutput);
      expect(mockDependency).toHaveBeenCalledWith(expectedArgs);
    });

    it('should handle [error case]', async () => {
      // Arrange: Setup error condition
      mockDependency.mockRejectedValueOnce(new Error('Test error'));

      // Act & Assert
      await expect(
        serviceUnderTest.functionName(input)
      ).rejects.toThrow('Expected error');
    });
  });
});
```

### Best Practices

1. **Isolation**: Each test should be independent
2. **Mocking**: Mock all external dependencies
3. **Naming**: Use descriptive test names with "should"
4. **Arrange-Act-Assert**: Follow AAA pattern
5. **Error Cases**: Test both success and failure paths
6. **Edge Cases**: Include boundary conditions
7. **Cleanup**: Use `beforeEach` to reset mocks

### Example: Adding a New Payment Test

```typescript
describe('processPayment', () => {
  it('should process payment with valid credit card', async () => {
    // Arrange
    const paymentData = {
      amount: 5000,
      paymentMethodId: 'pm_test123',
      customerId: 'cus_test123',
    };

    mockStripe.paymentIntents.create.mockResolvedValueOnce({
      id: 'pi_test123',
      status: 'succeeded',
    });

    // Act
    const result = await paymentService.processPayment(paymentData);

    // Assert
    expect(result.success).toBe(true);
    expect(result.paymentIntentId).toBe('pi_test123');
    expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 5000,
        customer: 'cus_test123',
      })
    );
  });
});
```

## 🔍 Troubleshooting

### Common Issues

#### 1. Tests Failing with Module Not Found

**Problem**: `Cannot find module '@supabase/supabase-js'`

**Solution**:
```bash
npm install --save-dev @supabase/supabase-js
```

#### 2. Timeout Errors

**Problem**: `Exceeded timeout of 5000 ms`

**Solution**: Increase timeout in jest.config.js or specific test:
```javascript
jest.setTimeout(30000); // 30 seconds
```

#### 3. Mock Not Working

**Problem**: Mock not being used, real service called

**Solution**: Ensure mocks are defined before imports:
```typescript
jest.mock('stripe'); // Must be before import
import Stripe from 'stripe';
```

#### 4. TypeScript Errors

**Problem**: Type errors in test files

**Solution**: Ensure test types are installed:
```bash
npm install --save-dev @types/jest @types/node
```

### Debug Mode

Run tests in debug mode:

```bash
node --inspect-brk node_modules/.bin/jest --runInBand
```

Then connect with Chrome DevTools at `chrome://inspect`

### Verbose Logging

Enable detailed logging:

```bash
DEBUG=* npm test
```

## 🔄 CI/CD Integration

### GitHub Actions Example

```yaml
name: Payment Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run payment tests
        run: npm test -- __tests__/unit/services/ __tests__/integration/api/payment-flows.test.ts __tests__/e2e/complete-payment-flows.test.ts
      
      - name: Generate coverage report
        run: npm test -- --coverage
      
      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/lcov.info
          flags: payment-tests
```

### Pre-commit Hook

Add to `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run payment tests before commit
npm test -- __tests__/unit/services/ --passWithNoTests
```

### NPM Scripts

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:unit": "jest __tests__/unit/",
    "test:integration": "jest __tests__/integration/",
    "test:e2e": "jest __tests__/e2e/",
    "test:payment": "jest __tests__/unit/services/ __tests__/integration/api/payment-flows.test.ts __tests__/e2e/complete-payment-flows.test.ts",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:ci": "jest --ci --coverage --maxWorkers=2"
  }
}
```

## 📈 Monitoring Test Health

### Track Test Metrics

- **Execution Time**: Monitor for slow tests
- **Flakiness**: Track intermittent failures
- **Coverage Trends**: Ensure coverage doesn't decrease
- **Maintenance**: Update tests when services change

### Test Performance

```bash
# Find slow tests
npm test -- --verbose | grep -A 2 "PASS\|FAIL" | grep "ms"

# Run tests with timing
npm test -- --verbose --maxWorkers=1
```

## 🎓 Additional Resources

- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [Testing Library Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
- [Stripe Testing Guide](https://stripe.com/docs/testing)
- [Supabase Testing](https://supabase.com/docs/guides/getting-started/tutorials/testing)

## 📝 Maintenance Checklist

- [ ] Run tests before every commit
- [ ] Update tests when service logic changes
- [ ] Add tests for new payment features
- [ ] Review coverage reports weekly
- [ ] Update mocks when external APIs change
- [ ] Refactor flaky or slow tests
- [ ] Document complex test scenarios
- [ ] Keep test data fixtures up to date

---

**Last Updated**: January 2024  
**Test Suite Version**: 1.0.0  
**Maintained By**: Development Team
