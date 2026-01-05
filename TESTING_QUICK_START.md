# Testing Quick Start Guide

## ✅ Current Status: ALL TESTS PASSING

**Summary:** 617 tests passing across 41 test suites  
**Last Updated:** 2026-01-05

---

## Quick Test Commands

### Run Everything
```bash
npm test                  # Run all tests (~26s)
npm run test:ci          # CI mode with coverage (~26s)
```

### Run by Category
```bash
npm run test:unit        # Unit tests only (556 tests, ~24s)
npm run test:integration # Integration tests (73 tests, ~3s)
npm run test:e2e         # E2E tests (17 tests, <1s)
```

### Development
```bash
npm run test:watch       # Watch mode - auto-rerun on changes
npm run test:verbose     # Detailed output
npm run test:coverage    # Generate coverage report
```

### Run Specific Tests
```bash
# Single file
npm test __tests__/unit/services/auth-service.test.ts

# By pattern
npm test -- --testNamePattern="payment"

# Specific test suite
npm test __tests__/unit/services/
```

---

## What's Tested

### ✅ Unit Tests (556 tests)
- **Services**: Auth, Stripe, Portfolio, Search, Cancellation, Reports
- **Utils**: Validation, Sanitization, Date/Time, Images, Errors
- **Components**: Skeleton loaders, Offline badges, Animations
- **Security**: Input sanitization, Password validation

### ✅ Integration Tests (73 tests)
- **API Endpoints**: Payment, Auth, Bounty services
- **Workflows**: Bounty creation, Profile loading
- **Real-time**: WebSocket bounty updates
- **Auth**: State persistence across sessions

### ✅ E2E Tests (17 tests)
- **Payment Flow**: Escrow → Release/Refund
- **Security**: Authorization, Double-spending prevention
- **Edge Cases**: Timeouts, Failures, Disputes
- **Audit**: Transaction logging

---

## API Service Tests

The API service (`services/api/`) has its own test suite:

```bash
cd services/api

# Note: These require the API server to be running
npm run dev              # Start server first (separate terminal)

# Then run tests:
npm run test:websocket   # WebSocket integration
npm run test:auth        # Auth endpoints
npm run test:bounties    # Bounty CRUD
npm run test:payment-flow # Payment workflows
npm run test:stripe-connect # Stripe Connect
npm run test:wallet      # Wallet operations
```

**Important:** API service tests are **integration tests** that:
- Require a running API server
- Need database connection
- Use test Stripe keys
- Are separate from the main Jest suite

---

## Test Results

### Current Coverage
- **Statements:** 21.77% (Target: 70%)
- **Branches:** 19.04% (Target: 70%)
- **Lines:** 22.19% (Target: 70%)
- **Functions:** 22.4% (Target: 70%)

### Well-Tested (100% Coverage)
✅ Bounty validation  
✅ Date utilities  
✅ Avatar utilities  
✅ Timeout utilities  
✅ Password validation (94%)  
✅ Input sanitization (93%)

### Needs More Tests
⚠️ Transaction service (0%)  
⚠️ User profile service (0%)  
⚠️ WebSocket adapter (0%)  
⚠️ Stripe service (24%)  
⚠️ Messaging service (10%)

---

## Troubleshooting

### "jest: not found"
```bash
npm install
```

### Module not found
```bash
npm test -- --clearCache
```

### Timeout errors
```bash
# Already configured in jest.config.js
testTimeout: 30000
```

### Tests fail in CI but pass locally
- Check Node.js version (18-20)
- Verify environment variables
- Review CI logs

---

## Test Writing Cheat Sheet

### Unit Test
```typescript
describe('ServiceName', () => {
  it('should do X when Y', async () => {
    // Arrange
    const input = { ... };
    
    // Act
    const result = await service.method(input);
    
    // Assert
    expect(result).toEqual({ ... });
  });
});
```

### Integration Test
```typescript
it('should process end-to-end flow', async () => {
  const response = await request(app)
    .post('/api/endpoint')
    .send({ ... });
    
  expect(response.status).toBe(200);
});
```

### Mock External Services
```typescript
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: { signIn: jest.fn() }
  }
}));
```

---

## CI/CD

Tests run automatically on every PR via GitHub Actions:

✅ Linting  
✅ TypeScript compilation  
✅ Unit tests  
✅ Integration tests  
✅ E2E tests  
✅ Coverage report  
✅ Security audit

Tested on Node.js 18.x and 20.x

---

## Next Steps to Improve Coverage

### Priority 1: Critical Services
1. Add tests for `transaction-service.ts`
2. Add tests for `websocket-adapter.ts`
3. Add tests for `user-profile-service.ts`

### Priority 2: Existing Services
1. Improve `stripe-service.ts` (24% → 70%)
2. Improve `supabase-messaging.ts` (10% → 70%)
3. Add tests for `server/index.js`

### Priority 3: New Features
1. Write tests before adding features (TDD)
2. Maintain 70%+ coverage for new code
3. Add integration tests for new endpoints

---

## Resources

- 📄 [Full Test Execution Report](./TEST_EXECUTION_REPORT.md)
- 📚 [Complete Testing Guide](./TESTING.md)
- 🔧 [Jest Documentation](https://jestjs.io/)
- 🧪 [Testing Library](https://testing-library.com/)

---

## Summary

✅ **All 617 tests passing**  
✅ **0 failures**  
✅ **Test infrastructure working**  
⚠️ **Coverage at 22% (target: 70%)**

Tests are fully functional and ready for development. The main task ahead is increasing coverage by adding more tests, not fixing failing ones.
