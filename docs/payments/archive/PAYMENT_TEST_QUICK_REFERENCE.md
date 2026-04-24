# Payment Test Quick Reference

## 🚀 Quick Start

```bash
# Install dependencies
npm install

# Run all payment tests
npm test -- __tests__/unit/services/ __tests__/integration/api/payment-flows.test.ts __tests__/e2e/complete-payment-flows.test.ts

# Run with coverage
npm test -- --coverage
```

## 📊 Test Stats

- **Total Tests**: 206
- **Unit Tests**: 160 (5 files)
- **Integration Tests**: 25 (1 file)
- **E2E Tests**: 21 (1 file)
- **Expected Coverage**: >80% for all services

## 🧪 Test Files

| File | Tests | Purpose |
|------|-------|---------|
| `consolidated-payment-service.test.ts` | 34 | PaymentIntent operations |
| `consolidated-wallet-service.test.ts` | 44 | Wallet & escrow management |
| `completion-release-service.test.ts` | 24 | Release payments to hunters |
| `refund-service.test.ts` | 27 | Refund processing |
| `stripe-connect-service.test.ts` | 31 | Stripe Connect integration |
| `payment-flows.test.ts` | 25 | API endpoint integration |
| `complete-payment-flows.test.ts` | 21 | End-to-end user flows |

## ✅ What's Tested

### Payment Flows
- ✅ Escrow creation (with duplicate prevention)
- ✅ Payment release (with 5% platform fee)
- ✅ Refund processing (full and partial)
- ✅ Wallet deposits and withdrawals
- ✅ Stripe Connect onboarding
- ✅ Payment method management

### Error Handling
- ✅ Card declined errors
- ✅ Insufficient funds
- ✅ Network timeouts
- ✅ Invalid amounts
- ✅ Authentication failures
- ✅ Idempotency conflicts

### Security
- ✅ Input validation
- ✅ Ownership verification
- ✅ Error message sanitization
- ✅ SQL injection prevention
- ✅ XSS prevention

### Edge Cases
- ✅ Concurrent operations
- ✅ Double-release prevention
- ✅ Duplicate escrow prevention
- ✅ Zero/negative amounts
- ✅ Missing required fields
- ✅ Stale data handling

## 🔍 Common Commands

```bash
# Run specific test file
npm test -- __tests__/unit/services/consolidated-payment-service.test.ts

# Run tests matching pattern
npm test -- -t "createPaymentIntent"

# Watch mode
npm test -- --watch

# Update snapshots
npm test -- -u

# Debug mode
node --inspect-brk node_modules/.bin/jest --runInBand

# Silent mode (no console output)
npm test -- --silent

# Clear cache
npm test -- --clearCache
```

## 🏗️ Test Structure

```typescript
describe('Service/Feature', () => {
  beforeEach(() => jest.clearAllMocks());
  
  describe('functionName', () => {
    it('should handle success case', async () => {
      // Arrange
      const input = { /* test data */ };
      
      // Act
      const result = await service.function(input);
      
      // Assert
      expect(result).toEqual(expected);
    });
    
    it('should handle error case', async () => {
      // Arrange: Setup error
      mockDep.mockRejectedValueOnce(new Error('Test error'));
      
      // Act & Assert
      await expect(service.function(input)).rejects.toThrow();
    });
  });
});
```

## 🎯 Coverage Reports

```bash
# Generate coverage
npm test -- --coverage

# View HTML report
open coverage/lcov-report/index.html

# Check specific file
npm test -- --coverage --collectCoverageFrom=services/api/src/services/consolidated-payment-service.ts
```

## 🐛 Debugging

### Enable Verbose Logging
```bash
DEBUG=* npm test
```

### Run Single Test
```bash
npm test -- -t "should create payment intent with valid data"
```

### Inspect Mocks
```typescript
console.log(mockStripe.paymentIntents.create.mock.calls);
```

## 📝 Test Data

### Common Test IDs
- Payment Intents: `pi_test123`
- Customers: `cus_test123`, `cus_poster`, `cus_hunter`
- Refunds: `ref_test123`
- Transfers: `tr_test123`
- Users: `user123`, `poster123`, `hunter123`
- Bounties: `bounty123`
- Transactions: `tx123`, `tx_escrow`, `tx_release`

### Test Amounts
- Small: 5000 ($50.00)
- Medium: 10000 ($100.00)
- Large: 100000 ($1,000.00)
- Platform Fee: 5% default

### Test Tokens
- Valid: `valid_token`
- Invalid: `invalid_token`
- Expired: `expired_token`

## 🔄 CI/CD

### GitHub Actions
```yaml
- name: Run payment tests
  run: npm test -- --ci --coverage --maxWorkers=2
```

### Pre-commit Hook
```bash
npm test -- __tests__/unit/services/ --passWithNoTests
```

## 📚 Documentation

- **Full Guide**: `PAYMENT_TESTING_GUIDE.md`
- **Test Summary**: `PAYMENT_TEST_SUITE_SUMMARY.md`
- **This Reference**: `PAYMENT_TEST_QUICK_REFERENCE.md`

## 🆘 Troubleshooting

### Tests Not Found
```bash
npm install --save-dev jest ts-jest @types/jest
```

### Module Not Found
```bash
npm install --save-dev @supabase/supabase-js stripe
```

### Timeout Errors
```typescript
jest.setTimeout(30000); // In test file
```

### Type Errors
```bash
npm install --save-dev @types/node @types/supertest
```

## 🎓 Best Practices

1. ✅ Clear mocks before each test
2. ✅ Test both success and error paths
3. ✅ Use descriptive test names
4. ✅ Keep tests isolated and independent
5. ✅ Mock all external dependencies
6. ✅ Test edge cases and boundaries
7. ✅ Maintain >80% coverage
8. ✅ Run tests before committing

## 📞 Support

- Review test files for examples
- Check `PAYMENT_TESTING_GUIDE.md` for detailed info
- See `PAYMENT_TEST_SUITE_SUMMARY.md` for complete test inventory

---

**Quick Tip**: Run `npm test -- --help` to see all Jest options!
